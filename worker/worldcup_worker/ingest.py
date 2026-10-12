"""Track 1 + Track 2 ingestion.

Long-running worker loop (NOT a cron job), status-driven per PROJECT_SPEC.md §3:
- Poll the full fixtures list infrequently (FIXTURE_DISCOVERY_INTERVAL) to discover
  which matches just went live.
- Poll only the live matches every LIVE_POLL_INTERVAL, writing a match_snapshots
  row per poll (full time-series kept for momentum charts).
- When a match flips to finished, run the finalize step via the shared pipeline:
  immutable team/player stats + events + lineups, same code as the backfill.

Season comes from API_FOOTBALL_SEASON (default 2026).

End of life: once every fixture is finished and the Final has been played,
the loop runs one last derived refresh and exits with status 0 (see
`tournament_complete`). For 2026 that happened after the Final on 2026-07-19 —
live ingestion is over; the season is maintained with
`python -m worldcup_worker.finalize_season --season 2026`.

Run: python -m worldcup_worker.ingest
"""

import logging
import time
from datetime import datetime, timezone
from typing import Any

from . import analytics, config, db, pipeline
from .api_football import ApiFootballClient, status_of

log = logging.getLogger("ingest")

SEASON = config.API_FOOTBALL_SEASON


def discover_live_match_ids(
    api: ApiFootballClient,
) -> tuple[set[int], dict[int, str], list[dict[str, Any]]]:
    """One cheap fixtures-list call: live ids + status of every fixture.

    Also returns the raw fixtures payload so the caller can refresh the
    matches table from the same call (new knockout pairings, rescheduled
    kickoffs) without spending extra quota."""
    fixtures = api.fixtures(SEASON)
    statuses = {fx["fixture"]["id"]: status_of(fx) for fx in fixtures}
    live = {fid for fid, st in statuses.items() if st == "live"}
    return live, statuses, fixtures


def _team_groups_from_db(sb) -> dict[int, str]:
    """team_id → group letter from the stored standings copy, so the matches
    re-upsert doesn't clobber group_letter (parse_match derives it from this
    mapping for group-stage rows)."""
    rows = (
        sb.table("standings").select("team_id,group_name").eq("season", SEASON).execute().data
    )
    return {
        r["team_id"]: r["group_name"].removeprefix("Group ").strip()
        for r in rows or []
        if r.get("group_name")
    }


def refresh_matches(fixtures: list[dict[str, Any]]) -> None:
    """Re-upsert the matches table from an already-fetched fixtures payload.

    This is what surfaces new knockout fixtures (semifinal pairings appear in
    the API only after the quarterfinals) and kickoff reschedules without a
    manual backfill. Zero extra API quota — reuses the discovery call."""
    sb = db.client()
    pipeline.upsert_matches(sb, fixtures, SEASON, _team_groups_from_db(sb))


def refresh_derived(api: ApiFootballClient) -> None:
    """Post-finalize refresh so standings and Track 3 never lag a final whistle:
    re-pull the stored standings copy, then rerun Elo + form + predictions.
    Each step is guarded — a failure here must not kill the poll loop."""
    try:
        pipeline.upsert_standings(db.client(), api, SEASON)
    except Exception:
        log.exception("standings refresh failed")
    try:
        analytics.run(SEASON)
    except Exception:
        log.exception("analytics refresh failed")


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
        .order("kickoff_at", desc=False)
        .limit(1)
        .execute()
    )
    if not result.data:
        return None
    kickoff_str = result.data[0]["kickoff_at"]
    # Supabase returns timestamps with or without timezone suffix.
    kickoff = datetime.fromisoformat(kickoff_str.replace("Z", "+00:00"))
    return (kickoff - datetime.now(timezone.utc)).total_seconds()


def finalize_match(api: ApiFootballClient, match_id: int) -> bool:
    """Finalize step: write the immutable Track 2 dataset once at full-time.
    Returns True when the match was finalized (caller triggers the derived
    refresh only when at least one finalize actually happened)."""
    rows = api.fixtures_by_ids([match_id])
    if not rows:
        log.error("cannot finalize %s: fixture not found", match_id)
        return False
    fx = rows[0]
    sb = db.client()
    pipeline.ingest_fixture_details(sb, fx, SEASON)
    _update_match_row(sb, fx)
    log.info("finalized match %s", match_id)
    return True


