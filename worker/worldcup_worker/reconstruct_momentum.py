"""Reconstruct in-play momentum for matches that were never live-ingested.

The ingest worker crash-looped before most 2026 kickoffs, so `match_snapshots`
is empty for ~36/40 finished matches and the momentum charts have nothing to
draw. Final stats were recovered by backfill, but the per-minute progression is
gone and API-Football has no historical per-minute endpoint.

ESPN's open match-commentary feed timestamps every shot, corner and foul as a
discrete, team-attributed event. We rebuild REAL per-team, per-minute cumulative
series for the metrics ESPN reports as events:

    total_shots · shots_on_target · corners · fouls

xG and passes are deliberately NOT reconstructed — ESPN has no per-event source
for them, so any series would be estimation rather than real data. Parsed counts
are cross-checked against ESPN's own final boxscore; mismatches are logged.

Writes one row per (match_id, metric) into `match_momentum` (migration 0005).
Idempotent (upsert). Read by the frontend only as a fallback when there are no
snapshots. 2026-only in practice (2022 was fully backfilled with snapshots).

Run: python -m worldcup_worker.reconstruct_momentum --season 2026 [--match-id N] [--dry-run]
"""
from __future__ import annotations

import argparse
import logging
import re
from datetime import date, timedelta
from typing import Any

import httpx

from . import config, db

log = logging.getLogger("reconstruct_momentum")

ESPN_LEAGUE = "fifa.world"
ESPN = "https://site.api.espn.com/apis/site/v2/sports/soccer"
UA = {"User-Agent": "Mozilla/5.0", "Accept": "application/json"}

# ESPN's commentary spelling sometimes differs from both our DB name AND ESPN's
# own header (e.g. header "Ivory Coast" but commentary "Côte d'Ivoire"). Aliases
# cover the cases the scorer below can't (no shared words / pure acronym). Spellings
# that merely differ are caught by substring/word-overlap (e.g. Cabo↔Cape Verde,
# Bosnia-Herzegovina↔Bosnia & Herzegovina), so they need no entry.
ALIASES = {
    "usa": "united states",
    "côte d'ivoire": "ivory coast",
    "cote d'ivoire": "ivory coast",
}

# A shot reaches keeper / net / woodwork — ESPN counts all of these in totalShots.
SHOT_RE = re.compile(r"^(Attempt (saved|missed|blocked)|Goal!|Penalty (saved|missed))")
WOODWORK_RE = re.compile(r"hits the (?:left |right )?(?:post|bar|crossbar|woodwork)")
# ESPN counts handballs in foulsCommitted; commentary writes them separately.
FOUL_RE = re.compile(r"^(Foul by|Hand ?ball by)")

METRICS = ("total_shots", "shots_on_target", "corners", "fouls")

# Geographic prefixes too common to disambiguate on their own (e.g. "South
# Korea" vs "South Africa") — excluded from the word-overlap signal.
_STOPWORDS = {"south", "north", "republic", "islands", "united", "and"}


def _norm(name: str) -> str:
    s = (name or "").strip().lower()
    return ALIASES.get(s, s)


def _words(name: str) -> set[str]:
    return {w for w in re.split(r"[\s&\-]+", _norm(name)) if len(w) > 3 and w not in _STOPWORDS}


def _score(a: str, b: str) -> int:
    """Similarity of two team names: exact > substring > shared significant words."""
    na, nb = _norm(a), _norm(b)
    if not na or not nb:
        return 0
    if na == nb:
        return 100
    if na in nb or nb in na:
        return 50
    return len(_words(a) & _words(b))


def _names_match(a: str, b: str) -> bool:
    return _score(a, b) > 0


def _best_side(token: str, home: str, away: str) -> str | None:
    """Resolve a commentary team token to our home/away by best score, requiring
    an unambiguous winner — handles ESPN's spelling drift without false hits."""
    sh, sa = _score(token, home), _score(token, away)
    if sh == 0 and sa == 0:
        return None
    if sh == sa:
        return None
    return "home" if sh > sa else "away"


