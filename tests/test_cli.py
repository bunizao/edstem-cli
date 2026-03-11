from __future__ import annotations

import json

from click.testing import CliRunner

from edstem_cli import __version__
from edstem_cli.cli import _filter_courses, _filter_lessons, _parse_thread_ref, _resolve_fetch_count, cli
from edstem_cli.models import Course, User


def _json_from_result_output(result) -> object:
    # type: (object) -> object
    """Extract JSON payload from Click test output across Click versions."""
    output = result.output
    if output.startswith("Saved to "):
        output = output.split("\n", 1)[1]
    return json.loads(output)


def test_resolve_fetch_count_uses_max_when_provided() -> None:
    assert _resolve_fetch_count(5, 30) == 5


def test_resolve_fetch_count_rejects_non_positive_values() -> None:
    try:
        _resolve_fetch_count(0, 30)
    except RuntimeError as exc:
        assert "--max must be greater than 0" in str(exc)
    else:
        raise AssertionError("_resolve_fetch_count should reject non-positive values")


def test_parse_thread_ref_accepts_thread_id() -> None:
    assert _parse_thread_ref("5001") == (5001, None)


def test_parse_thread_ref_accepts_course_thread_number() -> None:
    assert _parse_thread_ref("100#42") == (100, 42)


def test_parse_thread_ref_rejects_invalid_input() -> None:
    try:
        _parse_thread_ref("bad#42")
    except RuntimeError as exc:
        assert "Invalid thread reference" in str(exc)
    else:
        raise AssertionError("_parse_thread_ref should reject malformed references")


def test_filter_courses_hides_archived_by_default(course_factory) -> None:
    course_list = [
        course_factory(100, status="active"),
        course_factory(200, code="MATH201", status="archived"),
    ]

    filtered = _filter_courses(course_list)

    assert [course.id for course in filtered] == [100]


def test_filter_courses_includes_archived_with_flag(course_factory) -> None:
    course_list = [
        course_factory(100, status="active"),
        course_factory(200, code="MATH201", status="archived"),
    ]

    filtered = _filter_courses(course_list, include_archived=True)

    assert [course.id for course in filtered] == [100, 200]


def test_filter_lessons_matches_module_type_state_and_status(lesson_factory) -> None:
    lesson_list = [
        lesson_factory(1, module_id=7, module_name="Week 1", type="general", state="active",
                       status="attempted"),
        lesson_factory(2, module_id=8, module_name="Week 2", type="python", state="scheduled",
                       status="unattempted"),
    ]

    filtered = _filter_lessons(
        lesson_list,
        module="week 2",
        lesson_type="python",
        state="scheduled",
        status="unattempted",
    )

    assert [lesson.id for lesson in filtered] == [2]


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
    assert "Enrolled in 1 course(s)" in result.output


def test_cli_user_json_includes_courses(monkeypatch) -> None:
    class FakeClient:
        def fetch_user(self):
            return (
                User(id=1, name="Alice", email="alice@test.com"),
                [Course(id=100, code="CS101", name="Intro")],
            )

    monkeypatch.setattr("edstem_cli.cli._get_client", lambda: FakeClient())
    runner = CliRunner()
    result = runner.invoke(cli, ["user", "--json"])
    assert result.exit_code == 0
    payload = json.loads(result.output)
    assert payload["name"] == "Alice"
    assert payload["courses"][0]["code"] == "CS101"


def test_cli_courses_json(monkeypatch) -> None:
    class FakeClient:
        def fetch_user(self):
            return (
                User(id=1, name="Alice"),
                [
                    Course(id=100, code="CS101", name="Intro", year="2026", session="Spring"),
                    Course(
                        id=200,
                        code="MATH201",
                        name="Archived",
                        year="2025",
                        session="Fall",
                        status="archived",
                    ),
                ],
            )

    monkeypatch.setattr("edstem_cli.cli._get_client", lambda: FakeClient())
    runner = CliRunner()
    result = runner.invoke(cli, ["courses", "--json"])
    assert result.exit_code == 0
    payload = json.loads(result.output)
    assert [course["code"] for course in payload] == ["CS101"]


