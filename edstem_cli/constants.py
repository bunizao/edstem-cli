"""Shared constants for edstem-cli."""

from __future__ import annotations

import os

DEFAULT_API_BASE_URL = "https://edstem.org/api/"


def _normalize_api_base_url(base_url: str) -> str:
    """Normalize the API base URL to a slash-terminated form."""
    value = (base_url or "").strip()
    if not value:
        return DEFAULT_API_BASE_URL
    return value.rstrip("/") + "/"


def get_api_base_url() -> str:
    """Resolve the API base URL from the environment or default."""
    return _normalize_api_base_url(
        os.environ.get("ED_API_BASE_URL", DEFAULT_API_BASE_URL)
    )


API_BASE_URL = DEFAULT_API_BASE_URL

THREAD_TYPES = {"post", "question", "announcement"}

SORT_OPTIONS = ["new", "old", "top", "hot"]

ACTIVITY_FILTERS = ["all", "thread", "answer", "comment"]
