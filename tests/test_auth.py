from __future__ import annotations

import click
import requests

from edstem_cli import auth


def test_get_token_prefers_env(monkeypatch) -> None:
    monkeypatch.setattr(auth, "load_from_env", lambda: "env-token")
    monkeypatch.setattr(auth, "load_from_file", lambda: None)
    monkeypatch.setattr(auth, "verify_token", lambda token: {"user": {"id": 1}})

    token = auth.get_token()
    assert token == "env-token"


def test_get_token_falls_back_to_file(monkeypatch) -> None:
    monkeypatch.setattr(auth, "load_from_env", lambda: None)
    monkeypatch.setattr(auth, "load_from_file", lambda: "file-token")
    monkeypatch.setattr(auth, "verify_token", lambda token: {"user": {"id": 1}})

    token = auth.get_token()
    assert token == "file-token"


def test_get_token_prompts_when_no_saved_token(monkeypatch) -> None:
    monkeypatch.setattr(auth, "load_from_env", lambda: None)
    monkeypatch.setattr(auth, "load_from_file", lambda: None)
    monkeypatch.setattr(auth, "prompt_for_token", lambda: "prompt-token")
    monkeypatch.setattr(auth, "verify_token", lambda token: {"user": {"id": 1}})

    token = auth.get_token()
    assert token == "prompt-token"


def test_prompt_for_token_shows_help_url_and_saves(monkeypatch) -> None:
    messages = []
    saved = []

    monkeypatch.setattr(click, "echo", messages.append)
    monkeypatch.setattr(click, "prompt", lambda *args, **kwargs: "  prompt-token  ")
    monkeypatch.setattr(auth, "save_token", saved.append)

    token = auth.prompt_for_token()

    assert token == "prompt-token"
    assert saved == ["prompt-token"]
    assert messages == [
        "\nNo Ed API token found.\n"
        "Get your API token from: https://edstem.org/settings/api-tokens\n"
    ]


def test_load_from_env_reads_env_var(monkeypatch) -> None:
    monkeypatch.setenv("ED_API_TOKEN", "  my-token  ")
    token = auth.load_from_env()
    assert token == "my-token"


def test_load_from_env_returns_none_when_empty(monkeypatch) -> None:
    monkeypatch.delenv("ED_API_TOKEN", raising=False)
    assert auth.load_from_env() is None


def test_save_and_load_token(tmp_path, monkeypatch) -> None:
    token_file = tmp_path / "token"
    monkeypatch.setattr(auth, "_TOKEN_DIR", tmp_path)
    monkeypatch.setattr(auth, "_TOKEN_FILE", token_file)

    auth.save_token("  test-token  ")
    assert token_file.exists()

    loaded = auth.load_from_file()
    assert loaded == "test-token"


def test_verify_token_handles_bad_token_response(monkeypatch) -> None:
    class FakeResponse:
        status_code = 400
        ok = False
        headers = {"content-type": "application/json"}

        @staticmethod
        def json():
            return {"code": "bad_token", "message": "Invalid token"}

    monkeypatch.setattr("requests.get", lambda *args, **kwargs: FakeResponse())

    try:
        auth.verify_token("bad-token")
    except RuntimeError as exc:
        assert "Invalid or expired Ed API token" in str(exc)
    else:
        raise AssertionError("verify_token should reject a bad token")


def test_verify_token_handles_network_errors(monkeypatch) -> None:
    def _raise(*args, **kwargs):
        raise requests.RequestException("boom")

    monkeypatch.setattr("requests.get", _raise)

    try:
        auth.verify_token("token")
    except RuntimeError as exc:
        assert "Failed to reach the Ed API" in str(exc)
    else:
        raise AssertionError("verify_token should wrap request failures")


def test_verify_token_handles_redirects(monkeypatch) -> None:
    class FakeResponse:
        status_code = 302
        ok = False
        headers = {"location": "https://edstem.org"}

        @staticmethod
        def json():
            return {}

    monkeypatch.setattr("requests.get", lambda *args, **kwargs: FakeResponse())

    try:
        auth.verify_token("token")
    except RuntimeError as exc:
        assert "redirected to https://edstem.org" in str(exc)
    else:
        raise AssertionError("verify_token should reject redirected API endpoints")


def test_verify_token_handles_non_json_success(monkeypatch) -> None:
    class FakeResponse:
        status_code = 200
        ok = True
        headers = {"content-type": "text/html"}

        @staticmethod
        def json():
            raise ValueError("not json")

    monkeypatch.setattr("requests.get", lambda *args, **kwargs: FakeResponse())

    try:
        auth.verify_token("token")
    except RuntimeError as exc:
        assert "non-JSON response" in str(exc)
    else:
        raise AssertionError("verify_token should reject non-JSON success responses")
