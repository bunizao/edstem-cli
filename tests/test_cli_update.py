from __future__ import annotations

from click.testing import CliRunner

from edstem_cli.cli import cli


def test_cli_update_command_calls_updater(monkeypatch) -> None:
    captured = {}

    def fake_perform_update():
        captured["called"] = True

    monkeypatch.setattr("edstem_cli.cli.perform_update", fake_perform_update)

    runner = CliRunner()
    result = runner.invoke(cli, ["update"])

    assert result.exit_code == 0
    assert captured == {"called": True}
    assert "Updated edstem-cli." in result.output
