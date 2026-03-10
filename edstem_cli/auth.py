"""Authentication for Ed Discussion API.

Supports:
1. ED_API_TOKEN environment variable
2. Token file at ~/.config/edstem-cli/token
3. Interactive prompt (saves to file)
4. Verification via GET /api/user
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Optional

import requests

logger = logging.getLogger(__name__)

_TOKEN_DIR = Path.home() / ".config" / "edstem-cli"
_TOKEN_FILE = _TOKEN_DIR / "token"
_TOKEN_HELP_URL = "https://edstem.org/settings/api-tokens"
_INVALID_TOKEN_ERROR = (
    "Invalid or expired Ed API token. Regenerate it at %s." % _TOKEN_HELP_URL
)


def load_from_env() -> Optional[str]:
    """Load API token from ED_API_TOKEN environment variable."""
    token = os.environ.get("ED_API_TOKEN", "").strip()
    if token:
        logger.info("Loaded token from ED_API_TOKEN environment variable")
        return token
    return None


def load_from_file() -> Optional[str]:
    """Load API token from ~/.config/edstem-cli/token."""
    if not _TOKEN_FILE.exists():
        return None
    try:
        token = _TOKEN_FILE.read_text(encoding="utf-8").strip()
        if token:
            logger.info("Loaded token from %s", _TOKEN_FILE)
            return token
    except OSError as exc:
        logger.debug("Failed to read token file: %s", exc)
    return None


def save_token(token: str) -> None:
    """Save API token to ~/.config/edstem-cli/token."""
    _TOKEN_DIR.mkdir(parents=True, exist_ok=True)
    _TOKEN_FILE.write_text(token.strip() + "\n", encoding="utf-8")
    _TOKEN_FILE.chmod(0o600)
    logger.info("Token saved to %s", _TOKEN_FILE)


def prompt_for_token() -> str:
    """Interactively prompt the user for an API token."""
    import click

    click.echo(
        "\nNo Ed API token found.\n"
        "Get your API token from: %s\n" % _TOKEN_HELP_URL
    )
    token = click.prompt("Paste your Ed API token", hide_input=True).strip()
    if not token:
        raise RuntimeError("No token provided")
    save_token(token)
    return token


def verify_token(token: str) -> dict:
    """Verify token by calling GET /api/user. Returns user data or raises."""
    from .constants import get_api_base_url

    try:
        resp = requests.get(
            get_api_base_url() + "user",
            headers={
                "Authorization": "Bearer %s" % token,
                "Accept": "application/json",
            },
            timeout=10,
            allow_redirects=False,
        )
    except requests.RequestException as exc:
        raise RuntimeError("Failed to reach the Ed API: %s" % exc) from exc

    code, message = _extract_error_details(resp)
    if resp.status_code in (400, 401, 403):
        if code == "bad_token" or resp.status_code in (401, 403):
            raise RuntimeError(_INVALID_TOKEN_ERROR)
        raise RuntimeError(_format_api_error(resp.status_code, message))

    if 300 <= resp.status_code < 400:
        location = resp.headers.get("location") or "an unknown location"
        raise RuntimeError(
            "Ed API base URL redirected to %s. "
            "Set ED_API_BASE_URL to a valid JSON API endpoint." % location
        )

    if not resp.ok:
        raise RuntimeError(_format_api_error(resp.status_code, message))

    try:
        return resp.json()
    except ValueError as exc:
        raise RuntimeError(
            "Ed API returned a non-JSON response. "
            "Set ED_API_BASE_URL to a valid JSON API endpoint."
        ) from exc


def _extract_error_details(resp: requests.Response) -> tuple[str, str]:
    """Extract structured API error details when available."""
    try:
        payload = resp.json()
    except ValueError:
        return "", ""
    if not isinstance(payload, dict):
        return "", ""
    return str(payload.get("code") or ""), str(payload.get("message") or "")


def _format_api_error(status_code: int, message: str) -> str:
    """Build a user-facing API error message."""
    if message:
        return "Ed API error (HTTP %d): %s" % (status_code, message)
    return "Ed API error (HTTP %d)" % status_code


def get_token() -> str:
    """Get Ed API token. Priority: env var -> file -> interactive prompt.

    Raises RuntimeError if token is invalid.
    """
    token = load_from_env() or load_from_file()
    if not token:
        token = prompt_for_token()
    verify_token(token)
    return token
