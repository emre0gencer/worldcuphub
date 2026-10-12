"""Close out a completed tournament: re-pull, audit, cross-check, replay.

Live ingestion for 2026 ended with the Final on 2026-07-19. The live worker did
not witness every match (Railway crash-loops early in the group stage; a few
games were recovered from ESPN), so this one command turns whatever the
database holds into the complete, verified, archived record:

  1. Re-pull   — full season backfill from API-Football with --force, so every
                 fixture, lineup, event and player row is the provider's final
                 (post-correction) version. Skip with --skip-api.
  2. Audit     — completeness + internal consistency of the owned data:
                 104 fixtures / 48 teams / stage counts, nothing left live or
                 scheduled, 2 team-stat rows per match, player/event/lineup
                 coverage, goal events vs. scoreline, opponent join symmetry.
  3. Cross-check — every result vs. ESPN's public scoreboard (an independent
                 second provider), and the hand-verified anchors in
                 reference_<season>.py (podium, knockout path, Golden Boot).
                 Skip ESPN with --skip-espn.
  4. Replay    — Elo from the frozen FIFA seed over every match in kickoff
                 order (writes team_seasons.elo + team_elo_history), then the
                 full Track 3 rebuild matchday by matchday (team_form history +
                 leak-free pre-match predictions). Skip with --dry-run.
  5. Report    — markdown written to discovery/<season>/FINAL_CROSSCHECK.md,
                 including an Elo plausibility check (final rating vs. how far
                 each team actually went).

Exit status is 1 if any ERROR-level finding remains, so it can gate a deploy.

Run (from worker/, with the service key in the env):
    python -m worldcup_worker.finalize_season --season 2026
"""
from __future__ import annotations

import argparse
import importlib
import logging
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

from . import config, db
from .reconstruct_momentum import ESPN, ESPN_LEAGUE, UA, _score

log = logging.getLogger("finalize_season")

REPO_ROOT = Path(__file__).resolve().parents[2]

# How far each team got → finishing tier (1 = champion … 8 = group exit).
STAGE_TIER = {"final": 2, "third_place": 4, "SF": 4, "QF": 5, "R16": 6, "R32": 7, "group": 8}


class Findings:
    def __init__(self) -> None:
        self.rows: list[tuple[str, str, str]] = []  # (level, section, message)

    def add(self, level: str, section: str, msg: str) -> None:
        self.rows.append((level, section, msg))
        getattr(log, "error" if level == "ERROR" else "warning" if level == "WARN" else "info")(
            "[%s] %s", section, msg
        )

    def ok(self, section: str, msg: str) -> None:
        self.add("OK", section, msg)

    @property
    def errors(self) -> int:
        return sum(1 for lvl, _, _ in self.rows if lvl == "ERROR")


# ── data access ──────────────────────────────────────────────────────────────

def _all(sb, table: str, columns: str, season: int, order: str = "id") -> list[dict]:
    """Page through PostgREST's 1000-row cap."""
    out: list[dict] = []
    start = 0
    while True:
        page = (
            sb.table(table).select(columns).eq("season", season)
            .order(order).range(start, start + 999).execute().data
        )
        out.extend(page)
        if len(page) < 1000:
            return out
        start += 1000


def load(sb, season: int) -> dict[str, Any]:
    teams = {t["id"]: t for t in sb.table("teams").select("id,name,country_code").execute().data}
    matches = (
        sb.table("matches").select("*").eq("season", season)
        .order("kickoff_at").order("id").execute().data
    )
    return {
        "teams": teams,
        "matches": matches,
        "team_seasons": sb.table("team_seasons").select("*").eq("season", season).execute().data,
        "team_stats": _all(sb, "team_match_stats", "match_id,team_id,goals_for,goals_against,xg", season),
        "player_stats": _all(sb, "player_match_stats", "match_id,team_id,player_id,goals,minutes", season),
        "events": _all(sb, "match_events", "match_id,team_id,type,detail,comments", season),
        "lineups": _all(sb, "match_lineups", "match_id,team_id", season, order="match_id"),
    }