def test_cli_courses_archived_flag_includes_archived_courses(monkeypatch) -> None:
    class FakeClient:
        def fetch_user(self):
            return (
                User(id=1, name="Alice"),
                [
                    Course(id=100, code="CS101", name="Intro", year="2026", session="Spring"),
                    Course(
                        id=200,
                        code="MATH201",
                        name="Archived",
                        year="2025",
                        session="Fall",
                        status="archived",
                    ),
                ],
            )

    monkeypatch.setattr("edstem_cli.cli._get_client", lambda: FakeClient())
    runner = CliRunner()
    result = runner.invoke(cli, ["courses", "--archived", "--json"])
    assert result.exit_code == 0
    payload = json.loads(result.output)
    assert [course["code"] for course in payload] == ["CS101", "MATH201"]


def test_cli_courses_output_writes_file(monkeypatch, tmp_path) -> None:
    class FakeClient:
        def fetch_user(self):
            return (
                User(id=1, name="Alice"),
                [Course(id=100, code="CS101", name="Intro", year="2026", session="Spring")],
            )

    monkeypatch.setattr("edstem_cli.cli._get_client", lambda: FakeClient())
    output_file = tmp_path / "courses.json"
    runner = CliRunner()
    result = runner.invoke(cli, ["courses", "--output", str(output_file)])

    assert result.exit_code == 0
    assert output_file.exists()
    payload = json.loads(output_file.read_text(encoding="utf-8"))
    assert payload[0]["code"] == "CS101"
    assert "Saved to" in result.output


def test_cli_threads_wraps_client_errors(monkeypatch) -> None:
    monkeypatch.setattr(
        "edstem_cli.cli._get_client",
        lambda: (_ for _ in ()).throw(RuntimeError("auth failed")),
    )
    runner = CliRunner()
    result = runner.invoke(cli, ["threads", "100"])
    assert result.exit_code == 1
    assert "auth failed" in result.output


def test_cli_lessons_applies_filters_and_writes_json(monkeypatch, lesson_factory, tmp_path) -> None:
    captured = {}

    class FakeClient:
        def fetch_lessons(self, course_id):
            captured["course_id"] = course_id
            return (
                [],
                [
                    lesson_factory(
                        11,
                        title="Keep me",
                        module_name="Week 1",
                        type="general",
                        state="active",
                        status="attempted",
                    ),
                    lesson_factory(
                        12,
                        title="Drop me",
                        module_name="Week 2",
                        type="python",
                        state="scheduled",
                        status="unattempted",
                    ),
                ],
            )

    monkeypatch.setattr("edstem_cli.cli._get_client", lambda: FakeClient())
    output_file = tmp_path / "lessons.json"
    runner = CliRunner()
    result = runner.invoke(
        cli,
        [
            "lessons",
            "100",
            "--module",
            "Week 1",
            "--type",
            "general",
            "--state",
            "active",
            "--status",
            "attempted",
            "--json",
            "--output",
            str(output_file),
        ],
    )

    assert result.exit_code == 0
    payload = _json_from_result_output(result)
    assert [item["title"] for item in payload] == ["Keep me"]
    assert json.loads(output_file.read_text(encoding="utf-8"))[0]["title"] == "Keep me"
    assert "Saved to" in result.output
    assert captured == {"course_id": 100}


def test_cli_lesson_by_id(monkeypatch, lesson_factory) -> None:
    class FakeClient:
        def fetch_lesson(self, lesson_id):
            assert lesson_id == 7001
            return lesson_factory(7001, title="Lesson detail")

    monkeypatch.setattr("edstem_cli.cli._get_client", lambda: FakeClient())
    runner = CliRunner()
    result = runner.invoke(cli, ["lesson", "7001"])
    assert result.exit_code == 0
    assert "Lesson detail" in result.output


def test_cli_lesson_json(monkeypatch, lesson_factory) -> None:
    class FakeClient:
        def fetch_lesson(self, lesson_id):
            return lesson_factory(lesson_id, title="JSON lesson")

    monkeypatch.setattr("edstem_cli.cli._get_client", lambda: FakeClient())
    runner = CliRunner()
    result = runner.invoke(cli, ["lesson", "7001", "--json"])
    assert result.exit_code == 0
    payload = json.loads(result.output)
    assert payload["title"] == "JSON lesson"
    assert payload["slides"][0]["title"] == "Slide 1"


