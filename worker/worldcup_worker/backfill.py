"""Season-parameterized backfill: pull ALL data for one tournament into Supabase.

Reusable, NOT a one-off (PROJECT_SPEC_2.md decision #1): point it at
season=2022 for the demo or season=2026 for the live tournament.

Order: teams → standings (also yields team→group mapping) → matches →
players (+ stored season stats) → batched fixture details for finished
matches (statistics, players, events, lineups via /fixtures?ids=, ~20/call).

Run: python -m worldcup_worker.backfill --season 2022 [--force]
"""

import argparse
import logging

from . import config, db
from .api_football import ApiFootballClient, FINISHED_STATUSES

log = logging.getLogger("backfill")


def run(season: int, force: bool = False) -> None:
    api = ApiFootballClient()
    sb = db.client()
    from . import pipeline

    try:
        pipeline.upsert_teams(sb, api, season)
        team_groups = pipeline.upsert_standings(sb, api, season)

        fixtures = api.fixtures(season)
        pipeline.upsert_matches(sb, fixtures, season, team_groups)

        pipeline.upsert_players(sb, api, season)

        finished_ids = [
            fx["fixture"]["id"]
            for fx in fixtures
            if fx["fixture"]["status"]["short"] in FINISHED_STATUSES
        ]
        log.info("backfilling details for %d finished fixtures (batched)", len(finished_ids))
        ingested = 0
        for fx in api.fixtures_by_ids(finished_ids):
            if pipeline.ingest_fixture_details(sb, fx, season, force=force):
                ingested += 1
        log.info("backfill complete for season %s: %d fixtures ingested", season, ingested)
    finally:
        api.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description="Backfill one World Cup season into Supabase")
    parser.add_argument("--season", type=int, default=config.API_FOOTBALL_SEASON)
    parser.add_argument("--force", action="store_true", help="re-ingest already-finalized fixtures")
    args = parser.parse_args()
    run(args.season, force=args.force)
