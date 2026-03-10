from __future__ import annotations

from pathlib import Path

from edstem_cli.config import DEFAULT_CONFIG, load_config
from edstem_cli.constants import get_api_base_url


def test_load_config_from_yaml(tmp_path: Path) -> None:
    config_file = tmp_path / "config.yaml"
    config_file.write_text(
        "\n".join(
            [
                "fetch:",
                "  count: 25",
            ]
        ),
        encoding="utf-8",
    )

    config = load_config(str(config_file))
    assert config["fetch"]["count"] == 25


def test_load_config_invalid_yaml_falls_back_to_defaults(tmp_path: Path) -> None:
    config_file = tmp_path / "config.yaml"
    config_file.write_text("fetch: [", encoding="utf-8")

    config = load_config(str(config_file))
    assert config["fetch"]["count"] == DEFAULT_CONFIG["fetch"]["count"]


def test_load_config_does_not_mutate_defaults(tmp_path: Path) -> None:
    config = load_config(str(tmp_path / "missing-config.yaml"))
    config["fetch"]["count"] = 999
    assert DEFAULT_CONFIG["fetch"]["count"] == 30


def test_get_api_base_url_reads_env_override(monkeypatch) -> None:
    monkeypatch.setenv("ED_API_BASE_URL", "https://example.com/custom-api")
    assert get_api_base_url() == "https://example.com/custom-api/"