def _name(data: dict, team_id: int | None) -> str:
    if team_id is None:
        return "TBD"
    return data["teams"].get(team_id, {}).get("name", str(team_id))


def _label(data: dict, m: dict) -> str:
    return (
        f"{m['kickoff_at'][:10]} {m['stage']:<11} {_name(data, m['home_team_id'])} "
        f"{m['home_score']}–{m['away_score']} {_name(data, m['away_team_id'])}"
        + (f" (pens {m['pen_home']}–{m['pen_away']})" if m.get("pen_home") is not None else "")
        + f" [{m['status_short']}] #{m['id']}"
    )


# ── 2. audit ─────────────────────────────────────────────────────────────────

def audit(data: dict, ref: dict, f: Findings) -> None:
    S = "audit"
    matches = data["matches"]
    if len(matches) == ref["matches"]:
        f.ok(S, f"{len(matches)} fixtures stored")
    else:
        f.add("ERROR", S, f"{len(matches)} fixtures stored, expected {ref['matches']}")

    counts = Counter(m["stage"] for m in matches)
    for stage, want in ref["stage_counts"].items():
        if counts.get(stage, 0) != want:
            f.add("ERROR", S, f"stage {stage}: {counts.get(stage, 0)} fixtures, expected {want}")
    if all(counts.get(s, 0) == n for s, n in ref["stage_counts"].items()):
        f.ok(S, "stage counts match (72 · 16 · 8 · 4 · 2 · 1 · 1)")

    teams = {m["home_team_id"] for m in matches} | {m["away_team_id"] for m in matches}
    teams.discard(None)
    if len(teams) != ref["teams"]:
        f.add("ERROR", S, f"{len(teams)} distinct teams in fixtures, expected {ref['teams']}")
    groups = {m["group_letter"] for m in matches if m["stage"] == "group"}
    if len(groups) != ref["groups"]:
        f.add("ERROR", S, f"{len(groups)} groups, expected {ref['groups']}")

    unfinished = [m for m in matches if m["status"] != "finished"]
    for m in unfinished:
        f.add("ERROR", S, f"not finished (status {m['status']}/{m['status_short']}): {_label(data, m)}")
    if not unfinished:
        f.ok(S, "every fixture is finished — no live or scheduled rows left")

    ts_by_match: dict[int, list[dict]] = defaultdict(list)
    for r in data["team_stats"]:
        ts_by_match[r["match_id"]].append(r)
    ps_by_match: dict[int, list[dict]] = defaultdict(list)
    for r in data["player_stats"]:
        ps_by_match[r["match_id"]].append(r)
    ev_by_match: dict[int, list[dict]] = defaultdict(list)
    for r in data["events"]:
        ev_by_match[r["match_id"]].append(r)
    lu_by_match = Counter(r["match_id"] for r in data["lineups"])

    gaps = 0
    for m in matches:
        if m["status"] != "finished":
            continue
        mid, lbl = m["id"], _label(data, m)
        ts = ts_by_match.get(mid, [])
        if len(ts) != 2:
            f.add("ERROR", S, f"{len(ts)} team_match_stats rows (expected 2): {lbl}"); gaps += 1
            continue
        by_team = {r["team_id"]: r for r in ts}
        h, a = by_team.get(m["home_team_id"]), by_team.get(m["away_team_id"])
        if not h or not a:
            f.add("ERROR", S, f"team_match_stats team ids don't match fixture: {lbl}"); gaps += 1
            continue
        if (h["goals_for"], a["goals_for"]) != (m["home_score"], m["away_score"]):
            f.add("ERROR", S, f"stats goals {h['goals_for']}–{a['goals_for']} ≠ score: {lbl}")
        if h["goals_for"] != a["goals_against"] or a["goals_for"] != h["goals_against"]:
            f.add("ERROR", S, f"opponent join asymmetric: {lbl}")
        if h.get("xg") is None or a.get("xg") is None:
            f.add("WARN", S, f"missing xG: {lbl}")
        if not ps_by_match.get(mid):
            f.add("ERROR", S, f"no player_match_stats: {lbl}"); gaps += 1
        if lu_by_match.get(mid, 0) != 2:
            f.add("WARN", S, f"{lu_by_match.get(mid, 0)} lineups (expected 2): {lbl}")
        evs = ev_by_match.get(mid, [])
        if not evs:
            # A goalless game can legitimately have no Goal events, but every
            # real fixture has subs/cards — an empty list means a missed pull.
            scoreless = (m["home_score"] or 0) + (m["away_score"] or 0) == 0
            f.add("WARN" if scoreless else "ERROR", S, f"no match events: {lbl}")
            gaps += 0 if scoreless else 1
        else:
            goals = [
                e for e in evs
                if e["type"] == "Goal" and e["detail"] != "Missed Penalty"
                and (e["comments"] or "") != "Penalty Shootout"
            ]
            total = (m["home_score"] or 0) + (m["away_score"] or 0)
            if len(goals) != total:
                f.add("ERROR", S, f"{len(goals)} goal events vs {total} goals in score: {lbl}")
        scored = sum((r["goals"] or 0) for r in ps_by_match.get(mid, []))
        if scored > (m["home_score"] or 0) + (m["away_score"] or 0):
            f.add("ERROR", S, f"player goals ({scored}) exceed scoreline: {lbl}")
        if m["stage"] != "group" and m["home_score"] == m["away_score"] and m.get("pen_home") is None:
            f.add("ERROR", S, f"knockout draw without shootout: {lbl}")
    if not gaps:
        f.ok(S, "every finished match has team stats, player stats and events")


