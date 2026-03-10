from __future__ import annotations

from click.testing import CliRunner

from edstem_cli.cli import cli
from edstem_cli.models import Course, User


def test_cli_user_command_works(monkeypatch) -> None:
    class FakeClient:
        def fetch_user(self):
            return (
                User(id=1, name="Alice", email="alice@test.com"),
                [Course(id=100, code="CS101", name="Intro")],
            )

    monkeypatch.setattr("edstem_cli.cli._get_client", lambda: FakeClient())
    runner = CliRunner()
    result = runner.invoke(cli, ["user"])
    assert result.exit_code == 0
    assert "Alice" in result.output


def test_cli_courses_json(monkeypatch) -> None:
    class FakeClient:
        def fetch_user(self):
            return (
                User(id=1, name="Alice"),
                [Course(id=100, code="CS101", name="Intro", year="2026", session="Spring")],
            )

    monkeypatch.setattr("edstem_cli.cli._get_client", lambda: FakeClient())
    runner = CliRunner()
    result = runner.invoke(cli, ["courses", "--json"])
    assert result.exit_code == 0
    assert '"code": "CS101"' in result.output


def test_cli_threads_wraps_client_errors(monkeypatch) -> None:
    monkeypatch.setattr(
        "edstem_cli.cli._get_client",
        lambda: (_ for _ in ()).throw(RuntimeError("auth failed")),
    )
    runner = CliRunner()
    result = runner.invoke(cli, ["threads", "100"])
    assert result.exit_code == 1
    assert "auth failed" in result.output


def test_cli_thread_by_id(monkeypatch, thread_factory) -> None:
    class FakeClient:
        def fetch_thread(self, thread_id):
            assert thread_id == 5001
            return thread_factory(5001, title="Test thread")

    monkeypatch.setattr("edstem_cli.cli._get_client", lambda: FakeClient())
    runner = CliRunner()
    result = runner.invoke(cli, ["thread", "5001"])
    assert result.exit_code == 0


def test_cli_thread_by_course_number(monkeypatch, thread_factory) -> None:
    class FakeClient:
        def fetch_course_thread(self, course_id, number):
            assert course_id == 100
            assert number == 42
            return thread_factory(5001, number=42)

    monkeypatch.setattr("edstem_cli.cli._get_client", lambda: FakeClient())
    runner = CliRunner()
    result = runner.invoke(cli, ["thread", "100#42"])
    assert result.exit_code == 0


def test_cli_activity_command(monkeypatch) -> None:
    class FakeClient:
        def fetch_user(self):
            return (User(id=1, name="Alice"), [])

        def fetch_user_activity(self, user_id, course_id=None, limit=30, offset=0,
                                filter_type="all"):
            return [{"type": "thread", "value": {"title": "Hello", "course_code": "CS101",
                                                  "created_at": "2026-01-15"}}]

    monkeypatch.setattr("edstem_cli.cli._get_client", lambda: FakeClient())
    runner = CliRunner()
    result = runner.invoke(cli, ["activity"])
    assert result.exit_code == 0
