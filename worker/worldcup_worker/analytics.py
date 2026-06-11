"""Track 3 analytics job: Form Scores + the baseline statistical upset model.

Implements PROJECT_SPEC.md §5 exactly. The computation is written as pure
functions over plain dict rows so the same code drives both the scheduled
batch job (reading/writing Supabase) and offline mock-data generation.

Run: python -m worldcup_worker.analytics
"""

import logging
import math
from collections import defaultdict
from datetime import date, datetime, timezone
from statistics import mean, pstdev
from typing import Any

log = logging.getLogger("analytics")

MODEL_VERSION = "baseline-v1"

RHO = 0.7            # Step 5 recency decay (newest match weight = 1)
SHRINK_K = 2         # Step 6 pseudo-count
ELO_BASE = 1500.0
# Elo-implied prior for matchday-1 baselines: ±10% output per 100 Elo vs base.
ELO_PRIOR_SCALE = 0.10 / 100.0

# Upset model coefficients (calibrate against results as the tournament unfolds).
UPSET_A = 1.0
UPSET_B = 0.5

# Stats used for opponent baselines: (column, created-vs-allowed handled via row sides)
BASELINE_STATS = ("xg", "goals_for", "shots_on_target", "shots")


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
) -> dict[str, float]:
    """Step 1 — rolling baselines for one team over its matches *prior to* the
    one being scored. Returns created (F) and allowed (A) means per stat.

    Matchday 1 fallback: tournament global mean, seeded with an Elo-implied
    prior (stronger teams create more / allow less than the global mean).
    """
    out: dict[str, float] = {}
    if prior_rows:
        for stat in BASELINE_STATS:
            created = [r[stat] for r in prior_rows]
            allowed = [
                _opponent_rows(rows_by_match, r["match_id"], r["team_id"])[stat]
                for r in prior_rows
            ]
            out[f"{stat}_F"] = mean(created)
            out[f"{stat}_A"] = mean(allowed)
    else:
        strength = (elo - ELO_BASE) * ELO_PRIOR_SCALE
        for stat in BASELINE_STATS:
            out[f"{stat}_F"] = global_means[stat] * (1.0 + strength)
            out[f"{stat}_A"] = global_means[stat] * (1.0 - strength)
    return out


def compute_form(
    team_rows: list[dict],
    match_dates: dict[int, datetime],
    team_elo: dict[int, float],
    as_of: date,
) -> list[dict]:
    """Compute one team_form row per team from finalized team_match_stats rows.

    team_rows: team_match_stats dicts (2 per match).
    match_dates: match_id -> kickoff datetime (for chronological ordering).
    team_elo: current internally-maintained Elo per team.
    """
    rows = sorted(team_rows, key=lambda r: match_dates[r["match_id"]])
    rows_by_match: dict[int, list[dict]] = defaultdict(list)
    for r in rows:
        rows_by_match[r["match_id"]].append(r)

    global_means = {stat: mean([r[stat] for r in rows]) if rows else 1.0 for stat in BASELINE_STATS}

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
            prior(rows_by_team[opp["team_id"]]), rows_by_match, global_means, team_elo[opp["team_id"]]
        )

        adjusted.append(
            {
                "team_id": team_id,
                "match_id": r["match_id"],
                "kickoff": kickoff,
                # Attacking over/under-performance for team T vs opponent OPP
                "adjA_xg": r["xg"] - opp_base["xg_A"],
                "adjA_goals": r["goals_for"] - opp_base["goals_for_A"],
                "adjA_sot": r["shots_on_target"] - opp_base["shots_on_target_A"],
                "adjA_shots": r["shots"] - opp_base["shots_A"],
                # Defending: how far below the opponent's usual output T held them
                "adjD_xg": opp_base["xg_F"] - opp["xg"],
                "adjD_goals": opp_base["goals_for_F"] - opp["goals_for"],
                "adjD_sot": opp_base["shots_on_target_F"] - opp["shots_on_target"],
                "adjD_shots": opp_base["shots_F"] - opp["shots"],
                # Raw, lightly-weighted style/territory signals (not adjusted)
                "corners": r["corners"],
                "pass_accuracy": r["pass_accuracy"],
            }
        )

    # ── Step 3 — normalization across all team-match rows so far ───────────
    series_keys = [
        "adjA_xg", "adjA_goals", "adjA_sot", "adjA_shots",
        "adjD_xg", "adjD_goals", "adjD_sot", "adjD_shots",
        "corners", "pass_accuracy",
    ]
    z: dict[str, list[float]] = {k: _zscores([a[k] for a in adjusted]) for k in series_keys}

    # ── Step 4 — per-match composites ───────────────────────────────────────
    for i, a in enumerate(adjusted):
        a["A"] = (
            0.35 * z["adjA_xg"][i]
            + 0.25 * z["adjA_goals"][i]
            + 0.20 * z["adjA_sot"][i]
            + 0.10 * z["adjA_shots"][i]
            + 0.05 * z["corners"][i]
            + 0.05 * z["pass_accuracy"][i]
        )
        a["D"] = (
            0.40 * z["adjD_xg"][i]
            + 0.30 * z["adjD_goals"][i]
            + 0.20 * z["adjD_sot"][i]
            + 0.10 * z["adjD_shots"][i]
        )

    # ── Steps 5–7 per team ──────────────────────────────────────────────────
    form_rows: list[dict] = []
    by_team: dict[int, list[dict]] = defaultdict(list)
    for a in adjusted:
        by_team[a["team_id"]].append(a)

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

        # Step 7 — overall + display mapping (average team = 50, +1 std ≈ 65)
        overall = 0.5 * attack_final + 0.5 * defend_final

        form_rows.append(
            {
                "team_id": team_id,
                "as_of_date": as_of.isoformat(),
                "overall_form": clamp(50 + 15 * overall, 0, 100),
                "attacking_form": clamp(50 + 15 * attack_final, 0, 100),
                "defending_form": clamp(50 + 15 * defend_final, 0, 100),
                "elo": elo,
                "sample_size": n,
                # raw z-scale value, used internally by the prediction model
                "_overall_raw": overall,
            }
        )
    return form_rows