# ── 3a. ESPN cross-check ─────────────────────────────────────────────────────

def _espn_events(season_start: str, season_end: str) -> list[dict]:
    rng = f"{season_start.replace('-', '')}-{season_end.replace('-', '')}"
    with httpx.Client(headers=UA, timeout=30) as client:
        r = client.get(f"{ESPN}/{ESPN_LEAGUE}/scoreboard", params={"dates": rng, "limit": 300})
        r.raise_for_status()
        return r.json().get("events", [])


def _espn_result(event: dict) -> dict[str, tuple[int, int | None]]:
    """team displayName → (goals, shootout goals or None)."""
    out: dict[str, tuple[int, int | None]] = {}
    for c in event["competitions"][0]["competitors"]:
        so = c.get("shootoutScore")
        out[c["team"]["displayName"]] = (int(c.get("score") or 0), int(so) if so is not None else None)
    return out


def _match_espn(name: str, espn_names: list[str]) -> str | None:
    scored = sorted(((_score(name, n), n) for n in espn_names), reverse=True)
    if not scored or scored[0][0] == 0 or (len(scored) > 1 and scored[0][0] == scored[1][0]):
        return None
    return scored[0][1]


def espn_crosscheck(data: dict, ref: dict, f: Findings) -> None:
    S = "espn"
    try:
        events = _espn_events(ref["first_kickoff_date"], ref["final_date"])
    except Exception as exc:  # network / provider issue — report, don't crash
        f.add("WARN", S, f"ESPN scoreboard unavailable ({exc}); cross-check skipped")
        return
    f.ok(S, f"{len(events)} ESPN events fetched")
    used: set[str] = set()
    agree = 0
    for m in data["matches"]:
        home, away = _name(data, m["home_team_id"]), _name(data, m["away_team_id"])
        candidates = []
        for e in events:
            if e["id"] in used:
                continue
            res = _espn_result(e)
            names = list(res)
            if len(names) != 2:
                continue
            h, a = _match_espn(home, names), _match_espn(away, names)
            if h and a and h != a:
                ko = datetime.fromisoformat(e["date"].replace("Z", "+00:00"))
                gap = abs((ko - datetime.fromisoformat(m["kickoff_at"])).total_seconds())
                candidates.append((gap, e, res, h, a))
        if not candidates:
            f.add("WARN", S, f"no ESPN event found: {_label(data, m)}")
            continue
        gap, e, res, h, a = min(candidates, key=lambda c: c[0])
        used.add(e["id"])
        (eh, eh_so), (ea, ea_so) = res[h], res[a]
        ours = (m["home_score"], m["away_score"])
        if ours != (eh, ea):
            f.add("ERROR", S, f"score differs — ESPN {h} {eh}–{ea} {a} (event {e['id']}) vs ours: {_label(data, m)}")
            continue
        if eh_so is not None and ea_so is not None and (m.get("pen_home"), m.get("pen_away")) != (eh_so, ea_so):
            f.add("ERROR", S, f"shootout differs — ESPN {eh_so}–{ea_so} (event {e['id']}) vs ours: {_label(data, m)}")
            continue
        if gap > 3 * 3600:
            f.add("WARN", S, f"kickoff differs by {gap / 3600:.1f}h from ESPN event {e['id']}: {_label(data, m)}")
        agree += 1
    level = "OK" if agree == len(data["matches"]) else "WARN"
    f.add(level, S, f"{agree}/{len(data['matches'])} results agree with ESPN")


