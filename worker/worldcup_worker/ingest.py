"""Track 1 + Track 2 ingestion.

Long-running worker loop (NOT a cron job), status-driven per PROJECT_SPEC.md §3:
- Poll the full fixtures list infrequently (FIXTURE_DISCOVERY_INTERVAL) to discover
  which matches just went live.
- Poll only the live matches every LIVE_POLL_INTERVAL, writing a match_snapshots
  row per poll (full time-series kept for momentum charts).
- When a match flips to finished, run the finalize step via the shared pipeline:
  immutable team/player stats + events + lineups, same code as the backfill.

Season comes from API_FOOTBALL_SEASON (default 2026).

Run: python -m worldcup_worker.ingest
"""

import logging
import time
from datetime import datetime, timezone
from typing import Any

from . import config, db, pipeline
from .api_football import ApiFootballClient, status_of

log = logging.getLogger("ingest")

SEASON = config.API_FOOTBALL_SEASON


def discover_live_match_ids(api: ApiFootballClient) -> tuple[set[int], dict[int, str]]:
    """One cheap fixtures-list call: live ids + status of every fixture."""
    statuses: dict[int, str] = {}
    for fx in api.fixtures(SEASON):
        statuses[fx["fixture"]["id"]] = status_of(fx)
    live = {fid for fid, st in statuses.items() if st == "live"}
    return live, statuses


def _update_match_row(sb, fx: dict[str, Any]) -> None:
    """Refresh the volatile match columns (status_short is the source of truth;
    the `status` column is generated in Postgres and never written)."""
    score = fx["score"]
    sb.table("matches").update(
        {
            "status_short": fx["fixture"]["status"]["short"],
            "home_score": fx["goals"]["home"],
            "away_score": fx["goals"]["away"],
            "ht_home": score["halftime"]["home"],
            "ht_away": score["halftime"]["away"],
            "ft_home": score["fulltime"]["home"],
            "ft_away": score["fulltime"]["away"],
            "pen_home": score["penalty"]["home"],
            "pen_away": score["penalty"]["away"],
            "home_winner": fx["teams"]["home"]["winner"],
        }
    ).eq("id", fx["fixture"]["id"]).execute()


def write_snapshots(api: ApiFootballClient, match_ids: set[int]) -> None:
    """One live poll for ALL tracked matches: a single batched /fixtures?ids=
    call (chunked by 20) returns goals + statistics for every live match, so
    peak quota is ~1 call/cycle regardless of how many matches are live."""
    if not match_ids:
        return
    rows = api.fixtures_by_ids(sorted(match_ids))
    captured_at = datetime.now(timezone.utc).isoformat()
    sb = db.client()
    seen: set[int] = set()
    for fx in rows:
        match_id = fx["fixture"]["id"]
        seen.add(match_id)
        payload: dict[str, Any] = {
            "fixture": fx["fixture"],
            "goals": fx["goals"],
            "statistics": fx["statistics"],
        }
        sb.table("match_snapshots").insert(
            {
                "match_id": match_id,
                "season": SEASON,
                "captured_at": captured_at,
                "elapsed_minute": fx["fixture"]["status"].get("elapsed"),
                "payload": payload,
            }
        ).execute()
        _update_match_row(sb, fx)
        log.info("snapshot written for match %s (minute %s)", match_id, fx["fixture"]["status"].get("elapsed"))
    for missing in match_ids - seen:
        log.warning("fixture %s not found on live poll", missing)


def finalize_match(api: ApiFootballClient, match_id: int) -> None:
    """Finalize step: write the immutable Track 2 dataset once at full-time."""
    rows = api.fixtures_by_ids([match_id])
    if not rows:
        log.error("cannot finalize %s: fixture not found", match_id)
        return
    fx = rows[0]
    sb = db.client()
    pipeline.ingest_fixture_details(sb, fx, SEASON)
    _update_match_row(sb, fx)
    log.info("finalized match %s", match_id)


def run() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    api = ApiFootballClient()
    tracked_live: set[int] = set()
    last_discovery = 0.0

    log.info("ingestion worker started (season %s)", SEASON)
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

                write_snapshots(api, tracked_live)
            except Exception:
                log.exception("poll cycle failed; retrying next interval")

        time.sleep(config.LIVE_POLL_INTERVAL if tracked_live else config.FIXTURE_DISCOVERY_INTERVAL)


if __name__ == "__main__":
    run()
