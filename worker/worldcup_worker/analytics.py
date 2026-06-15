"""Track 3 analytics job: Form Scores + the baseline statistical upset model.

The Form Score algorithm is chosen by DATA AVAILABILITY, not season number:

* No xG (baseline-v2-noxg) — used when team_match_stats has no expected_goals
  (2022: API-Football returns no xG for those fixtures, verified in Phase-1
  discovery). The xG terms are scratched and their weight redistributed onto
  goals / shots-on-target / shots:

      A(m) = 0.40·z(adjA_goals) + 0.30·z(adjA_sot) + 0.20·z(adjA_shots)
           + 0.05·z(corners) + 0.05·z(pass_accuracy)
      D(m) = 0.45·z(adjD_goals) + 0.35·z(adjD_sot) + 0.20·z(adjD_shots)

* xG-enriched (baseline-v3-xg) — used when xG is present (2026+). xG-based
  signals dominate the composites (strongest single predictor per research),
  with finishing_delta (goals − own xG) and the API's goals_prevented adding
  unique signal:

      A(m) = 0.35·z(adjA_xg) + 0.20·z(adjA_goals) + 0.15·z(adjA_sot)
           + 0.10·z(adjA_shots) + 0.10·z(finishing_delta)
           + 0.05·z(corners) + 0.05·z(pass_accuracy)
      D(m) = 0.30·z(adjD_xg) + 0.25·z(adjD_goals) + 0.20·z(goals_prevented)
           + 0.15·z(adjD_sot) + 0.10·z(adjD_shots)

  The upset model gains a ΔxGD term (cumulative xG−xGA per match).

All other steps (rolling opponent baselines with Elo-implied matchday-1 prior,
z-score normalization, recency rho=0.7, shrinkage n/(n+2), display scale
clamp(50+15z)) are shared by both. Season-parameterized: the same job serves
2022 (demo) and 2026 (live); 2026 picks up xG automatically.

Run: python -m worldcup_worker.analytics --season 2022
"""

import argparse
import logging
import math
from collections import defaultdict
from datetime import date, datetime, timezone
from statistics import mean, pstdev

log = logging.getLogger("analytics")

# Model version is selected by data availability (see module docstring).
MODEL_VERSION_NOXG = "baseline-v2-noxg"
MODEL_VERSION_XG = "baseline-v3-xg"

RHO = 0.7            # Step 5 recency decay (newest match weight = 1)
SHRINK_K = 2         # Step 6 pseudo-count
ELO_BASE = 1500.0
# Elo-implied prior for matchday-1 baselines: ±10% output per 100 Elo vs base.
ELO_PRIOR_SCALE = 0.10 / 100.0

# Upset model coefficients (calibrate against results as the tournament unfolds).
UPSET_A = 1.0        # no-xG model: Elo weight
UPSET_B = 0.5        # no-xG model: form weight
UPSET_A_XG = 0.8     # xG model: Elo weight
UPSET_B_XG = 0.4     # xG model: form weight
UPSET_C_XG = 0.3     # xG model: ΔxGD weight

# Stats used for opponent rolling baselines. xG joins the set only when present.
BASELINE_STATS_NOXG = ("goals_for", "shots_on_target", "shots")
BASELINE_STATS_XG = ("xg", "goals_for", "shots_on_target", "shots")

# Columns the composites read; None (API "none recorded") is coerced to 0 with a report.
STAT_COLUMNS_NOXG = ("goals_for", "shots_on_target", "shots", "corners", "pass_accuracy")
STAT_COLUMNS_XG = STAT_COLUMNS_NOXG + ("xg", "goals_prevented")


def sigmoid(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-x))


def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def _zscores(values: list[float]) -> list[float]:
    """Step 3 — z-score a series across all team-match rows so far."""
    if not values:
        return []
    mu = mean(values)
    sd = pstdev(values)
    if sd == 0:
        return [0.0 for _ in values]
    return [(v - mu) / sd for v in values]


def _opponent_rows(rows_by_match: dict[int, list[dict]], match_id: int, team_id: int) -> dict:
    """The opponent's row of the same match (join on match_id), per spec §4 note."""
    return next(r for r in rows_by_match[match_id] if r["team_id"] != team_id)


