from __future__ import annotations

from pathlib import Path

from edstem_cli.config import load_config


def test_fetch_count_normalization(tmp_path: Path) -> None:
    config_file = tmp_path / "config.yaml"
    config_file.write_text(
        "\n".join(
            [
                "fetch:",
                "  count: -5",
            ]
        ),
        encoding="utf-8",
    )

    config = load_config(str(config_file))
    assert config["fetch"]["count"] == 1


def test_rate_limit_normalization(tmp_path: Path) -> None:
    config_file = tmp_path / "config.yaml"
    config_file.write_text(
        "\n".join(
            [
                "rateLimit:",
                "  requestDelay: -2",
                "  maxRetries: bad",
                "  retryBaseDelay: 0.1",
                "  maxCount: 0",
            ]
        ),
        encoding="utf-8",
    )

    config = load_config(str(config_file))
    assert config["rateLimit"]["requestDelay"] == 0.0  # clamped to >= 0
    assert config["rateLimit"]["maxRetries"] == 3  # fallback to default
    assert config["rateLimit"]["retryBaseDelay"] == 1.0  # clamped to >= 1.0
    assert config["rateLimit"]["maxCount"] == 1  # clamped to >= 1
