from __future__ import annotations

import pytest

from edstem_cli.self_update import build_update_command, perform_update


def test_build_update_command_uses_uv_tool_for_uv_install(monkeypatch) -> None:
    class FakeDist:
        def read_text(self, name):
            return None

    monkeypatch.setattr("edstem_cli.self_update.metadata.distribution", lambda name: FakeDist())
    monkeypatch.setattr("edstem_cli.self_update.sys.executable", "/Users/tutu/.local/share/uv/tools/edstem-cli/bin/python")
    monkeypatch.setattr("edstem_cli.self_update.shutil.which", lambda name: "/usr/bin/uv" if name == "uv" else None)

    assert build_update_command() == ["uv", "tool", "upgrade", "edstem-cli"]


def test_build_update_command_uses_pipx_for_pipx_install(monkeypatch) -> None:
    class FakeDist:
        def read_text(self, name):
            return None

    monkeypatch.setattr("edstem_cli.self_update.metadata.distribution", lambda name: FakeDist())
    monkeypatch.setattr("edstem_cli.self_update.sys.executable", "/Users/tutu/.local/pipx/venvs/edstem-cli/bin/python")
    monkeypatch.setattr("edstem_cli.self_update.shutil.which", lambda name: "/usr/bin/pipx" if name == "pipx" else None)

    assert build_update_command() == ["pipx", "upgrade", "edstem-cli"]


def test_build_update_command_falls_back_to_pip(monkeypatch) -> None:
    class FakeDist:
        def read_text(self, name):
            return None

    monkeypatch.setattr("edstem_cli.self_update.metadata.distribution", lambda name: FakeDist())
    monkeypatch.setattr("edstem_cli.self_update.sys.executable", "/usr/bin/python3")

    assert build_update_command() == [
        "/usr/bin/python3",
        "-m",
        "pip",
        "install",
        "--upgrade",
        "edstem-cli",
    ]


def test_build_update_command_rejects_direct_url_install(monkeypatch) -> None:
    class FakeDist:
        def read_text(self, name):
            return '{"url": "file:///Users/tutu/dev/edstem-cli", "dir_info": {"editable": true}}'

    monkeypatch.setattr("edstem_cli.self_update.metadata.distribution", lambda name: FakeDist())

    with pytest.raises(RuntimeError, match="direct URL or local path"):
        build_update_command()


def test_perform_update_runs_command(monkeypatch) -> None:
    captured = {}

    class FakeDist:
        def read_text(self, name):
            return None

    class CompletedProcess:
        returncode = 0

    monkeypatch.setattr("edstem_cli.self_update.metadata.distribution", lambda name: FakeDist())
    monkeypatch.setattr("edstem_cli.self_update.sys.executable", "/usr/bin/python3")

    def fake_run(command, check=False):
        captured["command"] = command
        captured["check"] = check
        return CompletedProcess()

    monkeypatch.setattr("edstem_cli.self_update.subprocess.run", fake_run)

    perform_update()

    assert captured == {
        "command": [
            "/usr/bin/python3",
            "-m",
            "pip",
            "install",
            "--upgrade",
            "edstem-cli",
        ],
        "check": False,
    }