def _baselines(
    prior_rows: list[dict],
    rows_by_match: dict[int, list[dict]],
    global_means: dict[str, float],
    elo: float,
    baseline_stats: tuple[str, ...],
) -> dict[str, float]:
    """Step 1 — rolling baselines for one team over its matches *prior to* the
    one being scored. Returns created (F) and allowed (A) means per stat.

    Matchday 1 fallback: tournament global mean, seeded with an Elo-implied
    prior (stronger teams create more / allow less than the global mean).
    """
    out: dict[str, float] = {}
    if prior_rows:
        for stat in baseline_stats:
            created = [r[stat] for r in prior_rows]
            allowed = [
                _opponent_rows(rows_by_match, r["match_id"], r["team_id"])[stat]
                for r in prior_rows
            ]
            out[f"{stat}_F"] = mean(created)
            out[f"{stat}_A"] = mean(allowed)
    else:
        strength = (elo - ELO_BASE) * ELO_PRIOR_SCALE
        for stat in baseline_stats:
            out[f"{stat}_F"] = global_means[stat] * (1.0 + strength)
            out[f"{stat}_A"] = global_means[stat] * (1.0 - strength)
    return out


def compute_form(
    team_rows: list[dict],
    match_dates: dict[int, datetime],
    team_elo: dict[int, float],
    as_of: date,
    use_xg: bool,
) -> list[dict]:
    """Compute one team_form row per team from finalized team_match_stats rows.

    team_rows: team_match_stats dicts (2 per match).
    match_dates: match_id -> kickoff datetime (for chronological ordering).
    team_elo: current internally-maintained Elo per team.
    use_xg: when True, use the xG-enriched composites (baseline-v3-xg); when
            False, the original no-xG composites (baseline-v2-noxg).
    """
    baseline_stats = BASELINE_STATS_XG if use_xg else BASELINE_STATS_NOXG

    rows = sorted(team_rows, key=lambda r: match_dates[r["match_id"]])
    rows_by_match: dict[int, list[dict]] = defaultdict(list)
    for r in rows:
        rows_by_match[r["match_id"]].append(r)

    global_means = {stat: mean([r[stat] for r in rows]) if rows else 1.0 for stat in baseline_stats}

    rows_by_team: dict[int, list[dict]] = defaultdict(list)
    for r in rows:
        rows_by_team[r["team_id"]].append(r)

    # ── Step 2 — opponent-adjusted per-match performance ────────────────────
    adjusted: list[dict] = []
    for r in rows:
        team_id = r["team_id"]
        opp = _opponent_rows(rows_by_match, r["match_id"], team_id)
        kickoff = match_dates[r["match_id"]]

        def prior(rs: list[dict]) -> list[dict]:
            return [x for x in rs if match_dates[x["match_id"]] < kickoff]

        opp_base = _baselines(
            prior(rows_by_team[opp["team_id"]]), rows_by_match, global_means,
            team_elo[opp["team_id"]], baseline_stats,
        )

        a = {
            "team_id": team_id,
            "match_id": r["match_id"],
            "kickoff": kickoff,
            # Attacking over/under-performance for team T vs opponent OPP
            "adjA_goals": r["goals_for"] - opp_base["goals_for_A"],
            "adjA_sot": r["shots_on_target"] - opp_base["shots_on_target_A"],
            "adjA_shots": r["shots"] - opp_base["shots_A"],
            # Defending: how far below the opponent's usual output T held them
            "adjD_goals": opp_base["goals_for_F"] - opp["goals_for"],
            "adjD_sot": opp_base["shots_on_target_F"] - opp["shots_on_target"],
            "adjD_shots": opp_base["shots_F"] - opp["shots"],
            # Raw, lightly-weighted style/territory signals (not adjusted)
            "corners": r["corners"],
            "pass_accuracy": r["pass_accuracy"],
        }
        if use_xg:
            # xG chance-quality (attacking) and suppression (defending), plus the
            # raw finishing/defensive-overperformance signals.
            a["adjA_xg"] = r["xg"] - opp_base["xg_A"]
            a["adjD_xg"] = opp_base["xg_F"] - opp["xg"]
            a["finishing_delta"] = r["goals_for"] - r["xg"]
            a["goals_prevented"] = r["goals_prevented"]
        adjusted.append(a)

    # ── Step 3 — normalization across all team-match rows so far ───────────
    series_keys = [
        "adjA_goals", "adjA_sot", "adjA_shots",
        "adjD_goals", "adjD_sot", "adjD_shots",
        "corners", "pass_accuracy",
    ]
    if use_xg:
        series_keys += ["adjA_xg", "adjD_xg", "finishing_delta", "goals_prevented"]
    z: dict[str, list[float]] = {k: _zscores([a[k] for a in adjusted]) for k in series_keys}

    # ── Step 4 — per-match composites (weights depend on xG availability) ───
    for i, a in enumerate(adjusted):
        if use_xg:
            a["A"] = (
                0.35 * z["adjA_xg"][i]
                + 0.20 * z["adjA_goals"][i]
                + 0.15 * z["adjA_sot"][i]
                + 0.10 * z["adjA_shots"][i]
                + 0.10 * z["finishing_delta"][i]
                + 0.05 * z["corners"][i]
                + 0.05 * z["pass_accuracy"][i]
            )
            a["D"] = (
                0.30 * z["adjD_xg"][i]
                + 0.25 * z["adjD_goals"][i]
                + 0.20 * z["goals_prevented"][i]
                + 0.15 * z["adjD_sot"][i]
                + 0.10 * z["adjD_shots"][i]
            )
        else:
            a["A"] = (
                0.40 * z["adjA_goals"][i]
                + 0.30 * z["adjA_sot"][i]
                + 0.20 * z["adjA_shots"][i]
                + 0.05 * z["corners"][i]
                + 0.05 * z["pass_accuracy"][i]
            )
            a["D"] = (
                0.45 * z["adjD_goals"][i]
                + 0.35 * z["adjD_sot"][i]
                + 0.20 * z["adjD_shots"][i]
            )

    # ── Steps 5–6 per team → raw finals ─────────────────────────────────────
    by_team: dict[int, list[dict]] = defaultdict(list)
    for a in adjusted:
        by_team[a["team_id"]].append(a)

    team_stats: list[dict] = []
    for team_id, elo in team_elo.items():
        team_matches = sorted(by_team.get(team_id, []), key=lambda a: a["kickoff"])
        n = len(team_matches)

        if n > 0:
            # Step 5 — recency weighting (exponential, oldest→newest i = 1…n)
            weights = [RHO ** (n - i) for i in range(1, n + 1)]
            total_w = sum(weights)
            attack = sum(w * a["A"] for w, a in zip(weights, team_matches)) / total_w
            defend = sum(w * a["D"] for w, a in zip(weights, team_matches)) / total_w
        else:
            attack = defend = 0.0

        # Step 6 — confidence shrinkage toward zero
        shrink = n / (n + SHRINK_K)
        attack_final = shrink * attack
        defend_final = shrink * defend
        overall = 0.5 * attack_final + 0.5 * defend_final
        team_stats.append(
            {
                "team_id": team_id, "elo": elo, "n": n,
                "attack_final": attack_final, "defend_final": defend_final, "overall": overall,
            }
        )

    # ── Step 7 — display mapping ─────────────────────────────────────────────
    if use_xg:
        # Cross-team z-normalization (baseline-v3-xg): the per-match composites
        # are already z-scored, but shrinkage + the attack/defend average compress
        # the team-level spread so the raw composite maps to a narrow band (≈47–54)
        # early in the tournament. Re-z-scoring each final ACROSS TEAMS (using the
        # teams that have actually played as the reference distribution) restores a
        # legible 0–100 spread: tournament average = 50, ±1 std ≈ 65/35.
        def _ref(key: str) -> tuple[float, float]:
            played = [t[key] for t in team_stats if t["n"] > 0]
            mu = mean(played) if played else 0.0
            sd = pstdev(played) if len(played) > 1 else 0.0
            return mu, sd

        refs = {key: _ref(key) for key in ("attack_final", "defend_final", "overall")}

        def _scale(value: float, key: str) -> float:
            mu, sd = refs[key]
            z = (value - mu) / sd if sd > 0 else 0.0
            return clamp(50 + 15 * z, 0, 100)

        def display(t: dict) -> tuple[float, float, float]:
            return (
                _scale(t["overall"], "overall"),
                _scale(t["attack_final"], "attack_final"),
                _scale(t["defend_final"], "defend_final"),
            )
    else:
        # baseline-v2-noxg (unchanged): map the raw composite directly.
        def display(t: dict) -> tuple[float, float, float]:
            return (
                clamp(50 + 15 * t["overall"], 0, 100),
                clamp(50 + 15 * t["attack_final"], 0, 100),
                clamp(50 + 15 * t["defend_final"], 0, 100),
            )

    form_rows: list[dict] = []
    for t in team_stats:
        overall_form, attacking_form, defending_form = display(t)
        form_rows.append(
            {
                "team_id": t["team_id"],
                "as_of_date": as_of.isoformat(),
                "overall_form": overall_form,
                "attacking_form": attacking_form,
                "defending_form": defending_form,
                "elo": t["elo"],
                "sample_size": t["n"],
                # raw composite, used internally by the prediction model
                "_overall_raw": t["overall"],
            }
        )
    return form_rows


