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
    "fetch the current user profile. Prefer JSON output for agent workflows."
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
            "CLI alias: edstem skills add",
        ]
    )


def build_install_command(extra_args: Iterable[str] = ()) -> List[str]:
    # type: (Iterable[str]) -> List[str]
    """Build the delegated `npx skills add` command."""
    return ["npx", "skills", "add", SKILL_SOURCE, *list(extra_args)]


def install_skill(extra_args: Iterable[str] = ()) -> None:
    # type: (Iterable[str]) -> None
    """Install the skill by delegating to the shared skills CLI."""
    if shutil.which("npx") is None:
        raise RuntimeError(
            "npx is required to install agent skills. "
            "Install Node.js, then run `npx skills add %s`." % SKILL_SOURCE
        )

    command = build_install_command(extra_args)
    try:
        completed = subprocess.run(command, check=False)
    except OSError as exc:
        raise RuntimeError("Failed to launch `%s`: %s" % (" ".join(command), exc)) from exc

    if completed.returncode != 0:
        raise RuntimeError(
            "`%s` exited with status %d." % (" ".join(command), completed.returncode)
        )