# ── 3b. reference anchors ────────────────────────────────────────────────────

def anchors(data: dict, refmod, f: Findings, golden_boot: tuple[str, int] | None) -> None:
    S = "anchors"
    ref = refmod.TOURNAMENT
    by_names = {}
    for m in data["matches"]:
        key = (m["stage"], frozenset({_name(data, m["home_team_id"]), _name(data, m["away_team_id"])}))
        by_names[key] = m
    for stage, _date, score, status, _so in refmod.ANCHOR_MATCHES:
        m = by_names.get((stage, frozenset(score)))
        if not m:
            f.add("ERROR", S, f"{stage} {' v '.join(score)} not found in fixtures")
            continue
        ours = {
            _name(data, m["home_team_id"]): m["home_score"],
            _name(data, m["away_team_id"]): m["away_score"],
        }
        if ours != score:
            f.add("ERROR", S, f"{stage}: reference {score} vs stored {ours} (#{m['id']})")
        elif status and m["status_short"] != status:
            f.add("ERROR", S, f"{stage}: status {m['status_short']}, reference {status} (#{m['id']})")
        else:
            f.ok(S, f"{stage}: {' – '.join(f'{t} {g}' for t, g in score.items())} ✓")

    final = next((m for m in data["matches"] if m["stage"] == "final"), None)
    if final and final["status"] == "finished":
        champ = final["home_team_id"] if final["home_winner"] else final["away_team_id"]
        if final["home_winner"] is None:
            f.add("ERROR", S, "final has no winner flag (home_winner is NULL)")
        elif _name(data, champ) != ref["champion"]:
            f.add("ERROR", S, f"champion is {_name(data, champ)}, reference {ref['champion']}")
        else:
            f.ok(S, f"champion: {ref['champion']} ✓")

    gb = refmod.GOLDEN_BOOT
    if golden_boot is None:
        f.add("ERROR", S, "no goalscorers in player_match_stats")
    elif gb["player_name_contains"].lower() not in golden_boot[0].lower() or golden_boot[1] != gb["goals"]:
        f.add("ERROR", S, f"top scorer in owned data is {golden_boot[0]} ({golden_boot[1]}); reference {gb}")
    else:
        f.ok(S, f"Golden Boot: {golden_boot[0]} — {golden_boot[1]} goals ✓")


def top_scorer(sb, data: dict) -> tuple[str, int] | None:
    goals: Counter[int] = Counter()
    for r in data["player_stats"]:
        goals[r["player_id"]] += r["goals"] or 0
    if not goals:
        return None
    pid, n = goals.most_common(1)[0]
    row = sb.table("players").select("name").eq("id", pid).maybe_single().execute()
    return ((row.data or {}).get("name") or str(pid), n) if row else (str(pid), n)


