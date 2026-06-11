"""All configuration is read from environment variables — never hard-coded."""

import os

from dotenv import load_dotenv

load_dotenv()


def _require(name: str, *fallbacks: str) -> str:
    for key in (name, *fallbacks):
        value = os.environ.get(key)
        if value:
            return value
    raise RuntimeError(f"Missing required environment variable: {name}")


def api_football_key() -> str:
    return _require("API_FOOTBALL_KEY")


def supabase_url() -> str:
    return _require("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL")


def supabase_service_key() -> str:
    return _require("SUPABASE_SERVICE_KEY")


# Poll cadences (seconds). Overridable via env for testing.
LIVE_POLL_INTERVAL = int(os.environ.get("LIVE_POLL_INTERVAL", "60"))
FIXTURE_DISCOVERY_INTERVAL = int(os.environ.get("FIXTURE_DISCOVERY_INTERVAL", "300"))

# 2026 World Cup league id / season in API-Football.
API_FOOTBALL_LEAGUE_ID = int(os.environ.get("API_FOOTBALL_LEAGUE_ID", "1"))
API_FOOTBALL_SEASON = int(os.environ.get("API_FOOTBALL_SEASON", "2026"))