def _parse_minute(disp: str) -> int:
    """'21'' -> 21 ; '45'+2'' -> 47 ; '90'+9'' -> 99."""
    m = re.match(r"(\d+)'?(?:\+(\d+))?", (disp or "").strip())
    return int(m.group(1)) + (int(m.group(2)) if m and m.group(2) else 0) if m else 0


# ── ESPN access ──────────────────────────────────────────────────────────────

def _find_espn_game(client: httpx.Client, kickoff_date: str, home: str, away: str) -> str | None:
    """kickoff_at is UTC; ESPN's scoreboard is keyed by US-local date, so a
    late-UTC kickoff lands on the previous US day. Scan a ±1-day window."""
    y, m, d = (int(x) for x in kickoff_date.split("-"))
    base = date(y, m, d)
    events: list[dict[str, Any]] = []
    for delta in (0, -1, 1):
        day = (base + timedelta(days=delta)).strftime("%Y%m%d")
        try:
            r = client.get(f"{ESPN}/{ESPN_LEAGUE}/scoreboard", params={"dates": day})
            r.raise_for_status()
            events.extend(r.json().get("events", []))
        except Exception:
            continue
    for e in events:
        names = [c["team"]["displayName"] for c in e["competitions"][0]["competitors"]]
        if len(names) != 2:
            continue
        n0, n1 = names
        if (_names_match(home, n0) and _names_match(away, n1)) or (
            _names_match(home, n1) and _names_match(away, n0)
        ):
            return e["id"]
    return None


def _summary(client: httpx.Client, game_id: str) -> dict[str, Any]:
    r = client.get(f"{ESPN}/{ESPN_LEAGUE}/summary", params={"event": game_id})
    r.raise_for_status()
    return r.json()


# ── parse + build series ─────────────────────────────────────────────────────

def _side_of(text: str, home: str, away: str, group: bool) -> str | None:
    """Resolve the team a commentary line belongs to. `group=True` reads the
    first '(Team)' group (shots/fouls); otherwise the 'Corner, Team.' name."""
    if group:
        m = re.search(r"\(([^)]+)\)", text)
    else:
        m = re.match(r"Corner,\s*([^.]+)\.", text)
    token = m.group(1) if m else ""
    return _best_side(token, home, away) if token else None


def _events(summary: dict[str, Any], home: str, away: str) -> dict[str, list[tuple[int, str]]]:
    """Return {metric: [(minute, side), ...]} for the four event metrics."""
    out: dict[str, list[tuple[int, str]]] = {m: [] for m in METRICS}
    for c in summary.get("commentary", []):
        text = c.get("text", "")
        minute = _parse_minute(c.get("time", {}).get("displayValue", ""))
        if SHOT_RE.match(text) or WOODWORK_RE.search(text):
            side = _side_of(text, home, away, group=True)
            if side:
                out["total_shots"].append((minute, side))
                if text.startswith("Goal!") or text.startswith("Attempt saved") or text.startswith("Penalty saved"):
                    out["shots_on_target"].append((minute, side))
        elif text.startswith("Corner"):
            side = _side_of(text, home, away, group=False)
            if side:
                out["corners"].append((minute, side))
        elif FOUL_RE.match(text):
            side = _side_of(text, home, away, group=True)
            if side:
                out["fouls"].append((minute, side))
    return out


def _cumulative(events: list[tuple[int, str]]) -> list[dict[str, int]]:
    h = a = 0
    pts = [{"minute": 0, "home": 0, "away": 0}]
    for minute, side in sorted(events, key=lambda e: e[0]):
        if side == "home":
            h += 1
        else:
            a += 1
        pts.append({"minute": minute, "home": h, "away": a})
    return pts


