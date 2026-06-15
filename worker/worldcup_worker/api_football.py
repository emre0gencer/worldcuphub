"""Thin API-Football v3 client + response parsers.

Every parser maps verified fields (see discovery/FIELD_INVENTORY.md) to DB
columns. Unknown fields are REPORTED, never silently coerced or dropped:
if the API starts returning new stat types (e.g. expected_goals for 2026),
`report_unknown_stats` logs them so the schema decision is made by a human.
"""

import logging
import re
from typing import Any, Iterator

import httpx

from . import config

log = logging.getLogger("api_football")

BASE_URL = "https://v3.football.api-sports.io"

# API-Football "short" status codes grouped into our 3-state model.
# Must stay in sync with the generated `matches.status` column in the schema.
LIVE_STATUSES = {"1H", "HT", "2H", "ET", "BT", "P", "LIVE", "INT", "SUSP"}
FINISHED_STATUSES = {"FT", "AET", "PEN", "AWD", "WO"}

BATCH_SIZE = 20  # /fixtures?ids= batching (quota discipline, spec §6)


class ApiFootballClient:
    def __init__(self) -> None:
        self._http = httpx.Client(
            base_url=BASE_URL,
            headers={"x-apisports-key": config.api_football_key()},
            timeout=60,
        )

    def _get(self, path: str, params: dict[str, Any]) -> dict[str, Any]:
        resp = self._http.get(path, params=params)
        resp.raise_for_status()
        body = resp.json()
        if body.get("errors"):
            raise RuntimeError(f"API-Football error on {path}: {body['errors']}")
        return body

    def fixtures(self, season: int) -> list[dict[str, Any]]:
        """All fixtures for one tournament (cheap discovery poll)."""
        body = self._get(
            "/fixtures", {"league": config.API_FOOTBALL_LEAGUE_ID, "season": season}
        )
        return body["response"]

    def fixtures_by_ids(self, fixture_ids: list[int]) -> list[dict[str, Any]]:
        """Batched fixture detail: events, lineups, statistics, players per
        fixture — ~20 per call instead of 4 calls per fixture."""
        out: list[dict[str, Any]] = []
        for i in range(0, len(fixture_ids), BATCH_SIZE):
            chunk = fixture_ids[i : i + BATCH_SIZE]
            body = self._get("/fixtures", {"ids": "-".join(map(str, chunk))})
            out.extend(body["response"])
        return out

    def standings(self, season: int) -> list[dict[str, Any]]:
        body = self._get(
            "/standings", {"league": config.API_FOOTBALL_LEAGUE_ID, "season": season}
        )
        return body["response"]

    def teams(self, season: int) -> list[dict[str, Any]]:
        body = self._get(
            "/teams", {"league": config.API_FOOTBALL_LEAGUE_ID, "season": season}
        )
        return body["response"]

    def players(self, season: int) -> Iterator[dict[str, Any]]:
        """Paginated per-player season stats (42 pages for 2022)."""
        page = 1
        while True:
            body = self._get(
                "/players",
                {"league": config.API_FOOTBALL_LEAGUE_ID, "season": season, "page": page},
            )
            yield from body["response"]
            paging = body["paging"]
            if paging["current"] >= paging["total"]:
                return
            page += 1

    def close(self) -> None:
        self._http.close()


def status_of(fixture: dict[str, Any]) -> str:
    """Map an API-Football fixture payload to scheduled/live/finished."""
    short = fixture["fixture"]["status"]["short"]
    if short in LIVE_STATUSES:
        return "live"
    if short in FINISHED_STATUSES:
        return "finished"
    return "scheduled"


# ── value coercion helpers ────────────────────────────────────────────────────

def _num(value: Any) -> float | None:
    """'78%' → 78.0, '6.3' → 6.3, None → None."""
    if value is None:
        return None
    if isinstance(value, str):
        value = value.rstrip("%")
    return float(value)


