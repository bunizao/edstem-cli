from __future__ import annotations

import pytest

from edstem_cli.skill_bundle import build_install_command, install_skill


def test_build_install_command_appends_extra_args() -> None:
    assert build_install_command(["--agent", "codex"]) == [
        "npx",
        "skills",
        "add",
        "https://github.com/bunizao/edstem-cli",
        "--agent",
        "codex",
    ]


def test_build_install_command_supports_npm_exec() -> None:
    assert build_install_command(["--agent", "codex"], launcher="npm") == [
        "npm",
        "exec",
        "--yes",
        "--",
        "skills",
        "add",
        "https://github.com/bunizao/edstem-cli",
        "--agent",
        "codex",
    ]


def test_install_skill_requires_node_launcher(monkeypatch) -> None:
    monkeypatch.setattr("edstem_cli.skill_bundle.shutil.which", lambda name: None)

    with pytest.raises(RuntimeError, match="npx or npm is required"):
        install_skill()


def test_install_skill_runs_npx_skills_add(monkeypatch) -> None:
    captured = {}

    class CompletedProcess:
        returncode = 0

    monkeypatch.setattr("edstem_cli.skill_bundle.shutil.which", lambda name: "/usr/bin/npx")

    def fake_run(command, check=False):
        captured["command"] = command
        captured["check"] = check
        return CompletedProcess()

    monkeypatch.setattr("edstem_cli.skill_bundle.subprocess.run", fake_run)

    install_skill(["--agent", "codex", "--yes"])

    assert captured == {
        "command": [
            "npx",
            "skills",
            "add",
            "https://github.com/bunizao/edstem-cli",
            "--agent",
            "codex",
            "--yes",
        ],
        "check": False,
    }


def test_install_skill_falls_back_to_npm_exec(monkeypatch) -> None:
    captured = {}

    class CompletedProcess:
        returncode = 0

    def fake_which(name):
        if name == "npx":
            return None
        if name == "npm":
            return "/usr/bin/npm"
        return None

    def fake_run(command, check=False):
        captured["command"] = command
        captured["check"] = check
        return CompletedProcess()

    monkeypatch.setattr("edstem_cli.skill_bundle.shutil.which", fake_which)
    monkeypatch.setattr("edstem_cli.skill_bundle.subprocess.run", fake_run)

    install_skill(["--agent", "codex"])

    assert captured == {
        "command": [
            "npm",
            "exec",
            "--yes",
            "--",
            "skills",
            "add",
            "https://github.com/bunizao/edstem-cli",
            "--agent",
            "codex",
        ],
        "check": False,
    }