def _crosscheck(summary: dict[str, Any], home: str, away: str, series: dict[str, list]) -> None:
    box: dict[str, dict[str, Any]] = {}
    for t in summary.get("boxscore", {}).get("teams", []):
        name = t.get("team", {}).get("displayName", "")
        side = "home" if _names_match(home, name) else "away" if _names_match(away, name) else None
        if side:
            box[side] = {s["name"]: s["displayValue"] for s in t.get("statistics", [])}
    espn_key = {"total_shots": "totalShots", "shots_on_target": "shotsOnTarget",
                "corners": "wonCorners", "fouls": "foulsCommitted"}
    for metric, key in espn_key.items():
        final = series[metric][-1] if series[metric] else {"home": 0, "away": 0}
        for side in ("home", "away"):
            got = final[side]
            exp = box.get(side, {}).get(key)
            if exp is not None and str(got) != str(exp):
                log.warning("  %s %s: parsed %s vs ESPN boxscore %s", metric, side, got, exp)


# ── DB ───────────────────────────────────────────────────────────────────────

def _missed_matches(sb, season: int) -> list[dict[str, Any]]:
    """Finished matches for the season that have NO snapshot rows."""
    finished = (
        sb.table("matches")
        .select(
            "id,kickoff_at,"
            "home:teams!matches_home_team_id_fkey(name),"
            "away:teams!matches_away_team_id_fkey(name)"
        )
        .eq("season", season)
        .eq("status", "finished")
        .order("kickoff_at", desc=False)
        .execute()
    )
    snap = sb.table("match_snapshots").select("match_id").eq("season", season).execute()
    have = {r["match_id"] for r in snap.data}
    return [m for m in finished.data if m["id"] not in have]


def run(season: int, only_match_id: int | None = None, dry_run: bool = False) -> None:
    sb = db.client()
    matches = _missed_matches(sb, season)
    if only_match_id is not None:
        matches = [m for m in matches if m["id"] == only_match_id]
    log.info("%d match(es) without snapshots to reconstruct (season %s)", len(matches), season)

    written = skipped = 0
    with httpx.Client(headers=UA, timeout=30) as client:
        for m in matches:
            home = (m.get("home") or {}).get("name")
            away = (m.get("away") or {}).get("name")
            if not home or not away:
                log.info("match %s: teams not set, skipping", m["id"])
                skipped += 1
                continue
            kickoff = m["kickoff_at"][:10]
            game_id = _find_espn_game(client, kickoff, home, away)
            if not game_id:
                log.warning("match %s (%s v %s): no ESPN game found, skipping", m["id"], home, away)
                skipped += 1
                continue
            summary = _summary(client, game_id)
            events = _events(summary, home, away)
            series = {metric: _cumulative(events[metric]) for metric in METRICS}
            _crosscheck(summary, home, away, series)

            finals = {metric: series[metric][-1] for metric in METRICS}
            log.info(
                "match %s (%s v %s) espn=%s — shots %s-%s, on-target %s-%s, corners %s-%s, fouls %s-%s",
                m["id"], home, away, game_id,
                finals["total_shots"]["home"], finals["total_shots"]["away"],
                finals["shots_on_target"]["home"], finals["shots_on_target"]["away"],
                finals["corners"]["home"], finals["corners"]["away"],
                finals["fouls"]["home"], finals["fouls"]["away"],
            )
            if dry_run:
                continue
            rows = [
                {"match_id": m["id"], "season": season, "metric": metric,
                 "source": "espn-commentary", "points": series[metric]}
                for metric in METRICS
            ]
            sb.table("match_momentum").upsert(rows, on_conflict="match_id,metric").execute()
            written += 1

    log.info("done: %d match(es) written, %d skipped%s", written, skipped, " (dry run)" if dry_run else "")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    p = argparse.ArgumentParser(description="Reconstruct momentum from ESPN commentary")
    p.add_argument("--season", type=int, default=config.API_FOOTBALL_SEASON)
    p.add_argument("--match-id", type=int, help="only this match")
    p.add_argument("--dry-run", action="store_true", help="fetch + parse + log, do not write")
    args = p.parse_args()
    run(args.season, only_match_id=args.match_id, dry_run=args.dry_run)
