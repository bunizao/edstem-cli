"""Cookie authentication for Twitter/X.

Supports:
1. Environment variables: TWITTER_AUTH_TOKEN + TWITTER_CT0
2. Auto-extract from browser via browser-cookie3
   Extracts ALL Twitter cookies for full browser-like fingerprint.
   Prefers in-process extraction (required on macOS for Keychain access),
   falls back to subprocess if in-process fails (e.g. SQLite lock).
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
import sys
from typing import Dict, Optional

from .constants import BEARER_TOKEN, get_user_agent

logger = logging.getLogger(__name__)

# Domains to match for Twitter cookies
_TWITTER_DOMAINS = {"x.com", "twitter.com", ".x.com", ".twitter.com"}


def _is_twitter_domain(domain):
    # type: (str) -> bool
    return domain in _TWITTER_DOMAINS or domain.endswith(".x.com") or domain.endswith(".twitter.com")


def load_from_env() -> Optional[Dict[str, str]]:
    """Load cookies from environment variables."""
    auth_token = os.environ.get("TWITTER_AUTH_TOKEN", "")
    ct0 = os.environ.get("TWITTER_CT0", "")
    if auth_token and ct0:
        return {"auth_token": auth_token, "ct0": ct0}
    if auth_token or ct0:
        logger.debug(
            "Environment cookies incomplete: auth_token=%s ct0=%s",
            bool(auth_token),
            bool(ct0),
        )
    return None


def verify_cookies(auth_token, ct0, cookie_string=None):
    # type: (str, str, Optional[str]) -> Dict[str, Any]
    """Verify cookies by calling a Twitter API endpoint.

    Uses curl_cffi for proper TLS fingerprint.
    Tries multiple endpoints. Only raises on clear auth failures (401/403).
    For other errors (404, network), returns empty dict (proceed without verification).
    """
    from .client import _get_cffi_session

    urls = [
        "https://api.x.com/1.1/account/verify_credentials.json",
        "https://x.com/i/api/1.1/account/settings.json",
    ]

    # Use full cookie string if available, otherwise minimal
    cookie_header = cookie_string or "auth_token=%s; ct0=%s" % (auth_token, ct0)

    headers = {
        "Authorization": "Bearer %s" % BEARER_TOKEN,
        "Cookie": cookie_header,
        "X-Csrf-Token": ct0,
        "X-Twitter-Active-User": "yes",
        "X-Twitter-Auth-Type": "OAuth2Session",
        "User-Agent": get_user_agent(),
    }

    # Reuse the shared curl_cffi session for consistent TLS fingerprint
    session = _get_cffi_session()
    attempts = []

    logger.debug(
        "Verifying Twitter cookies with %s cookie header",
        "full forwarded" if cookie_string else "minimal",
    )

    for url in urls:
        endpoint = url.split("/")[-1]
        try:
            resp = session.get(url, headers=headers, timeout=5)
            if resp.status_code in (401, 403):
                raise RuntimeError(
                    "Cookie expired or invalid (HTTP %d). Please re-login to x.com in your browser." % resp.status_code
                )
            if resp.status_code == 200:
                data = resp.json()
                attempts.append("%s=200" % endpoint)
                logger.debug("Cookie verification succeeded via %s", endpoint)
                return {"screen_name": data.get("screen_name", "")}
            attempts.append("%s=%d" % (endpoint, resp.status_code))
            logger.debug("Verification endpoint %s returned HTTP %d, trying next...", url, resp.status_code)
            continue
        except RuntimeError:
            raise
        except Exception as e:
            attempts.append("%s=%s" % (endpoint, type(e).__name__))
            logger.debug("Verification endpoint %s failed: %s", url, e)
            continue

    # All endpoints failed with non-auth errors — proceed without verification
    logger.info(
        "Cookie verification skipped (attempts: %s), will verify on first API call",
        ", ".join(attempts) if attempts else "none",
    )
    return {}


def _extract_cookies_from_jar(jar, source="unknown"):
    # type: (Any, str) -> Optional[Dict[str, str]]
    """Extract Twitter cookies from a cookie jar."""
    result = {}  # type: Dict[str, str]
    all_cookies = {}  # type: Dict[str, str]
    twitter_cookie_count = 0
    for cookie in jar:
        domain = cookie.domain or ""
        if _is_twitter_domain(domain):
            twitter_cookie_count += 1
            if cookie.name == "auth_token":
                result["auth_token"] = cookie.value
            elif cookie.name == "ct0":
                result["ct0"] = cookie.value
            if cookie.name and cookie.value:
                all_cookies[cookie.name] = cookie.value
    if "auth_token" in result and "ct0" in result:
        cookies = {"auth_token": result["auth_token"], "ct0": result["ct0"]}
        if all_cookies:
            cookies["cookie_string"] = "; ".join("%s=%s" % (k, v) for k, v in all_cookies.items())
            logger.info("Extracted %d total cookies for full browser fingerprint", len(all_cookies))
        return cookies
    logger.debug(
        "Cookie jar %s did not contain usable Twitter auth cookies (twitter_cookies=%d, auth_token=%s, ct0=%s)",
        source,
        twitter_cookie_count,
        "auth_token" in result,
        "ct0" in result,
    )
    return None


def _extract_in_process():
    # type: () -> Optional[Dict[str, str]]
    """Extract cookies in the main process (required on macOS for Keychain access).

    On macOS, Chrome encrypts cookies using a key stored in the system Keychain.
    Child processes do NOT inherit the parent's Keychain authorization, so
    browser_cookie3 must run in the main process to decrypt cookies.
    """
    try:
        import browser_cookie3
    except ImportError:
        logger.debug("browser_cookie3 not installed, skipping in-process extraction")
        return None

    browsers = [
        ("arc", browser_cookie3.arc),
        ("chrome", browser_cookie3.chrome),
        ("edge", browser_cookie3.edge),
        ("firefox", browser_cookie3.firefox),
        ("brave", browser_cookie3.brave),
    ]
    attempts = []

    for name, fn in browsers:
        try:
            jar = fn()
        except Exception as e:
            logger.debug("%s in-process extraction failed: %s", name, e)
            attempts.append("%s=%s" % (name, type(e).__name__))
            continue
        cookies = _extract_cookies_from_jar(jar, source="%s(in-process)" % name)
        if cookies:
            logger.info("Found cookies in %s (in-process)", name)
            return cookies
        attempts.append("%s=no-cookies" % name)
    if attempts:
        logger.debug("In-process extraction attempts: %s", ", ".join(attempts))
    return None


def _extract_via_subprocess():
    # type: () -> Optional[Dict[str, str]]
    """Extract cookies via subprocess (fallback if in-process fails, e.g. SQLite lock)."""
    extract_script = '''
import json, sys
try:
    import browser_cookie3
except ImportError:
    print(json.dumps({"error": "browser-cookie3 not installed"}))
    sys.exit(1)

browsers = [
    ("arc", browser_cookie3.arc),
    ("chrome", browser_cookie3.chrome),
    ("edge", browser_cookie3.edge),
    ("firefox", browser_cookie3.firefox),
    ("brave", browser_cookie3.brave),
]
attempts = []

for name, fn in browsers:
    try:
        jar = fn()
    except Exception as exc:
        attempts.append(f"{name}={type(exc).__name__}")
        continue
    result = {}
    all_cookies = {}
    for cookie in jar:
        domain = cookie.domain or ""
        if domain.endswith(".x.com") or domain.endswith(".twitter.com") or domain in ("x.com", "twitter.com", ".x.com", ".twitter.com"):
            if cookie.name == "auth_token":
                result["auth_token"] = cookie.value
            elif cookie.name == "ct0":
                result["ct0"] = cookie.value
            if cookie.name and cookie.value:
                all_cookies[cookie.name] = cookie.value
    if "auth_token" in result and "ct0" in result:
        result["browser"] = name
        result["all_cookies"] = all_cookies
        print(json.dumps(result))
        sys.exit(0)
    attempts.append(
        f"{name}=no-cookies(auth_token={'auth_token' in result},ct0={'ct0' in result})"
    )

print(json.dumps({
    "error": "No Twitter cookies found in any browser. Make sure you are logged into x.com.",
    "attempts": attempts,
}))
sys.exit(1)
'''

    def _run_extract_command(cmd, timeout, label):
        # type: (list[str], int, str) -> tuple[Optional[dict], bool]
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=timeout,
            )
        except subprocess.TimeoutExpired:
            logger.debug("Cookie extraction %s timed out", label)
            return None, False
        except FileNotFoundError as exc:
            logger.debug("Cookie extraction %s launcher missing: %s", label, exc)
            return None, False

        output = result.stdout.strip()
        stderr = result.stderr.strip()
        if stderr:
            logger.debug("Cookie extraction stderr from %s: %s", label, stderr[:300])
        if not output:
            logger.debug("Cookie extraction from %s produced no stdout", label)
            return None, True

        try:
            data = json.loads(output)
        except json.JSONDecodeError as exc:
            logger.debug("Cookie extraction %s returned invalid JSON: %s", label, exc)
            return None, True

        if "error" in data:
            attempts = data.get("attempts") or []
            if attempts:
                logger.debug("Subprocess extraction attempts (%s): %s", label, ", ".join(str(item) for item in attempts))
            retryable = data.get("error") == "browser-cookie3 not installed"
            return None, retryable

        return data, False

    try:
        data, retry_with_uv = _run_extract_command(
            [sys.executable, "-c", extract_script],
            timeout=15,
            label="current env",
        )
        if data is None and retry_with_uv:
            data, _ = _run_extract_command(
                ["uv", "run", "--with", "browser-cookie3", "python", "-c", extract_script],
                timeout=30,
                label="uv fallback",
            )

        if data is None:
            return None
        logger.info("Found cookies in %s (subprocess)", data.get("browser", "unknown"))

        # Build full cookie string from all extracted cookies
        cookies = {"auth_token": data["auth_token"], "ct0": data["ct0"]}
        all_cookies = data.get("all_cookies", {})
        if all_cookies:
            cookie_str = "; ".join("%s=%s" % (k, v) for k, v in all_cookies.items())
            cookies["cookie_string"] = cookie_str
            logger.info("Extracted %d total cookies for full browser fingerprint", len(all_cookies))
        return cookies
    except KeyError as exc:
        logger.debug("Cookie extraction subprocess returned incomplete payload: %s", exc)
        return None


def extract_from_browser() -> Optional[Dict[str, str]]:
    """Auto-extract ALL Twitter cookies from local browser using browser-cookie3.

    Strategy:
    1. Try in-process first (required on macOS for Keychain access)
    2. Fall back to subprocess (handles SQLite lock when browser is running)
    """
    # 1. In-process (works on macOS, may fail with SQLite lock)
    cookies = _extract_in_process()
    if cookies:
        return cookies

    # 2. Subprocess fallback (handles SQLite lock, but fails on macOS Keychain)
    logger.debug("In-process extraction failed, trying subprocess fallback")
    cookies = _extract_via_subprocess()
    if not cookies:
        logger.warning("Twitter cookie extraction failed in both in-process and subprocess modes")
    return cookies


def get_cookies() -> Dict[str, str]:
    """Get Twitter cookies. Priority: env vars -> browser extraction.

    Raises RuntimeError if no cookies found.
    """
    cookies = None  # type: Optional[Dict[str, str]]

    # 1. Try environment variables
    cookies = load_from_env()
    if cookies:
        logger.info("Loaded cookies from environment variables")

    # 2. Try browser extraction (auto-detect)
    if not cookies:
        logger.debug("Attempting browser cookie extraction")
        cookies = extract_from_browser()

    if not cookies:
        raise RuntimeError(
            "No Twitter cookies found.\n"
            "Option 1: Set TWITTER_AUTH_TOKEN and TWITTER_CT0 environment variables\n"
            "Option 2: Make sure you are logged into x.com in your browser (Arc/Chrome/Edge/Firefox/Brave)"
        )

    # Verify only for explicit auth failures; transient endpoint issues are tolerated.
    try:
        verify_cookies(cookies["auth_token"], cookies["ct0"], cookies.get("cookie_string"))
    except RuntimeError:
        # Auth failure — re-extract from browser and retry verification
        logger.info("Cookie verification failed, re-extracting from browser")
        fresh_cookies = extract_from_browser()
        if fresh_cookies:
            # Verify fresh cookies — if this also fails, let it raise
            verify_cookies(fresh_cookies["auth_token"], fresh_cookies["ct0"], fresh_cookies.get("cookie_string"))
            return fresh_cookies
        raise
    return cookies