def test_cli_threads_applies_filters_and_writes_json(monkeypatch, thread_factory, tmp_path) -> None:
    captured = {}

    class FakeClient:
        def fetch_threads(self, course_id, limit=30, offset=0, sort="new"):
            captured["course_id"] = course_id
            captured["limit"] = limit
            captured["sort"] = sort
            return [
                thread_factory(1, title="Keep me", category="General", type="question",
                               is_answered=True),
                thread_factory(2, title="Drop me", category="HW1", type="post",
                               is_answered=False),
            ]

    monkeypatch.setattr("edstem_cli.cli._get_client", lambda: FakeClient())
    monkeypatch.setattr("edstem_cli.cli.load_config", lambda: {"fetch": {"count": 30}})
    output_file = tmp_path / "threads.json"
    runner = CliRunner()
    result = runner.invoke(
        cli,
        [
            "threads",
            "100",
            "--max",
            "5",
            "--sort",
            "top",
            "--category",
            "General",
            "--type",
            "question",
            "--answered",
            "--json",
            "--output",
            str(output_file),
        ],
    )

    assert result.exit_code == 0
    payload = _json_from_result_output(result)
    assert [item["title"] for item in payload] == ["Keep me"]
    assert json.loads(output_file.read_text(encoding="utf-8"))[0]["title"] == "Keep me"
    assert "Saved to" in result.output
    assert captured == {"course_id": 100, "limit": 5, "sort": "top"}


def test_cli_threads_uses_configured_fetch_count(monkeypatch, thread_factory) -> None:
    captured = {}

    class FakeClient:
        def fetch_threads(self, course_id, limit=30, offset=0, sort="new"):
            captured["limit"] = limit
            return [thread_factory(1)]

    monkeypatch.setattr("edstem_cli.cli._get_client", lambda: FakeClient())
    monkeypatch.setattr("edstem_cli.cli.load_config", lambda: {"fetch": {"count": 12}})
    runner = CliRunner()
    result = runner.invoke(cli, ["threads", "100", "--json"])

    assert result.exit_code == 0
    assert captured["limit"] == 12


def test_cli_threads_rejects_invalid_max(monkeypatch) -> None:
    monkeypatch.setattr("edstem_cli.cli._get_client", lambda: object())
    runner = CliRunner()
    result = runner.invoke(cli, ["threads", "100", "--max", "0"])
    assert result.exit_code == 1
    assert "--max must be greater than 0" in result.output


def test_cli_thread_by_id(monkeypatch, thread_factory) -> None:
    class FakeClient:
        def fetch_thread(self, thread_id):
            assert thread_id == 5001
            return thread_factory(5001, title="Test thread")

    monkeypatch.setattr("edstem_cli.cli._get_client", lambda: FakeClient())
    runner = CliRunner()
    result = runner.invoke(cli, ["thread", "5001"])
    assert result.exit_code == 0
    assert "Test thread" in result.output


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


def test_cli_thread_json(monkeypatch, thread_factory) -> None:
    class FakeClient:
        def fetch_thread(self, thread_id):
            return thread_factory(thread_id, title="JSON thread", number=9)

    monkeypatch.setattr("edstem_cli.cli._get_client", lambda: FakeClient())
    runner = CliRunner()
    result = runner.invoke(cli, ["thread", "5001", "--json"])
    assert result.exit_code == 0
    payload = json.loads(result.output)
    assert payload["title"] == "JSON thread"
    assert payload["number"] == 9


def test_cli_thread_rejects_invalid_reference() -> None:
    runner = CliRunner()
    result = runner.invoke(cli, ["thread", "oops"])
    assert result.exit_code == 1
    assert "Invalid thread ID" in result.output


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
    assert "Hello" in result.output


def test_cli_activity_json_passes_course_and_filter(monkeypatch) -> None:
    captured = {}

    class FakeClient:
        def fetch_user(self):
            return (User(id=11, name="Alice"), [])

        def fetch_user_activity(self, user_id, course_id=None, limit=30, offset=0,
                                filter_type="all"):
            captured["user_id"] = user_id
            captured["course_id"] = course_id
            captured["limit"] = limit
            captured["filter_type"] = filter_type
            return [{"type": "comment", "value": {"document": "Hi"}}]

    monkeypatch.setattr("edstem_cli.cli._get_client", lambda: FakeClient())
    monkeypatch.setattr("edstem_cli.cli.load_config", lambda: {"fetch": {"count": 30}})
    runner = CliRunner()
    result = runner.invoke(cli, ["activity", "100", "--max", "7", "--filter", "comment", "--json"])

    assert result.exit_code == 0
    assert json.loads(result.output)[0]["type"] == "comment"
    assert captured == {
        "user_id": 11,
        "course_id": 100,
        "limit": 7,
        "filter_type": "comment",
    }


def test_cli_version_option() -> None:
    runner = CliRunner()
    result = runner.invoke(cli, ["--version"])
    assert result.exit_code == 0
    assert __version__ in result.output
