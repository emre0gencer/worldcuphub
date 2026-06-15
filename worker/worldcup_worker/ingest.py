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


def write_snapshots(api: ApiFootballClient, match_ids: set[int]) -> set[str]:
    """One live poll for ALL tracked matches: a single batched /fixtures?ids=
    call (chunked by 20) returns goals + statistics for every live match, so
    peak quota is ~1 call/cycle regardless of how many matches are live.
    Returns the set of status_short values seen (used by the caller to decide
    whether to back off the poll interval during halftime)."""
    if not match_ids:
        return set()
    rows = api.fixtures_by_ids(sorted(match_ids))
    captured_at = datetime.now(timezone.utc).isoformat()
    sb = db.client()
    seen: set[int] = set()
    status_shorts: set[str] = set()
    for fx in rows:
        match_id = fx["fixture"]["id"]
        seen.add(match_id)
        status_short = fx["fixture"]["status"].get("short", "")
        status_shorts.add(status_short)
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
    return status_shorts


# Statuses where match action is paused — stats don't update, safe to back off.
_PAUSED_STATUSES = {"HT", "BT", "INT", "SUSP"}


def seconds_until_next_kickoff(season: int) -> float | None:
    """Query the DB for the nearest future scheduled kickoff and return seconds
    until it. Returns None if no upcoming scheduled matches are found."""
    sb = db.client()
    now_iso = datetime.now(timezone.utc).isoformat()
    result = (
        sb.table("matches")
        .select("kickoff_at")
        .eq("season", season)
        .eq("status", "scheduled")
        .gt("kickoff_at", now_iso)
        .order("kickoff_at", ascending=True)
        .limit(1)
        .execute()
    )
    if not result.data:
        return None
    kickoff_str = result.data[0]["kickoff_at"]
    # Supabase returns timestamps with or without timezone suffix.
    kickoff = datetime.fromisoformat(kickoff_str.replace("Z", "+00:00"))
    return (kickoff - datetime.now(timezone.utc)).total_seconds()


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


def find_unfinalized_match_ids(season: int) -> list[int]:
    """Return IDs of finished matches (per DB) that have no team_match_stats yet.

    Catches matches that slipped through finalization due to a worker restart
    or any other gap between live tracking and the finalize step.
    """
    sb = db.client()
    finished = (
        sb.table("matches")
        .select("id")
        .eq("season", season)
        .eq("status", "finished")
        .execute()
    )
    if not finished.data:
        return []
    finished_ids = [r["id"] for r in finished.data]
    with_stats = (
        sb.table("team_match_stats")
        .select("match_id")
        .in_("match_id", finished_ids)
        .execute()
    )
    done = {r["match_id"] for r in with_stats.data}
    return [fid for fid in finished_ids if fid not in done]


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
                    # Catch-up: finalize any finished match that slipped through
                    # (e.g. worker was restarted while a match was live — tracked_live
                    # starts empty so the transition is never witnessed directly).
                    for fid in find_unfinalized_match_ids(SEASON):
                        log.warning("catch-up finalizing match %s (no team_match_stats)", fid)
                        finalize_match(api, fid)

                status_shorts = write_snapshots(api, tracked_live)
            except Exception:
                log.exception("poll cycle failed; retrying next interval")
                status_shorts = set()
        else:
            status_shorts = set()

        if tracked_live:
            # Back off during halftime / break time — stats are frozen, no need to
            # poll every 60s. Resume normal cadence as soon as any match restarts.
            all_paused = bool(status_shorts) and status_shorts <= _PAUSED_STATUSES
            sleep_for = config.LIVE_POLL_INTERVAL * 2 if all_paused else config.LIVE_POLL_INTERVAL
            if all_paused:
                log.info("all live matches paused (%s) — backing off to %ds", status_shorts, sleep_for)
        else:
            # Smart idle: sleep until 10 minutes before the next kickoff so we
            # don't burn discovery quota during long gaps between matches.
            secs = seconds_until_next_kickoff(SEASON)
            if secs is not None and secs > config.FIXTURE_DISCOVERY_INTERVAL:
                # Wake up 10 min before kickoff, but never sleep longer than 30 min
                # so we stay responsive to manual match rescheduling.
                sleep_for = min(secs - 600, 1800)
                log.info("next kickoff in %.0fs — sleeping %.0fs", secs, sleep_for)
            else:
                sleep_for = config.FIXTURE_DISCOVERY_INTERVAL

        time.sleep(sleep_for)


if __name__ == "__main__":
    run()
