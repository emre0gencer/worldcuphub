"""Supabase access for the Python runtime (service-role key: full write access)."""

from functools import lru_cache

from supabase import Client, create_client

from . import config


@lru_cache(maxsize=1)
def client() -> Client:
    return create_client(config.supabase_url(), config.supabase_service_key())
