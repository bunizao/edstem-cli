"""Skill metadata and npx skills integration helpers."""

from __future__ import annotations

import shutil
import subprocess
from typing import Iterable, List

SKILL_NAME = "edstem-cli"
SKILL_DESCRIPTION = (
    "Inspect Ed Discussion from the terminal with the `edstem` CLI. "
    "Use when an agent needs to list courses, browse or filter lessons or threads "
    "in a course, open a lesson or thread by ID, inspect recent activity, or "
    "fetch the current user profile. Prefer JSON output for agent workflows, "
    "with compact thread JSON available by default."
)
SKILL_SOURCE = "https://github.com/bunizao/edstem-cli"
SKILLS_SPEC_URL = "https://github.com/vercel-labs/skills"


def format_skill_summary() -> str:
    # type: () -> str
    """Return the skill summary shown by `edstem skills`."""
    return "\n".join(
        [
            "Name: %s" % SKILL_NAME,
            "Description: %s" % SKILL_DESCRIPTION,
            "Source: %s" % SKILL_SOURCE,
            "Spec: %s" % SKILLS_SPEC_URL,
            "Install: npx skills add %s" % SKILL_SOURCE,
            "CLI alias: edstem skills add (falls back to npm exec)",
        ]
    )


def build_install_command(extra_args: Iterable[str] = (), launcher: str = "npx") -> List[str]:
    # type: (Iterable[str], str) -> List[str]
    """Build the delegated skills install command."""
    command_args = list(extra_args)
    if launcher == "npx":
        return ["npx", "skills", "add", SKILL_SOURCE, *command_args]
    if launcher == "npm":
        return ["npm", "exec", "--yes", "--", "skills", "add", SKILL_SOURCE, *command_args]
    raise ValueError("Unsupported launcher: %s" % launcher)


def install_skill(extra_args: Iterable[str] = ()) -> None:
    # type: (Iterable[str]) -> None
    """Install the skill by delegating to the shared skills CLI."""
    if shutil.which("npx") is not None:
        command = build_install_command(extra_args, launcher="npx")
    elif shutil.which("npm") is not None:
        command = build_install_command(extra_args, launcher="npm")
    else:
        raise RuntimeError(
            "npx or npm is required to install agent skills. "
            "Install Node.js, then run `npx skills add %s`." % SKILL_SOURCE
        )

    try:
        completed = subprocess.run(command, check=False)
    except OSError as exc:
        raise RuntimeError("Failed to launch `%s`: %s" % (" ".join(command), exc)) from exc

    if completed.returncode != 0:
        raise RuntimeError(
            "`%s` exited with status %d." % (" ".join(command), completed.returncode)
        )