def predict_match(
    match: dict,
    form_by_team: dict[int, dict],
    team_elo: dict[int, float],
) -> dict:
    """Baseline statistical model (spec §5 bonus): Elo + form logistic.

    upset_prob = 1 - sigmoid(a·(ΔElo/400) + b·ΔOverallForm), Δ taken
    favorite-minus-underdog where the favorite is the higher-Elo side.
    """
    home, away = match["home_team_id"], match["away_team_id"]
    elo_h, elo_a = team_elo[home], team_elo[away]
    form_h = form_by_team[home]["_overall_raw"]
    form_a = form_by_team[away]["_overall_raw"]

    if elo_h >= elo_a:
        fav_elo_delta, fav_form_delta = elo_h - elo_a, form_h - form_a
    else:
        fav_elo_delta, fav_form_delta = elo_a - elo_h, form_a - form_h
    p_favorite = sigmoid(UPSET_A * (fav_elo_delta / 400.0) + UPSET_B * fav_form_delta)
    upset_prob = 1.0 - p_favorite

    # Decompose into W/D/L: home-vs-away strength on the same scale, with a
    # draw share that grows as the sides get closer.
    p_home_raw = sigmoid(UPSET_A * ((elo_h - elo_a) / 400.0) + UPSET_B * (form_h - form_a))
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
        "model_version": MODEL_VERSION,
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


def run() -> None:
    """Scheduled batch job: read accumulated stats, recompute Form Scores,
    run the model, write team_form + predictions."""
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    from . import db  # imported here so pure functions stay env-free

    sb = db.client()
    teams = sb.table("teams").select("id, elo").execute().data
    team_rows = sb.table("team_match_stats").select("*").execute().data
    matches = sb.table("matches").select("id, home_team_id, away_team_id, kickoff_at, status").execute().data

    check_consistency(team_rows)

    match_dates = {m["id"]: datetime.fromisoformat(m["kickoff_at"]) for m in matches}
    team_elo = {t["id"]: t["elo"] for t in teams}
    as_of = datetime.now(timezone.utc).date()

    form_rows = compute_form(team_rows, match_dates, team_elo, as_of)
    form_by_team = {f["team_id"]: f for f in form_rows}

    db_rows = [{k: v for k, v in f.items() if not k.startswith("_")} for f in form_rows]
    sb.table("team_form").upsert(db_rows, on_conflict="team_id,as_of_date").execute()
    log.info("wrote %d team_form rows as of %s", len(db_rows), as_of)

    upcoming = [
        m for m in matches
        if m["status"] == "scheduled" and m["home_team_id"] and m["away_team_id"]
    ]
    predictions = [predict_match(m, form_by_team, team_elo) for m in upcoming]
    if predictions:
        sb.table("predictions").insert(predictions).execute()
    log.info("wrote %d predictions (%s)", len(predictions), MODEL_VERSION)


if __name__ == "__main__":
    run()
