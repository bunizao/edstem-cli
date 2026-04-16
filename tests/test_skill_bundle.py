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


def test_install_skill_requires_npx(monkeypatch) -> None:
    monkeypatch.setattr("edstem_cli.skill_bundle.shutil.which", lambda name: None)

    with pytest.raises(RuntimeError, match="npx is required"):
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
