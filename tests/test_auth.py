from __future__ import annotations

import json
import sys
from types import SimpleNamespace

import pytest

from twitter_cli import auth


def test_get_cookies_prefers_env(monkeypatch) -> None:
    monkeypatch.setattr(auth, "load_from_env", lambda: {"auth_token": "env-token", "ct0": "env-csrf"})
    monkeypatch.setattr(auth, "extract_from_browser", lambda: pytest.fail("should not extract from browser"))
    seen = []
    monkeypatch.setattr(
        auth,
        "verify_cookies",
        lambda auth_token, ct0, cookie_string=None: seen.append((auth_token, ct0, cookie_string)) or {},
    )

    cookies = auth.get_cookies()

    assert cookies == {"auth_token": "env-token", "ct0": "env-csrf"}
    assert seen == [("env-token", "env-csrf", None)]


def test_get_cookies_reextracts_after_verify_failure(monkeypatch) -> None:
    monkeypatch.setattr(auth, "load_from_env", lambda: None)
    extracted = iter(
        [
            {"auth_token": "stale-token", "ct0": "stale-csrf", "cookie_string": "stale=1"},
            {"auth_token": "fresh-token", "ct0": "fresh-csrf", "cookie_string": "fresh=1"},
        ]
    )
    monkeypatch.setattr(auth, "extract_from_browser", lambda: next(extracted))

    calls = []

    def _verify(auth_token, ct0, cookie_string=None):
        calls.append((auth_token, ct0, cookie_string))
        if auth_token == "stale-token":
            raise RuntimeError("expired")
        return {}

    monkeypatch.setattr(auth, "verify_cookies", _verify)

    cookies = auth.get_cookies()

    assert cookies["auth_token"] == "fresh-token"
    assert calls == [
        ("stale-token", "stale-csrf", "stale=1"),
        ("fresh-token", "fresh-csrf", "fresh=1"),
    ]


def test_load_from_env_logs_incomplete_env(monkeypatch, caplog) -> None:
    monkeypatch.setenv("TWITTER_AUTH_TOKEN", "token")
    monkeypatch.delenv("TWITTER_CT0", raising=False)

    with caplog.at_level("DEBUG"):
        cookies = auth.load_from_env()

    assert cookies is None
    assert "Environment cookies incomplete" in caplog.text


def test_extract_cookies_from_jar_logs_missing_required_cookies(caplog) -> None:
    class Cookie:
        def __init__(self, domain: str, name: str, value: str) -> None:
            self.domain = domain
            self.name = name
            self.value = value

    jar = [Cookie(".x.com", "auth_token", "token")]

    with caplog.at_level("DEBUG"):
        cookies = auth._extract_cookies_from_jar(jar, source="test-jar")

    assert cookies is None
    assert "test-jar" in caplog.text
    assert "ct0=False" in caplog.text


def test_extract_from_browser_logs_warning_when_all_methods_fail(monkeypatch, caplog) -> None:
    monkeypatch.setattr(auth, "_extract_in_process", lambda: None)
    monkeypatch.setattr(auth, "_extract_via_subprocess", lambda: None)

    with caplog.at_level("WARNING"):
        cookies = auth.extract_from_browser()

    assert cookies is None
    assert "Twitter cookie extraction failed in both in-process and subprocess modes" in caplog.text


def test_extract_in_process_supports_arc(monkeypatch) -> None:
    class Cookie:
        def __init__(self, domain: str, name: str, value: str) -> None:
            self.domain = domain
            self.name = name
            self.value = value

    fake_module = SimpleNamespace(
        arc=lambda: [Cookie(".x.com", "auth_token", "token"), Cookie(".x.com", "ct0", "csrf")],
        chrome=lambda: pytest.fail("chrome should not be used when arc succeeds"),
        edge=lambda: pytest.fail("edge should not be used when arc succeeds"),
        firefox=lambda: pytest.fail("firefox should not be used when arc succeeds"),
        brave=lambda: pytest.fail("brave should not be used when arc succeeds"),
    )
    monkeypatch.setitem(sys.modules, "browser_cookie3", fake_module)

    cookies = auth._extract_in_process()

    assert cookies is not None
    assert cookies["auth_token"] == "token"
    assert cookies["ct0"] == "csrf"


def test_extract_via_subprocess_script_includes_arc(monkeypatch) -> None:
    class Completed:
        def __init__(self, stdout: str, stderr: str = "") -> None:
            self.stdout = stdout
            self.stderr = stderr

    seen = {}

    def _run(cmd, capture_output=True, text=True, timeout=15):
        script = cmd[-1]
        seen["script"] = script
        return Completed(json.dumps({"error": "No Twitter cookies found", "attempts": []}))

    monkeypatch.setattr(auth.subprocess, "run", _run)

    cookies = auth._extract_via_subprocess()

    assert cookies is None
    assert '("arc", browser_cookie3.arc)' in seen["script"]


def test_extract_via_subprocess_retries_uv_when_current_env_has_no_output(monkeypatch) -> None:
    class Completed:
        def __init__(self, stdout: str, stderr: str = "") -> None:
            self.stdout = stdout
            self.stderr = stderr

    calls = []

    def _run(cmd, capture_output=True, text=True, timeout=15):
        calls.append(cmd)
        if cmd[0] == sys.executable:
            return Completed("", "")
        return Completed(json.dumps({"auth_token": "token", "ct0": "csrf", "browser": "arc"}))

    monkeypatch.setattr(auth.subprocess, "run", _run)

    cookies = auth._extract_via_subprocess()

    assert cookies == {"auth_token": "token", "ct0": "csrf"}
    assert len(calls) == 2
    assert calls[1][:5] == ["uv", "run", "--with", "browser-cookie3", "python"]


def test_verify_cookies_logs_attempt_summary_on_non_auth_failures(monkeypatch, caplog) -> None:
    class Response:
        def __init__(self, status_code: int, payload=None) -> None:
            self.status_code = status_code
            self._payload = payload or {}

        def json(self):
            return self._payload

    class Session:
        def __init__(self) -> None:
            self.calls = 0

        def get(self, url, headers=None, timeout=5):
            self.calls += 1
            if self.calls == 1:
                return Response(404)
            raise Exception("network")

    monkeypatch.setattr("twitter_cli.client._get_cffi_session", lambda: Session())

    with caplog.at_level("INFO"):
        result = auth.verify_cookies("token", "csrf")

    assert result == {}
    assert "verify_credentials.json=404" in caplog.text
    assert "settings.json=Exception" in caplog.text
