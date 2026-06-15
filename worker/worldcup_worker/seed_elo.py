"""Seed initial_elo, fifa_points, and elo for all 2026 World Cup teams.

Run ONCE after backfill creates team_seasons rows, before analytics:

    python -m worldcup_worker.seed_elo --season 2026

Idempotent: always resets all three columns from the FIFA reference list —
safe to re-run if the reference data is corrected.

2026-only: 2022 team_seasons rows are never touched.
"""

import argparse
import logging

from . import config, db
from .fifa_points_2026 import lookup

log = logging.getLogger("seed_elo")


def run(season: int) -> None:
    sb = db.client()

    # Load all teams in this season (team_seasons joined with teams for name/code).
    rows = (
        sb.table("team_seasons")
        .select("team_id, teams(id, name, country_code)")
        .eq("season", season)
        .execute()
        .data
    )

    if not rows:
        log.warning("no team_seasons rows found for season %s — run backfill first", season)
        return

    updates: list[dict] = []
    warned: list[str] = []

    for row in rows:
        team = row["teams"]
        name: str = team["name"]
        code: str | None = team.get("country_code")

        hit = lookup(code, name)
        if hit is None:
            warned.append(f"{name} (code={code!r}) — defaulting to 1500")
            pts = 1500.0
        else:
            _, canonical, pts = hit

        updates.append(
            {
                "team_id": row["team_id"],
                "season": season,
                "initial_elo": pts,
                "fifa_points": pts,
                "elo": pts,
            }
        )

    for info in warned:
        log.warning("no FIFA points found for %s", info)

    # Upsert: initial_elo and fifa_points are frozen seeds; elo is also reset
    # here so it starts from the seed before live elo.py replays matches on top.
    sb.table("team_seasons").upsert(
        updates, on_conflict="team_id,season"
    ).execute()

    log.info(
        "seeded %d teams for season %s (%d warnings)",
        len(updates), season, len(warned),
    )


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )
    parser = argparse.ArgumentParser(
        description="Seed initial_elo + fifa_points for one season from the FIFA reference list"
    )
    parser.add_argument("--season", type=int, default=config.API_FOOTBALL_SEASON)
    args = parser.parse_args()
    run(args.season)