def reconcile_stale_live(api: ApiFootballClient, statuses: dict[int, str]) -> int:
    """Reconcile matches pinned to a live status in the DB but no longer live
    per the API.

    `status_short` (the source of truth for the generated `status` column) is
    only ever advanced while a match sits in `tracked_live`. If the worker never
    witnessed the live→finished transition — an outage spanning the whole match,
    or an ESPN-backfilled "missed game" finalized out-of-band with a live
    status_short — the row stays 'live' forever. `find_unfinalized_match_ids`
    can't rescue it because that only scans status == 'finished'. This is the
    general backstop: trust the API's current status for anything the DB still
    thinks is live.

    Returns how many matches were finalized here.
    """
    sb = db.client()
    stuck = (
        sb.table("matches")
        .select("id")
        .eq("season", SEASON)
        .eq("status", "live")
        .execute()
    )
    finalized = 0
    for row in stuck.data or []:
        mid = row["id"]
        true_status = statuses.get(mid)
        if true_status in (None, "live"):
            continue  # genuinely live (or unknown to the API) — leave it alone
        if true_status == "finished":
            log.warning("reconciling stale-live match %s → finished", mid)
            if finalize_match(api, mid):  # idempotent; corrects status_short to FT/AET/PEN
                finalized += 1
        else:
            # Reverted to scheduled (postponement, etc.) — just refresh the row.
            log.warning("reconciling stale-live match %s → %s", mid, true_status)
            fixtures = api.fixtures_by_ids([mid])
            if fixtures:
                _update_match_row(sb, fixtures[0])
    return finalized


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


def tournament_complete(statuses: dict[int, str], fixtures: list[dict[str, Any]]) -> bool:
    """True once the Final has been played and nothing is scheduled or live.

    This is the worker's end-of-life signal: after the final whistle of the
    Final there is nothing left to poll, so live ingestion ends for good."""
    if not statuses or any(st != "finished" for st in statuses.values()):
        return False
    return any(fx["league"].get("round") == "Final" for fx in fixtures)


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
                    live_ids, statuses, fixtures = discover_live_match_ids(api)
                    last_discovery = now
                    # Keep the matches table in sync with the API every discovery
                    # cycle: new knockout fixtures/pairings and reschedules land
                    # without a manual backfill (reuses the discovery payload).
                    try:
                        refresh_matches(fixtures)
                    except Exception:
                        log.exception("matches refresh failed")
                    finalized = 0
                    # Matches we were tracking that are no longer live → finalize.
                    for finished_id in tracked_live - live_ids:
                        if statuses.get(finished_id) == "finished":
                            finalized += finalize_match(api, finished_id)
                    tracked_live = live_ids
                    # Backstop: rescue any match the DB still thinks is live but
                    # the API no longer does (outage across the whole match, or an
                    # out-of-band ESPN backfill that left a live status_short).
                    finalized += reconcile_stale_live(api, statuses)
                    # Catch-up: finalize any finished match that slipped through
                    # (e.g. worker was restarted while a match was live — tracked_live
                    # starts empty so the transition is never witnessed directly).
                    for fid in find_unfinalized_match_ids(SEASON):
                        log.warning("catch-up finalizing match %s (no team_match_stats)", fid)
                        finalized += finalize_match(api, fid)
                    # Any final whistle this cycle → refresh standings + Track 3
                    # immediately so rankings/predictions never lag results.
                    if finalized:
                        refresh_derived(api)
                    # End of tournament → live ingestion is over. Run one last
                    # derived refresh (standings + full Elo/Track 3 replay) and
                    # exit cleanly; Railway's ON_FAILURE policy will not restart
                    # a zero exit, so the service stays down without burning quota.
                    if tournament_complete(statuses, fixtures):
                        log.info(
                            "tournament complete: all %d fixtures finished incl. the Final — "
                            "live ingestion has ended; running final derived refresh and exiting",
                            len(statuses),
                        )
                        refresh_derived(api)
                        api.close()
                        return

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
            # Guarded: a transient DB error here must not kill the loop — fall
            # back to a normal discovery interval and try again next cycle.
            try:
                secs = seconds_until_next_kickoff(SEASON)
            except Exception:
                log.exception("next-kickoff lookup failed; using discovery interval")
                secs = None
            if secs is not None and secs > config.FIXTURE_DISCOVERY_INTERVAL:
                # Wake up 10 min before kickoff, but never sleep longer than 30 min
                # so we stay responsive to manual match rescheduling, and never
                # less than one discovery interval — when kickoff is 300–600s away
                # secs - 600 goes negative, which time.sleep() rejects.
                sleep_for = max(min(secs - 600, 1800), config.FIXTURE_DISCOVERY_INTERVAL)
                log.info("next kickoff in %.0fs — sleeping %.0fs", secs, sleep_for)
            else:
                sleep_for = config.FIXTURE_DISCOVERY_INTERVAL

        # Defensive floor: time.sleep() rejects negatives, so no code path above
        # may ever hand it one. This guarantees the loop sleeps and continues.
        time.sleep(max(sleep_for, 1))


if __name__ == "__main__":
    run()