def compute_team_xgd(team_rows: list[dict]) -> dict[int, float]:
    """Per-team xG difference per match (own xG − xGA, xGA = opponent xG).
    Used as the third upset-model signal. Only meaningful when xG is present."""
    rows_by_match: dict[int, list[dict]] = defaultdict(list)
    for r in team_rows:
        rows_by_match[r["match_id"]].append(r)
    per_team: dict[int, list[float]] = defaultdict(list)
    for r in team_rows:
        opp = _opponent_rows(rows_by_match, r["match_id"], r["team_id"])
        per_team[r["team_id"]].append((r["xg"] or 0.0) - (opp["xg"] or 0.0))
    return {tid: mean(vals) for tid, vals in per_team.items() if vals}


def predict_match(
    match: dict,
    form_by_team: dict[int, dict],
    team_elo: dict[int, float],
    use_xg: bool = False,
    team_xgd: dict[int, float] | None = None,
) -> dict:
    """Baseline statistical model (spec §5 bonus): Elo + form (+ xGD) logistic.

    upset_prob = 1 - sigmoid(a·(ΔElo/400) + b·ΔOverallForm [+ c·ΔxGD]), Δ taken
    favorite-minus-underdog where the favorite is the higher-Elo side. The xGD
    term is included only when xG data is available (baseline-v3-xg).
    """
    team_xgd = team_xgd or {}
    home, away = match["home_team_id"], match["away_team_id"]
    elo_h, elo_a = team_elo[home], team_elo[away]
    form_h = form_by_team[home]["_overall_raw"]
    form_a = form_by_team[away]["_overall_raw"]
    xgd_h = team_xgd.get(home, 0.0)
    xgd_a = team_xgd.get(away, 0.0)

    if use_xg:
        a_coef, b_coef, c_coef, version = UPSET_A_XG, UPSET_B_XG, UPSET_C_XG, MODEL_VERSION_XG
    else:
        a_coef, b_coef, c_coef, version = UPSET_A, UPSET_B, 0.0, MODEL_VERSION_NOXG

    def logit(elo_x, elo_y, form_x, form_y, xgd_x, xgd_y):
        return (
            a_coef * ((elo_x - elo_y) / 400.0)
            + b_coef * (form_x - form_y)
            + c_coef * (xgd_x - xgd_y)
        )

    if elo_h >= elo_a:
        fav = logit(elo_h, elo_a, form_h, form_a, xgd_h, xgd_a)
    else:
        fav = logit(elo_a, elo_h, form_a, form_h, xgd_a, xgd_h)
    p_favorite = sigmoid(fav)
    upset_prob = 1.0 - p_favorite

    # Decompose into W/D/L: home-vs-away strength on the same scale, with a
    # draw share that grows as the sides get closer.
    p_home_raw = sigmoid(logit(elo_h, elo_a, form_h, form_a, xgd_h, xgd_a))
    draw_prob = 0.18 + 0.12 * (1.0 - abs(2.0 * p_home_raw - 1.0))
    home_win = p_home_raw * (1.0 - draw_prob)
    away_win = (1.0 - p_home_raw) * (1.0 - draw_prob)

    # Transparent goal expectation: tournament-average goals scaled by relative strength.
    avg_goals = 1.3
    predicted_home = avg_goals * (1.0 + 0.5 * (2.0 * p_home_raw - 1.0))
    predicted_away = avg_goals * (1.0 - 0.5 * (2.0 * p_home_raw - 1.0))

    return {
        "match_id": match["id"],
        "home_win_prob": round(home_win, 4),
        "draw_prob": round(draw_prob, 4),
        "away_win_prob": round(away_win, 4),
        "predicted_home_goals": round(max(predicted_home, 0.0), 2),
        "predicted_away_goals": round(max(predicted_away, 0.0), 2),
        "upset_probability": round(upset_prob, 4),
        "model_version": version,
    }