def _int(value: Any) -> int | None:
    v = _num(value)
    return int(v) if v is not None else None


# ── matches ──────────────────────────────────────────────────────────────────

_ROUND_TO_STAGE = {
    "Round of 32": "R32",
    "Round of 16": "R16",
    "Quarter-finals": "QF",
    "Semi-finals": "SF",
    "3rd Place Final": "third_place",
    "Final": "final",
}


def stage_of(round_name: str) -> str:
    if round_name.startswith("Group Stage"):
        return "group"
    stage = _ROUND_TO_STAGE.get(round_name)
    if stage is None:
        raise RuntimeError(f"unmapped round name from API: {round_name!r}")
    return stage


def parse_match(fx: dict[str, Any], season: int, team_groups: dict[int, str]) -> dict[str, Any]:
    """One /fixtures row → matches columns. team_groups: team_id → 'A'… from standings."""
    fixture, league, teams, goals, score = (
        fx["fixture"], fx["league"], fx["teams"], fx["goals"], fx["score"]
    )
    stage = stage_of(league["round"])
    home_id = teams["home"]["id"]
    return {
        "id": fixture["id"],
        "season": season,
        "home_team_id": home_id,
        "away_team_id": teams["away"]["id"],
        "kickoff_at": fixture["date"],
        "referee": fixture["referee"],
        "venue": fixture["venue"]["name"],
        "venue_city": fixture["venue"]["city"],
        "round": league["round"],
        "stage": stage,
        "group_letter": team_groups.get(home_id) if stage == "group" else None,
        "status_short": fixture["status"]["short"],
        "home_score": goals["home"],
        "away_score": goals["away"],
        "ht_home": score["halftime"]["home"],
        "ht_away": score["halftime"]["away"],
        "ft_home": score["fulltime"]["home"],
        "ft_away": score["fulltime"]["away"],
        "pen_home": score["penalty"]["home"],
        "pen_away": score["penalty"]["away"],
        "home_winner": teams["home"]["winner"],
    }


# ── team match statistics ────────────────────────────────────────────────────

_TEAM_STAT_MAP = {
    "Ball Possession": ("possession", _num),
    "Total Shots": ("shots", _int),
    "Shots on Goal": ("shots_on_target", _int),
    "Shots off Goal": ("shots_off_target", _int),
    "Blocked Shots": ("shots_blocked", _int),
    "Shots insidebox": ("shots_inside_box", _int),
    "Shots outsidebox": ("shots_outside_box", _int),
    "Fouls": ("fouls", _int),
    "Corner Kicks": ("corners", _int),
    "Offsides": ("offsides", _int),
    "Yellow Cards": ("yellow_cards", _int),
    "Red Cards": ("red_cards", _int),
    "Goalkeeper Saves": ("saves", _int),
    "Total passes": ("passes", _int),
    "Passes accurate": ("passes_accurate", _int),
    "Passes %": ("pass_accuracy", _num),
    # Advanced metrics (present from 2026 onward; absent for 2022).
    "expected_goals": ("xg", _num),
    "goals_prevented": ("goals_prevented", _num),
}

_unknown_stat_types: set[str] = set()


def parse_team_stats(entry: dict[str, Any], season: int) -> dict[str, Any]:
    """One statistics[] entry → team_match_stats columns (goals added by caller)."""
    row: dict[str, Any] = {"team_id": entry["team"]["id"], "season": season}
    for stat in entry["statistics"]:
        mapping = _TEAM_STAT_MAP.get(stat["type"])
        if mapping is None:
            # Field-for-field diff: report, never coerce silently.
            if stat["type"] not in _unknown_stat_types:
                _unknown_stat_types.add(stat["type"])
                log.warning(
                    "UNMAPPED team stat type %r (value=%r) — not stored; review schema",
                    stat["type"], stat["value"],
                )
            continue
        column, coerce = mapping
        row[column] = coerce(stat["value"])
    return row


# ── player match statistics ──────────────────────────────────────────────────