# ── 5. Elo plausibility ──────────────────────────────────────────────────────

def finishing_tiers(data: dict) -> dict[int, int]:
    tier: dict[int, int] = {}
    for m in data["matches"]:
        for t in (m["home_team_id"], m["away_team_id"]):
            if t is not None:
                tier[t] = min(tier.get(t, 8), STAGE_TIER[m["stage"]])
    final = next((m for m in data["matches"] if m["stage"] == "final" and m["status"] == "finished"), None)
    if final and final["home_winner"] is not None:
        tier[final["home_team_id"] if final["home_winner"] else final["away_team_id"]] = 1
    third = next((m for m in data["matches"] if m["stage"] == "third_place" and m["status"] == "finished"), None)
    if third and third["home_winner"] is not None:
        tier[third["home_team_id"] if third["home_winner"] else third["away_team_id"]] = 3
    return tier


def _spearman(xs: list[float], ys: list[float]) -> float:
    def ranks(v: list[float]) -> list[float]:
        order = sorted(range(len(v)), key=lambda i: v[i])
        r = [0.0] * len(v)
        i = 0
        while i < len(order):
            j = i
            while j + 1 < len(order) and v[order[j + 1]] == v[order[i]]:
                j += 1
            for k in range(i, j + 1):
                r[order[k]] = (i + j) / 2 + 1
            i = j + 1
        return r
    rx, ry = ranks(xs), ranks(ys)
    n = len(xs)
    mx, my = sum(rx) / n, sum(ry) / n
    cov = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    vx = sum((a - mx) ** 2 for a in rx) ** 0.5
    vy = sum((b - my) ** 2 for b in ry) ** 0.5
    return cov / (vx * vy) if vx and vy else 0.0


def elo_plausibility(data: dict, team_seasons: list[dict], f: Findings) -> list[str]:
    S = "elo"
    tiers = finishing_tiers(data)
    rows = [
        (ts["team_id"], ts["elo"], ts.get("initial_elo"), tiers.get(ts["team_id"], 8))
        for ts in team_seasons if ts.get("initial_elo") is not None
    ]
    if not rows:
        f.add("WARN", S, "no seeded Elo for this season — plausibility check skipped")
        return []
    rows.sort(key=lambda r: -r[1])
    rho_final = _spearman([-r[1] for r in rows], [r[3] for r in rows])
    rho_gain = _spearman([-(r[1] - r[2]) for r in rows], [r[3] for r in rows])
    f.ok(S, f"Spearman(final Elo rank, finishing tier) = {rho_final:.2f}; "
            f"Spearman(Elo gained, finishing tier) = {rho_gain:.2f}")
    champ_rank = next((i + 1 for i, r in enumerate(rows) if r[3] == 1), None)
    if champ_rank is not None:
        lvl = "OK" if champ_rank <= 3 else "WARN"
        f.add(lvl, S, f"champion ranks #{champ_rank} by final Elo")
    gainers = sorted(rows, key=lambda r: -(r[1] - r[2]))
    top_gain_tiers = [r[3] for r in gainers[:4]]
    f.ok(S, "biggest Elo gainers: " + ", ".join(
        f"{_name(data, r[0])} {r[1] - r[2]:+.0f}" for r in gainers[:4]
    ) + f" (finishing tiers {top_gain_tiers})")
    table = ["| # | Team | Seed | Final | Δ | Went out |", "|---:|---|---:|---:|---:|---|"]
    tier_label = {1: "Champion", 2: "Runner-up", 3: "Third", 4: "Fourth", 5: "Quarter-final",
                  6: "Round of 16", 7: "Round of 32", 8: "Group stage"}
    for i, (tid, elo, init, tier) in enumerate(rows, 1):
        table.append(f"| {i} | {_name(data, tid)} | {init:.0f} | {elo:.0f} | {elo - init:+.0f} | {tier_label[tier]} |")
    return table


