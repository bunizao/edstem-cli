"""Self-update helpers for the edstem CLI."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from importlib import metadata
from pathlib import Path
from typing import Any, Dict, List, Optional

PACKAGE_NAME = "edstem-cli"


def _load_direct_url() -> Optional[Dict[str, Any]]:
    # type: () -> Optional[Dict[str, Any]]
    """Return direct install metadata when available."""
    try:
        dist = metadata.distribution(PACKAGE_NAME)
    except metadata.PackageNotFoundError:
        return None

    raw = dist.read_text("direct_url.json")
    if not raw:
        return None

    try:
        return json.loads(raw)
    except ValueError:
        return None


def build_update_command() -> List[str]:
    # type: () -> List[str]
    """Build the best-effort update command for the current install."""
    direct_url = _load_direct_url()
    if direct_url is not None:
        raise RuntimeError(
            "This copy was installed from a direct URL or local path. "
            "Update it from that source instead of using `edstem update`."
        )

    executable = Path(sys.executable)
    parts = {part.lower() for part in executable.parts}

    if "pipx" in parts:
        if shutil.which("pipx") is None:
            raise RuntimeError("Detected a pipx install, but `pipx` is not on PATH.")
        return ["pipx", "upgrade", PACKAGE_NAME]

    if "uv" in parts and "tools" in parts:
        if shutil.which("uv") is None:
            raise RuntimeError("Detected a uv tool install, but `uv` is not on PATH.")
        return ["uv", "tool", "upgrade", PACKAGE_NAME]

    return [sys.executable, "-m", "pip", "install", "--upgrade", PACKAGE_NAME]


def perform_update() -> None:
    # type: () -> None
    """Run the package manager update command."""
    command = build_update_command()
    try:
        completed = subprocess.run(command, check=False)
    except OSError as exc:
        raise RuntimeError("Failed to launch the updater: %s" % exc) from exc

    if completed.returncode != 0:
        raise RuntimeError("Update failed with exit status %d." % completed.returncode)
