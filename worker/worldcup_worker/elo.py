"""Live Elo update module — FIFA 2018 formula, idempotent replay.

Always replays from initial_elo over all finished matches sorted by kickoff_at,
then writes the result to the `elo` column on team_seasons. Never increments on
top of the existing `elo` value, so reruns are always safe.

2026-only: if initial_elo is NULL for all teams in the season (e.g. season=2022),
the function is a no-op and returns immediately.

Run standalone:
    python -m worldcup_worker.elo --season 2026

Also called at the top of analytics.run() so form scores and predictions
always consume up-to-date Elo.

FIFA 2018 formula (scale 600, matches the seed source):
    W_e = 1 / (10^(-(P_home - P_away) / 600) + 1)
    W   = 1.0 win / 0.5 draw / 0.0 loss
          0.75 shootout win / 0.5 shootout loss  (detected via pen_home/pen_away)
    I   = 50 for group/R32/R16, 60 for QF/SF/third_place/final
    Knockout floor: clamp negative delta to 0 (losing team can't lose points).

Note: analytics.predict_match uses /400 in its logit — that is a separate model
coefficient calibrated independently, not a bug.
"""

import argparse
import logging
import math

log = logging.getLogger("elo")

# Importance weights by stage (FIFA 2018 table).
_I: dict[str, int] = {
    "group":       50,
    "R32":         50,
    "R16":         50,
    "QF":          60,
    "SF":          60,
    "third_place": 60,
    "final":       60,
}

# Stages where a team cannot lose Elo (FIFA knockout floor rule).
_KNOCKOUT_STAGES = {"R32", "R16", "QF", "SF", "third_place", "final"}


def result_from_match(m: dict) -> tuple[float, float]:
    """Return (W_home, W_away) from a finished match row.

    Penalty shootout is detected by pen_home/pen_away being non-null:
        shootout winner = 0.75, loser = 0.5  (FIFA rule).
    Regular: 1.0 win / 0.5 draw / 0.0 loss.
    """
    if m["pen_home"] is not None and m["pen_away"] is not None:
        if m["pen_home"] > m["pen_away"]:
            return 0.75, 0.5
        return 0.5, 0.75
    h, a = m["home_score"], m["away_score"]
    if h > a:
        return 1.0, 0.0
    if h < a:
        return 0.0, 1.0
    return 0.5, 0.5


def update_elo(
    elo_home: float,
    elo_away: float,
    w_home: float,
    w_away: float,
    stage: str,
) -> tuple[float, float]:
    """Apply the FIFA 2018 Elo update formula to one match.

    Returns (new_elo_home, new_elo_away).
    Scale is 600 (not 400 — FIFA's own choice for the Elo formula used in seeding).
    """
    importance = _I.get(stage, 50)
    # Expected result for home team given the pre-match Elo gap.
    w_e_home = 1.0 / (10.0 ** (-(elo_home - elo_away) / 600.0) + 1.0)
    w_e_away = 1.0 - w_e_home

    delta_home = importance * (w_home - w_e_home)
    delta_away = importance * (w_away - w_e_away)

    # Knockout floor: losing team cannot have negative delta in knockout rounds.
    if stage in _KNOCKOUT_STAGES:
        delta_home = max(0.0, delta_home)
        delta_away = max(0.0, delta_away)

    return elo_home + delta_home, elo_away + delta_away


def compute_elo(
    initial: dict[int, float],
    matches: list[dict],
) -> dict[int, float]:
    """Pure function: replay all finished matches in chronological order from
    initial Elo values. Returns the final Elo for every team_id in initial.

    matches must be sorted by kickoff_at ascending before calling.
    """
    current = dict(initial)

    for m in matches:
        home_id = m["home_team_id"]
        away_id = m["away_team_id"]
        if home_id not in current or away_id not in current:
            log.warning(
                "match %s: team %s or %s not in Elo table — skipping",
                m["id"], home_id, away_id,
            )
            continue
        if m["home_score"] is None or m["away_score"] is None:
            continue

        w_home, w_away = result_from_match(m)
        stage = m.get("stage", "group")
        new_home, new_away = update_elo(
            current[home_id], current[away_id], w_home, w_away, stage
        )
        current[home_id] = new_home
        current[away_id] = new_away

    return current


def run(season: int) -> None:
    """Replay all finished matches for the season and write updated Elo to DB.

    No-op when initial_elo is NULL for all teams (e.g. season=2022).
    """
    from . import db

    sb = db.client()

    team_seasons = (
        sb.table("team_seasons")
        .select("team_id, initial_elo")
        .eq("season", season)
        .execute()
        .data
    )

    # 2026-only guard: skip if no team has been seeded yet.
    seeded = {r["team_id"]: r["initial_elo"] for r in team_seasons if r["initial_elo"] is not None}
    if not seeded:
        log.info("season %s: no initial_elo found — skipping Elo replay (run seed_elo first)", season)
        return

    matches = (
        sb.table("matches")
        .select("id, home_team_id, away_team_id, home_score, away_score, pen_home, pen_away, stage, kickoff_at")
        .eq("season", season)
        .eq("status", "finished")
        .order("kickoff_at", desc=False)
        .execute()
        .data
    )

    if not matches:
        log.info("season %s: no finished matches yet — Elo stays at seed values", season)
        # Still write initial_elo as current elo (in case seed just ran).
        for team_id, pts in seeded.items():
            sb.table("team_seasons").update({"elo": pts}).eq("team_id", team_id).eq("season", season).execute()
        return

    final_elo = compute_elo(seeded, matches)

    # Batch write: one update per team.
    for team_id, pts in final_elo.items():
        sb.table("team_seasons").update({"elo": round(pts, 4)}).eq("team_id", team_id).eq("season", season).execute()

    log.info(
        "elo replay complete for season %s: %d teams, %d matches processed",
        season, len(final_elo), len(matches),
    )


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )
    from . import config

    parser = argparse.ArgumentParser(
        description="Replay Elo from initial seed over finished matches for one season"
    )
    parser.add_argument("--season", type=int, default=config.API_FOOTBALL_SEASON)
    args = parser.parse_args()
    run(args.season)