# ── report ───────────────────────────────────────────────────────────────────

def write_report(season: int, f: Findings, elo_table: list[str], path: Path) -> None:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    counts = Counter(lvl for lvl, _, _ in f.rows)
    lines = [
        f"# {season} World Cup — final data cross-check",
        "",
        f"Generated {now} by `python -m worldcup_worker.finalize_season --season {season}`.",
        "",
        f"**{counts.get('ERROR', 0)} errors · {counts.get('WARN', 0)} warnings · {counts.get('OK', 0)} checks passed**",
        "",
        "Sources: owned Supabase data (API-Football pipeline) vs. ESPN public scoreboard "
        f"(independent provider) vs. hand-verified anchors in `reference_{season}.py`.",
        "",
    ]
    for section, title in (("audit", "Completeness & consistency"), ("espn", "ESPN cross-check"),
                           ("anchors", "Reference anchors"), ("elo", "Elo plausibility")):
        rows = [r for r in f.rows if r[1] == section]
        if not rows:
            continue
        lines += [f"## {title}", ""]
        for lvl, _, msg in sorted(rows, key=lambda r: {"ERROR": 0, "WARN": 1, "OK": 2}[r[0]]):
            mark = {"ERROR": "❌", "WARN": "⚠️", "OK": "✅"}[lvl]
            lines.append(f"- {mark} {msg}")
        lines.append("")
    if elo_table:
        lines += ["## Final Elo table (sequential replay from FIFA seed)", ""] + elo_table + [""]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")
    log.info("report written to %s", path)


# ── entry point ──────────────────────────────────────────────────────────────

def run(season: int, skip_api: bool, skip_espn: bool, dry_run: bool, report: Path) -> int:
    try:
        refmod = importlib.import_module(f".reference_{season}", __package__)
    except ModuleNotFoundError:
        raise SystemExit(f"no reference_{season}.py — anchors are required to finalize a season")
    ref = refmod.TOURNAMENT
    sb = db.client()
    f = Findings()

    if not skip_api:
        from . import backfill
        log.info("step 1/5 — re-pulling season %s from API-Football (force)", season)
        backfill.run(season, force=True)
        try:
            from . import reconstruct_momentum
            reconstruct_momentum.run(season)  # momentum for matches never live-ingested
        except Exception:
            log.exception("momentum reconstruction failed (non-fatal)")

    log.info("step 2/5 — auditing owned data")
    data = load(sb, season)
    audit(data, ref, f)

    log.info("step 3/5 — cross-checking against ESPN + reference anchors")
    if not skip_espn:
        espn_crosscheck(data, ref, f)
    anchors(data, refmod, f, top_scorer(sb, data))

    if not dry_run:
        log.info("step 4/5 — sequential Elo + Track 3 replay")
        from . import analytics
        analytics.run(season)
    team_seasons = sb.table("team_seasons").select("*").eq("season", season).execute().data

    log.info("step 5/5 — Elo plausibility + report")
    elo_table = elo_plausibility(data, team_seasons, f)
    write_report(season, f, elo_table, report)
    log.info("done: %d errors", f.errors)
    return 1 if f.errors else 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    p = argparse.ArgumentParser(description="Re-pull, audit, cross-check and replay a completed season")
    p.add_argument("--season", type=int, default=config.API_FOOTBALL_SEASON)
    p.add_argument("--skip-api", action="store_true", help="don't re-pull from API-Football")
    p.add_argument("--skip-espn", action="store_true", help="don't cross-check against ESPN")
    p.add_argument("--dry-run", action="store_true", help="audit + cross-check only; no Elo/Track 3 writes")
    p.add_argument("--report", type=Path, default=None)
    a = p.parse_args()
    out = a.report or REPO_ROOT / "discovery" / str(a.season) / "FINAL_CROSSCHECK.md"
    raise SystemExit(run(a.season, a.skip_api, a.skip_espn, a.dry_run, out))