def check_consistency(team_rows: list[dict]) -> None:
    """Spec §4 join note: opponent.goals_for must equal team.goals_against."""
    by_match: dict[int, list[dict]] = defaultdict(list)
    for r in team_rows:
        by_match[r["match_id"]].append(r)
    for match_id, pair in by_match.items():
        if len(pair) != 2:
            log.warning("match %s has %d stat rows (expected 2)", match_id, len(pair))
            continue
        a, b = pair
        if a["goals_for"] != b["goals_against"] or b["goals_for"] != a["goals_against"]:
            log.error("consistency check failed for match %s", match_id)


def _coerce_nulls(team_rows: list[dict], stat_columns: tuple[str, ...]) -> None:
    """API uses null for 'none recorded'; the math needs numbers. Reported, not silent."""
    nulled = 0
    for r in team_rows:
        for col in stat_columns:
            if r[col] is None:
                r[col] = 0.0
                nulled += 1
    if nulled:
        log.warning("coerced %d null stat values to 0 across %d rows", nulled, len(team_rows))


def run(season: int) -> None:
    """Scheduled batch job: read accumulated stats for one season, recompute
    Form Scores, run the model, write team_form + predictions."""
    from . import db, elo as elo_module  # imported here so pure functions stay env-free

    # Update Elo from initial seed + all finished matches before computing form.
    # No-op for 2022 (initial_elo is NULL → elo_module.run returns immediately).
    elo_module.run(season)

    sb = db.client()
    team_seasons = (
        sb.table("team_seasons").select("team_id, elo").eq("season", season).execute().data
    )
    team_rows = (
        sb.table("team_match_stats").select("*").eq("season", season).execute().data
    )
    matches = (
        sb.table("matches")
        .select("id, season, home_team_id, away_team_id, kickoff_at, status")
        .eq("season", season)
        .execute()
        .data
    )

    # Data-driven model selection: use the xG-enriched algorithm iff the season's
    # finalized stats actually carry xG (2026+); 2022 falls back to no-xG.
    use_xg = any(r.get("xg") is not None for r in team_rows)
    stat_columns = STAT_COLUMNS_XG if use_xg else STAT_COLUMNS_NOXG
    model_version = MODEL_VERSION_XG if use_xg else MODEL_VERSION_NOXG

    check_consistency(team_rows)
    _coerce_nulls(team_rows, stat_columns)

    match_dates = {m["id"]: datetime.fromisoformat(m["kickoff_at"]) for m in matches}
    team_elo = {t["team_id"]: t["elo"] for t in team_seasons}
    as_of = datetime.now(timezone.utc).date()

    form_rows = compute_form(team_rows, match_dates, team_elo, as_of, use_xg)
    form_by_team = {f["team_id"]: f for f in form_rows}
    team_xgd = compute_team_xgd(team_rows) if use_xg else {}

    db_rows = [
        {**{k: v for k, v in f.items() if not k.startswith("_")}, "season": season}
        for f in form_rows
    ]
    sb.table("team_form").upsert(db_rows, on_conflict="team_id,season,as_of_date").execute()
    log.info("wrote %d team_form rows for season %s as of %s", len(db_rows), season, as_of)

    upcoming = [
        m for m in matches
        if m["status"] == "scheduled" and m["home_team_id"] and m["away_team_id"]
    ]
    predictions = [
        {**predict_match(m, form_by_team, team_elo, use_xg, team_xgd), "season": season}
        for m in upcoming
    ]
    if predictions:
        sb.table("predictions").insert(predictions).execute()
    log.info("wrote %d predictions for season %s (%s)", len(predictions), season, model_version)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    from . import config

    parser = argparse.ArgumentParser(description="Recompute Form Scores + predictions for one season")
    parser.add_argument("--season", type=int, default=config.API_FOOTBALL_SEASON)
    args = parser.parse_args()
    run(args.season)
