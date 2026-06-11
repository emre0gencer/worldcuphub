"""Track 1 + Track 2 ingestion.

Long-running worker loop (NOT a cron job), status-driven per PROJECT_SPEC.md §3:
- Poll the full fixtures list infrequently (FIXTURE_DISCOVERY_INTERVAL) to discover
  which matches just went live.
- Poll only the live matches every LIVE_POLL_INTERVAL, writing a match_snapshots
  row per poll (full time-series kept for momentum charts).
- When a match flips to finished, run the finalize step: copy the last good
  stats into the immutable team_match_stats / player_match_stats tables.

Run: python -m worldcup_worker.ingest
"""

import logging
import time
from datetime import datetime, timezone
from typing import Any

from . import config, db
from .api_football import ApiFootballClient, parse_player_stats, parse_team_stats, status_of

log = logging.getLogger("ingest")


def discover_live_match_ids(api: ApiFootballClient) -> tuple[set[int], dict[int, str]]:
    """One cheap fixtures-list call: live ids + status of every fixture."""
    statuses: dict[int, str] = {}
    for fx in api.fixtures():
        statuses[fx["fixture"]["id"]] = status_of(fx)
    live = {fid for fid, st in statuses.items() if st == "live"}
    return live, statuses


def write_snapshot(api: ApiFootballClient, match_id: int) -> None:
    """One live poll: store the raw stats blob + scores as a Track 1 snapshot."""
    fixture = api.fixture(match_id)
    if fixture is None:
        log.warning("fixture %s not found on live poll", match_id)
        return
    stats = api.fixture_statistics(match_id)
    payload: dict[str, Any] = {
        "fixture": fixture["fixture"],
        "goals": fixture["goals"],
        "statistics": stats,
    }
    sb = db.client()
    sb.table("match_snapshots").insert(
        {
            "match_id": match_id,
            "captured_at": datetime.now(timezone.utc).isoformat(),
            "elapsed_minute": fixture["fixture"]["status"].get("elapsed"),
            "payload": payload,
        }
    ).execute()
    sb.table("matches").update(
        {
            "status": "live",
            "home_score": fixture["goals"]["home"],
            "away_score": fixture["goals"]["away"],
        }
    ).eq("id", match_id).execute()
    log.info("snapshot written for match %s (minute %s)", match_id, fixture["fixture"]["status"].get("elapsed"))


def finalize_match(api: ApiFootballClient, match_id: int) -> None:
    """Finalize step: write the immutable Track 2 dataset once at full-time."""
    sb = db.client()

    existing = (
        sb.table("team_match_stats").select("id").eq("match_id", match_id).limit(1).execute()
    )
    if existing.data:
        log.info("match %s already finalized, skipping", match_id)
        return

    fixture = api.fixture(match_id)
    if fixture is None:
        log.error("cannot finalize %s: fixture not found", match_id)
        return

    goals = {fixture["teams"]["home"]["id"]: fixture["goals"]["home"],
             fixture["teams"]["away"]["id"]: fixture["goals"]["away"]}

    team_rows = []
    for entry in api.fixture_statistics(match_id):
        row = parse_team_stats(entry)
        team_id = row["team_id"]
        opponent_goals = next(g for tid, g in goals.items() if tid != team_id)
        row.update(match_id=match_id, goals_for=goals[team_id], goals_against=opponent_goals)
        team_rows.append(row)

    player_rows = []
    for team_entry in api.fixture_players(match_id):
        for row in parse_player_stats(team_entry):
            row["match_id"] = match_id
            player_rows.append(row)

    if team_rows:
        sb.table("team_match_stats").insert(team_rows).execute()
    if player_rows:
        sb.table("player_match_stats").insert(player_rows).execute()
    sb.table("matches").update(
        {
            "status": "finished",
            "home_score": fixture["goals"]["home"],
            "away_score": fixture["goals"]["away"],
        }
    ).eq("id", match_id).execute()
    log.info("finalized match %s (%d team rows, %d player rows)", match_id, len(team_rows), len(player_rows))


def run() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    api = ApiFootballClient()
    tracked_live: set[int] = set()
    last_discovery = 0.0

    log.info("ingestion worker started")
    while True:
        now = time.monotonic()
        if now - last_discovery >= config.FIXTURE_DISCOVERY_INTERVAL or tracked_live:
            try:
                if now - last_discovery >= config.FIXTURE_DISCOVERY_INTERVAL:
                    live_ids, statuses = discover_live_match_ids(api)
                    last_discovery = now
                    # Matches we were tracking that are no longer live → finalize.
                    for finished_id in tracked_live - live_ids:
                        if statuses.get(finished_id) == "finished":
                            finalize_match(api, finished_id)
                    tracked_live = live_ids

                for match_id in tracked_live:
                    write_snapshot(api, match_id)
            except Exception:
                log.exception("poll cycle failed; retrying next interval")

        time.sleep(config.LIVE_POLL_INTERVAL if tracked_live else config.FIXTURE_DISCOVERY_INTERVAL)


if __name__ == "__main__":
    run()
