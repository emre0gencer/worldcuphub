"""Thin API-Football v3 client. Key and endpoints come from env/config."""

from typing import Any

import httpx

from . import config

BASE_URL = "https://v3.football.api-sports.io"

# API-Football "short" status codes grouped into our 3-state model.
LIVE_STATUSES = {"1H", "HT", "2H", "ET", "BT", "P", "LIVE", "INT"}
FINISHED_STATUSES = {"FT", "AET", "PEN"}


class ApiFootballClient:
    def __init__(self) -> None:
        self._http = httpx.Client(
            base_url=BASE_URL,
            headers={"x-apisports-key": config.api_football_key()},
            timeout=30,
        )

    def _get(self, path: str, params: dict[str, Any]) -> list[dict[str, Any]]:
        resp = self._http.get(path, params=params)
        resp.raise_for_status()
        body = resp.json()
        if body.get("errors"):
            raise RuntimeError(f"API-Football error on {path}: {body['errors']}")
        return body.get("response", [])

    def fixtures(self) -> list[dict[str, Any]]:
        """All fixtures for the tournament (cheap discovery poll)."""
        return self._get(
            "/fixtures",
            {"league": config.API_FOOTBALL_LEAGUE_ID, "season": config.API_FOOTBALL_SEASON},
        )

    def fixture(self, fixture_id: int) -> dict[str, Any] | None:
        rows = self._get("/fixtures", {"id": fixture_id})
        return rows[0] if rows else None

    def fixture_statistics(self, fixture_id: int) -> list[dict[str, Any]]:
        """Per-team statistics for a fixture (includes xG on the Pro tier)."""
        return self._get("/fixtures/statistics", {"fixture": fixture_id})

    def fixture_players(self, fixture_id: int) -> list[dict[str, Any]]:
        """Per-player statistics for a fixture."""
        return self._get("/fixtures/players", {"fixture": fixture_id})

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


def _stat_value(stats: list[dict[str, Any]], name: str) -> float | None:
    for item in stats:
        if item["type"] == name:
            value = item["value"]
            if value is None:
                return None
            if isinstance(value, str) and value.endswith("%"):
                return float(value.rstrip("%"))
            return float(value)
    return None


def parse_team_stats(entry: dict[str, Any]) -> dict[str, Any]:
    """Normalize one team's /fixtures/statistics entry into team_match_stats columns."""
    stats = entry["statistics"]

    def as_int(name: str) -> int | None:
        v = _stat_value(stats, name)
        return int(v) if v is not None else None

    return {
        "team_id": entry["team"]["id"],
        "possession": _stat_value(stats, "Ball Possession"),
        "shots": as_int("Total Shots"),
        "shots_on_target": as_int("Shots on Goal"),
        "corners": as_int("Corner Kicks"),
        "fouls": as_int("Fouls"),
        "passes": as_int("Total passes"),
        "pass_accuracy": _stat_value(stats, "Passes %"),
        "xg": _stat_value(stats, "expected_goals"),  # from API-Football, never self-computed
    }


def parse_player_stats(team_entry: dict[str, Any]) -> list[dict[str, Any]]:
    """Normalize one team's /fixtures/players entry into player_match_stats rows."""
    rows = []
    for p in team_entry["players"]:
        s = p["statistics"][0]
        rating = s["games"].get("rating")
        rows.append(
            {
                "player_id": p["player"]["id"],
                "team_id": team_entry["team"]["id"],
                "minutes": s["games"].get("minutes") or 0,
                "goals": s["goals"].get("total") or 0,
                "assists": s["goals"].get("assists") or 0,
                "shots": s["shots"].get("total") or 0,
                "key_passes": s["passes"].get("key") or 0,
                "tackles": s["tackles"].get("total") or 0,
                "rating": float(rating) if rating else None,
            }
        )
    return rows