def parse_player_stats(team_entry: dict[str, Any], season: int) -> list[dict[str, Any]]:
    """One players[] team entry → granular player_match_stats rows.
    Per-fixture position/shirt_number deliberately live in match_lineup_players."""
    rows = []
    for p in team_entry["players"]:
        s = p["statistics"][0]
        rows.append(
            {
                "player_id": p["player"]["id"],
                "team_id": team_entry["team"]["id"],
                "season": season,
                "minutes": s["games"]["minutes"],
                "rating": _num(s["games"]["rating"]),
                "captain": s["games"]["captain"],
                "substitute": s["games"]["substitute"],
                "offsides": s["offsides"],
                "shots": s["shots"]["total"],
                "shots_on_target": s["shots"]["on"],
                "goals": s["goals"]["total"],
                "goals_conceded": s["goals"]["conceded"],
                "assists": s["goals"]["assists"],
                "saves": s["goals"]["saves"],
                "passes": s["passes"]["total"],
                "key_passes": s["passes"]["key"],
                "pass_accuracy": _num(s["passes"]["accuracy"]),
                "tackles": s["tackles"]["total"],
                "blocks": s["tackles"]["blocks"],
                "interceptions": s["tackles"]["interceptions"],
                "duels": s["duels"]["total"],
                "duels_won": s["duels"]["won"],
                "dribbles_attempted": s["dribbles"]["attempts"],
                "dribbles_succeeded": s["dribbles"]["success"],
                "dribbled_past": s["dribbles"]["past"],
                "fouls_drawn": s["fouls"]["drawn"],
                "fouls_committed": s["fouls"]["committed"],
                "yellow_cards": s["cards"]["yellow"],
                "red_cards": s["cards"]["red"],
                "penalties_won": s["penalty"]["won"],
                "penalties_committed": s["penalty"]["commited"],  # API typo
                "penalties_scored": s["penalty"]["scored"],
                "penalties_missed": s["penalty"]["missed"],
                "penalties_saved": s["penalty"]["saved"],
            }
        )
    return rows


# ── events / lineups ─────────────────────────────────────────────────────────

def parse_events(fx: dict[str, Any], season: int) -> list[dict[str, Any]]:
    return [
        {
            "season": season,
            "order_index": i,
            "elapsed": e["time"]["elapsed"],
            "elapsed_extra": e["time"]["extra"],
            "team_id": e["team"]["id"],
            "player_id": e["player"]["id"],
            "player_name": e["player"]["name"],
            "assist_id": e["assist"]["id"],
            "assist_name": e["assist"]["name"],
            "type": e["type"],
            "detail": e["detail"],
            "comments": e["comments"],
        }
        for i, e in enumerate(fx["events"])
    ]


