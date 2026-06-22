"""Season-parameterized ingestion building blocks.

Shared by the one-shot backfill (backfill.py) and the live worker's finalize
step (ingest.py) so 2022 (demo) and 2026 (live) run the exact same code.
All writes are idempotent: reference data upserts; per-fixture detail tables
are replaced atomically per match (delete + insert) unless already present.
"""

import logging
from typing import Any

from .api_football import (
    ApiFootballClient,
    parse_events,
    parse_lineups,
    parse_match,
    parse_player_profile,
    parse_player_season_stats,
    parse_player_stats,
    parse_standings,
    parse_team,
    parse_team_stats,
)

log = logging.getLogger("pipeline")


def upsert_teams(sb, api: ApiFootballClient, season: int) -> int:
    rows = [parse_team(e) for e in api.teams(season)]
    if rows:
        sb.table("teams").upsert(rows).execute()
        sb.table("team_seasons").upsert(
            [{"team_id": r["id"], "season": season} for r in rows],
            on_conflict="team_id,season",
            ignore_duplicates=True,  # don't clobber maintained elo/fifa_ranking
        ).execute()
    log.info("upserted %d teams (+team_seasons) for season %s", len(rows), season)
    return len(rows)


def upsert_standings(sb, api: ApiFootballClient, season: int) -> dict[int, str]:
    """Store the API standings copy; return team_id → group letter ('A'…)."""
    rows = parse_standings(api.standings(season), season)
    if rows:
        sb.table("standings").upsert(rows, on_conflict="season,team_id").execute()
    log.info("upserted %d standings rows for season %s", len(rows), season)
    return {
        r["team_id"]: r["group_name"].removeprefix("Group ").strip()
        for r in rows
        if r["group_name"]
    }


def upsert_matches(
    sb, fixtures: list[dict[str, Any]], season: int, team_groups: dict[int, str]
) -> list[dict[str, Any]]:
    rows = [parse_match(fx, season, team_groups) for fx in fixtures]
    if rows:
        sb.table("matches").upsert(rows).execute()
    log.info("upserted %d matches for season %s", len(rows), season)
    return rows


def upsert_players(sb, api: ApiFootballClient, season: int) -> int:
    """Paginated /players → global profiles + stored season-stat copies.

    Deduped by primary key before upsert: the API can list the same player id
    on more than one page (e.g. a mid-tournament squad change), and Postgres
    rejects an ON CONFLICT batch that touches the same row twice. Last entry
    wins, matching upsert-overwrite semantics."""
    profiles_by_id: dict[int, dict[str, Any]] = {}
    season_stats_by_key: dict[tuple[int, int], dict[str, Any]] = {}
    for entry in api.players(season):
        profile = parse_player_profile(entry)
        profiles_by_id[profile["id"]] = profile
        stats = parse_player_season_stats(entry, season)
        if stats:
            season_stats_by_key[(stats["player_id"], stats["season"])] = stats
    profiles = list(profiles_by_id.values())
    season_stats = list(season_stats_by_key.values())
    if profiles:
        sb.table("players").upsert(profiles).execute()
    if season_stats:
        sb.table("player_season_stats").upsert(
            season_stats, on_conflict="player_id,season"
        ).execute()
    log.info(
        "upserted %d player profiles, %d season-stat rows for season %s",
        len(profiles), len(season_stats), season,
    )
    return len(profiles)


def ensure_player_stubs(sb, rows: list[dict[str, Any]]) -> None:
    """player_match_stats has an FK to players; fixture data can mention players
    missing from /players pages. Insert minimal profiles for those, reported."""
    ids = sorted({r["player_id"] for r in rows if r["player_id"] is not None})
    if not ids:
        return
    existing = {
        r["id"]
        for r in sb.table("players").select("id").in_("id", ids).execute().data
    }
    missing = [i for i in ids if i not in existing]
    if not missing:
        return
    names = {r["player_id"]: r.get("player_name") for r in rows}
    log.warning("inserting %d stub player profiles missing from /players: %s", len(missing), missing)
    sb.table("players").upsert(
        [{"id": i, "name": names.get(i) or f"Player {i}"} for i in missing]
    ).execute()


def ingest_fixture_details(sb, fx: dict[str, Any], season: int, force: bool = False) -> bool:
    """Write the immutable Track 2 dataset for one finished fixture from a
    batched /fixtures?ids= payload (statistics, players, events, lineups).
    Returns False if already finalized and not forced."""
    match_id = fx["fixture"]["id"]

    if not force:
        existing = (
            sb.table("team_match_stats").select("id").eq("match_id", match_id).limit(1).execute()
        )
        if existing.data:
            log.info("match %s already finalized, skipping", match_id)
            return False

    goals = {
        fx["teams"]["home"]["id"]: fx["goals"]["home"],
        fx["teams"]["away"]["id"]: fx["goals"]["away"],
    }

    team_rows = []
    for entry in fx["statistics"]:
        row = parse_team_stats(entry, season)
        opponent_goals = next(g for tid, g in goals.items() if tid != row["team_id"])
        row.update(match_id=match_id, goals_for=goals[row["team_id"]], goals_against=opponent_goals)
        team_rows.append(row)

    player_rows = []
    for team_entry in fx["players"]:
        for row in parse_player_stats(team_entry, season):
            row["match_id"] = match_id
            player_rows.append(row)

    event_rows = [{**r, "match_id": match_id} for r in parse_events(fx, season)]
    lineup_teams, lineup_players = parse_lineups(fx, season)
    lineup_teams = [{**r, "match_id": match_id} for r in lineup_teams]
    lineup_players = [{**r, "match_id": match_id} for r in lineup_players]

    ensure_player_stubs(sb, player_rows)

    # Replace-then-insert keeps reruns (force=True) atomic per match.
    for table in ("team_match_stats", "player_match_stats", "match_events",
                  "match_lineup_players", "match_lineups"):
        sb.table(table).delete().eq("match_id", match_id).execute()
    if team_rows:
        sb.table("team_match_stats").insert(team_rows).execute()
    if player_rows:
        # player_name is carried for ensure_player_stubs but is not a column on
        # player_match_stats (name lives on the players table).
        # Deduplicate by (match_id, player_id) — API can return player_id=0 duplicates.
        seen: set[tuple[int, int]] = set()
        insert_player_rows = []
        for r in player_rows:
            key = (r["match_id"], r["player_id"])
            if key not in seen:
                seen.add(key)
                insert_player_rows.append({k: v for k, v in r.items() if k != "player_name"})
        sb.table("player_match_stats").insert(insert_player_rows).execute()
    if event_rows:
        sb.table("match_events").insert(event_rows).execute()
    if lineup_teams:
        sb.table("match_lineups").insert(lineup_teams).execute()
    if lineup_players:
        sb.table("match_lineup_players").insert(lineup_players).execute()

    log.info(
        "ingested fixture %s: %d team stats, %d player stats, %d events, %d lineup players",
        match_id, len(team_rows), len(player_rows), len(event_rows), len(lineup_players),
    )
    return True