def parse_lineups(
    fx: dict[str, Any], season: int
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """lineups[] → (match_lineups team rows, match_lineup_players rows)."""
    team_rows, player_rows = [], []
    for lu in fx["lineups"]:
        team_id = lu["team"]["id"]
        team_rows.append(
            {
                "team_id": team_id,
                "season": season,
                "formation": lu["formation"],
                "coach_id": lu["coach"]["id"],
                "coach_name": lu["coach"]["name"],
            }
        )
        for starter, group in ((True, lu["startXI"]), (False, lu["substitutes"])):
            for entry in group:
                p = entry["player"]
                player_rows.append(
                    {
                        "team_id": team_id,
                        "season": season,
                        "player_id": p["id"],
                        "player_name": p["name"],
                        "shirt_number": p["number"],
                        "position": p["pos"],
                        "grid": p["grid"],
                        "starter": starter,
                    }
                )
    return team_rows, player_rows


# ── standings / teams / players ──────────────────────────────────────────────

# The 48-team (2026) format returns an extra cross-group ranking table named
# "Group Stage" (best third-placed teams), duplicating teams already listed in
# their lettered group. We store only the real per-team group tables.
_GROUP_NAME_RE = re.compile(r"^Group [A-Z]$")


def parse_standings(response: list[dict[str, Any]], season: int) -> list[dict[str, Any]]:
    rows = []
    for league_entry in response:
        for group in league_entry["league"]["standings"]:
            for r in group:
                if not _GROUP_NAME_RE.match(r["group"] or ""):
                    continue
                rows.append(
                    {
                        "season": season,
                        "team_id": r["team"]["id"],
                        "rank": r["rank"],
                        "group_name": r["group"],
                        "points": r["points"],
                        "goals_diff": r["goalsDiff"],
                        "form": r["form"],
                        "description": r["description"],
                        "played": r["all"]["played"],
                        "won": r["all"]["win"],
                        "drawn": r["all"]["draw"],
                        "lost": r["all"]["lose"],
                        "goals_for": r["all"]["goals"]["for"],
                        "goals_against": r["all"]["goals"]["against"],
                        "updated_at": r["update"],
                    }
                )
    return rows


def parse_team(entry: dict[str, Any]) -> dict[str, Any]:
    t = entry["team"]
    return {
        "id": t["id"],
        "name": t["name"],
        "country_code": t["code"],
        "logo_url": t["logo"],
    }


def parse_player_profile(entry: dict[str, Any]) -> dict[str, Any]:
    p = entry["player"]
    return {
        "id": p["id"],
        "name": p["name"],
        "firstname": p["firstname"],
        "lastname": p["lastname"],
        "birth_date": p["birth"]["date"],
        "nationality": p["nationality"],
        "height": p["height"],
        "weight": p["weight"],
        "photo_url": p["photo"],
    }


def parse_player_season_stats(entry: dict[str, Any], season: int) -> dict[str, Any] | None:
    """One /players row → player_season_stats (stored API copy, cross-check)."""
    stats = [s for s in entry["statistics"] if s["league"]["id"] == config.API_FOOTBALL_LEAGUE_ID]
    if not stats:
        return None
    s = stats[0]
    return {
        "player_id": entry["player"]["id"],
        "season": season,
        "team_id": s["team"]["id"],
        "position": s["games"]["position"],
        "appearances": s["games"]["appearences"],  # API typo
        "lineups": s["games"]["lineups"],
        "minutes": s["games"]["minutes"],
        "rating": _num(s["games"]["rating"]),
        "captain": s["games"]["captain"],
        "subs_in": s["substitutes"]["in"],
        "subs_out": s["substitutes"]["out"],
        "bench": s["substitutes"]["bench"],
        "shots": s["shots"]["total"],
        "shots_on_target": s["shots"]["on"],
        "goals": s["goals"]["total"],
        "goals_conceded": s["goals"]["conceded"],
        "assists": s["goals"]["assists"],
        "saves": s["goals"]["saves"],
        "passes": s["passes"]["total"],
        "key_passes": s["passes"]["key"],
        "pass_accuracy": _num(s["passes"]["accuracy"]),
        "tackles": s["tackles"]["total"],
        "blocks": s["tackles"]["blocks"],
        "interceptions": s["tackles"]["interceptions"],
        "duels": s["duels"]["total"],
        "duels_won": s["duels"]["won"],
        "dribbles_attempted": s["dribbles"]["attempts"],
        "dribbles_succeeded": s["dribbles"]["success"],
        "dribbled_past": s["dribbles"]["past"],
        "fouls_drawn": s["fouls"]["drawn"],
        "fouls_committed": s["fouls"]["committed"],
        "yellow_cards": s["cards"]["yellow"],
        "yellowred_cards": s["cards"].get("yellowred"),
        "red_cards": s["cards"]["red"],
        "penalties_won": s["penalty"]["won"],
        "penalties_committed": s["penalty"]["commited"],  # API typo
        "penalties_scored": s["penalty"]["scored"],
        "penalties_missed": s["penalty"]["missed"],
        "penalties_saved": s["penalty"]["saved"],
    }
