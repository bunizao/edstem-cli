from __future__ import annotations

import json

from click.testing import CliRunner

from edstem_cli import __version__
from edstem_cli.cli import _filter_courses, _filter_lessons, _parse_thread_ref, _resolve_fetch_count, cli
from edstem_cli.models import Comment, Course, LessonQuestion, LessonQuestionResponse, User


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


def test_cli_skills_outputs_name_description_and_install_command() -> None:
    runner = CliRunner()
    result = runner.invoke(cli, ["skills"])

    assert result.exit_code == 0
    assert "Name: edstem-cli" in result.output
    assert "Description: Inspect Ed Discussion from the terminal" in result.output
    assert "Install: npx skills add https://github.com/bunizao/edstem-cli" in result.output
    assert "CLI alias: edstem skills add (falls back to npm exec)" in result.output


def test_cli_skills_add_delegates_extra_args(monkeypatch) -> None:
    captured = {}

    def fake_install_skill(extra_args):
        captured["args"] = list(extra_args)

    monkeypatch.setattr("edstem_cli.cli.install_skill", fake_install_skill)
    runner = CliRunner()
    result = runner.invoke(cli, ["skills", "add", "--agent", "codex", "--yes"])

    assert result.exit_code == 0
    assert captured["args"] == ["--agent", "codex", "--yes"]


def test_cli_skills_install_alias_delegates_extra_args(monkeypatch) -> None:
    captured = {"calls": []}

    def fake_install_skill(extra_args):
        captured["calls"].append(list(extra_args))

    monkeypatch.setattr("edstem_cli.cli.install_skill", fake_install_skill)
    runner = CliRunner()
    install_result = runner.invoke(cli, ["skills", "install", "--agent", "claude"])
    short_result = runner.invoke(cli, ["skills", "i", "--agent", "cursor"])

    assert install_result.exit_code == 0
    assert short_result.exit_code == 0
    assert captured["calls"] == [["--agent", "claude"], ["--agent", "cursor"]]


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


def test_cli_lessons_legacy_invocation_accepts_options_before_course_id(
    monkeypatch, lesson_factory
) -> None:
    class FakeClient:
        def fetch_lessons(self, course_id):
            assert course_id == 100
            return (
                [],
                [
                    lesson_factory(11, title="Week 1 - Pre-Reading", module_name="Week 1"),
                    lesson_factory(12, title="Week 2 - Applied", module_name="Week 2"),
                ],
            )

    monkeypatch.setattr("edstem_cli.cli._get_client", lambda: FakeClient())
    runner = CliRunner()
    result = runner.invoke(cli, ["lessons", "--module", "Week 1", "--json", "100"])

    assert result.exit_code == 0
    payload = json.loads(result.output)
    assert payload == [
        {
            "id": 11,
            "moduleId": 10,
            "moduleName": "Week 1",
            "number": 11,
            "title": "Week 1 - Pre-Reading",
            "type": "general",
            "kind": "content",
            "state": "active",
            "status": "attempted",
            "outline": "<document><paragraph>Outline</paragraph></document>",
            "slideCount": 1,
            "slides": [
                {
                    "id": 11,
                    "lessonId": 11,
                    "courseId": 100,
                    "title": "Slide 1",
                    "type": "document",
                    "content": "<document><paragraph>Hello lesson</paragraph></document>",
                    "index": 1,
                    "status": "completed",
                    "isHidden": False,
                }
            ],
            "openable": True,
            "createdAt": "2026-01-01T10:00:00.000Z",
            "availableAt": "2026-01-10T10:00:00.000Z",
            "dueAt": "2026-01-20T10:00:00.000Z",
            "updatedAt": "2026-01-02T10:00:00.000Z",
        }
    ]


def test_cli_slide_questions_json(monkeypatch) -> None:
    class FakeClient:
        def fetch_slide_questions(self, slide_id):
            assert slide_id == 654529
            return [
                LessonQuestion(
                    id=256385,
                    slide_id=slide_id,
                    index=0,
                    type="multiple-choice",
                    content="<document><paragraph>Pick one</paragraph></document>",
                    answers=[
                        "<document><paragraph>A</paragraph></document>",
                        "<document><paragraph>B</paragraph></document>",
                    ],
                    solution=[1],
                )
            ]

    monkeypatch.setattr("edstem_cli.cli._get_client", lambda: FakeClient())
    runner = CliRunner()
    result = runner.invoke(cli, ["lessons", "quiz", "654529", "--json"])

    assert result.exit_code == 0
    payload = json.loads(result.output)
    assert payload[0]["id"] == 256385
    assert payload[0]["answers"] == [
        "<document><paragraph>A</paragraph></document>",
        "<document><paragraph>B</paragraph></document>",
    ]


def test_cli_slide_responses_json(monkeypatch) -> None:
    class FakeClient:
        def fetch_slide_question_responses(self, slide_id):
            assert slide_id == 654529
            return [
                LessonQuestionResponse(
                    question_id=256385,
                    user_id=1,
                    created_at="2026-01-01T00:00:00Z",
                    correct=True,
                    data=[1],
                )
            ]

    monkeypatch.setattr("edstem_cli.cli._get_client", lambda: FakeClient())
    runner = CliRunner()
    result = runner.invoke(cli, ["lessons", "quiz", "654529", "--responses", "--json"])

    assert result.exit_code == 0
    payload = json.loads(result.output)
    assert payload == [
        {
            "questionId": 256385,
            "userId": 1,
            "data": [1],
            "createdAt": "2026-01-01T00:00:00Z",
            "correct": True,
        }
    ]


def test_cli_slide_answer_converts_one_based_choices(monkeypatch) -> None:
    captured = {}

    class FakeClient:
        def submit_slide_question_response(self, question_id, response, amend=False):
            captured["question_id"] = question_id
            captured["response"] = response
            captured["amend"] = amend
            return {"slideCompleted": True, "correct": True, "solution": [1]}

    monkeypatch.setattr("edstem_cli.cli._get_client", lambda: FakeClient())
    runner = CliRunner()
    result = runner.invoke(
        cli,
        ["lessons", "quiz", "654529", "--answer", "256385", "--choice", "2", "--json"],
    )

    assert result.exit_code == 0
    payload = json.loads(result.output)
    assert payload["correct"] is True
    assert captured == {"question_id": 256385, "response": [1], "amend": False}


def test_cli_slide_submit_json(monkeypatch) -> None:
    class FakeClient:
        def submit_all_slide_questions(self, slide_id):
            assert slide_id == 654529
            return True

    monkeypatch.setattr("edstem_cli.cli._get_client", lambda: FakeClient())
    runner = CliRunner()
    result = runner.invoke(cli, ["lessons", "quiz", "654529", "--submit", "--json"])

    assert result.exit_code == 0
    assert json.loads(result.output) == {"submitted": True}


def test_cli_lesson_quiz_rejects_multiple_actions(monkeypatch) -> None:
    class FakeClient:
        pass

    monkeypatch.setattr("edstem_cli.cli._get_client", lambda: FakeClient())
    runner = CliRunner()
    result = runner.invoke(
        cli,
        ["lessons", "quiz", "654529", "--responses", "--submit"],
    )

    assert result.exit_code == 1
    assert "Use only one of --responses, --answer, or --submit" in result.output


def test_cli_lessons_read_filters_queries_and_marks_matching_lessons(
    monkeypatch, lesson_factory
) -> None:
    applied_slide = lesson_factory(12).slides[0]
    applied_slide.id = 101

    class FakeClient:
        def __init__(self):
            self.viewed_lessons = []
            self.viewed_slides = []
            self.completed_slides = []

        def fetch_lessons(self, course_id):
            assert course_id == 100
            return (
                [],
                [
                    lesson_factory(
                        11,
                        title="Week 1 - Pre-Reading",
                        slides=[
                            lesson_factory(11).slides[0],
                        ],
                    ),
                    lesson_factory(
                        12,
                        title="Week 1 - Applied",
                        slides=[applied_slide],
                    ),
                ],
            )

        def fetch_lesson(self, lesson_id, view=False):
            if view:
                self.viewed_lessons.append(lesson_id)
            if lesson_id == 12:
                return lesson_factory(
                    12,
                    title="Week 1 - Applied",
                    slides=[applied_slide],
                    status="attempted",
                )
            return lesson_factory(lesson_id)

        def fetch_slide(self, slide_id, view=False):
            if view:
                self.viewed_slides.append(slide_id)
            return lesson_factory().slides[0]

        def complete_slide(self, slide_id):
            self.completed_slides.append(slide_id)

    fake_client = FakeClient()
    monkeypatch.setattr("edstem_cli.cli._get_client", lambda: fake_client)

    runner = CliRunner()
    result = runner.invoke(cli, ["lessons", "read", "100", "Week 1", "Applied", "--json"])

    assert result.exit_code == 0
    payload = json.loads(result.output)
    assert payload == [
        {
            "id": 12,
            "title": "Week 1 - Applied",
            "status": "attempted",
            "completedSlides": 1,
            "viewedSlides": 0,
            "slideCount": 1,
            "success": True,
        }
    ]
    assert fake_client.viewed_lessons == [12]
    assert fake_client.completed_slides == [101]


def test_cli_lessons_read_reports_failures_without_aborting(monkeypatch, lesson_factory) -> None:
    applied_slide = lesson_factory(22).slides[0]
    applied_slide.id = 201

    class FakeClient:
        def fetch_lessons(self, course_id):
            return (
                [],
                [
                    lesson_factory(21, title="Week 2 - Workshop", status="unattempted"),
                    lesson_factory(22, title="Week 2 - Applied", status="unattempted"),
                ],
            )

        def fetch_lesson(self, lesson_id, view=False):
            if lesson_id == 21:
                raise RuntimeError("Ed API error (HTTP 403): Must complete all prereqs")
            return lesson_factory(
                lesson_id,
                title="Week 2 - Applied",
                slides=[applied_slide],
                status="attempted",
            )

        def fetch_slide(self, slide_id, view=False):
            return lesson_factory().slides[0]

        def complete_slide(self, slide_id):
            return None

    monkeypatch.setattr("edstem_cli.cli._get_client", lambda: FakeClient())

    runner = CliRunner()
    result = runner.invoke(cli, ["lessons", "read", "100"])

    assert result.exit_code == 0
    assert "Processed 2 lesson(s): 1 succeeded, 1 failed." in result.output
    assert "FAIL 21 Week 2 - Workshop -> Ed API error (HTTP 403): Must complete all prereqs" in result.output
    assert "OK 22 Week 2 - Applied -> attempted (completed=1 viewed=0)" in result.output


def test_cli_lessons_read_reports_partial_progress_on_failure(monkeypatch, lesson_factory) -> None:
    first_slide = lesson_factory(31).slides[0]
    second_slide = lesson_factory(31).slides[0]
    second_slide.id = 302

    class FakeClient:
        def __init__(self):
            self.fetch_lesson_calls = []

        def fetch_lessons(self, course_id):
            assert course_id == 100
            return ([], [lesson_factory(31, title="Week 3 - Applied", status="unattempted")])

        def fetch_lesson(self, lesson_id, view=False):
            self.fetch_lesson_calls.append((lesson_id, view))
            if view:
                return lesson_factory(
                    lesson_id,
                    title="Week 3 - Applied",
                    status="unattempted",
                    slides=[first_slide, second_slide],
                    slide_count=2,
                )
            return lesson_factory(
                lesson_id,
                title="Week 3 - Applied",
                status="attempted",
                slides=[first_slide, second_slide],
                slide_count=2,
            )

        def complete_slide(self, slide_id):
            if slide_id == second_slide.id:
                raise RuntimeError("boom")
            return None

        def fetch_slide(self, slide_id, view=False):
            return lesson_factory().slides[0]

    monkeypatch.setattr("edstem_cli.cli._get_client", lambda: FakeClient())

    runner = CliRunner()
    result = runner.invoke(cli, ["lessons", "read", "100", "--json"])

    assert result.exit_code == 0
    payload = json.loads(result.output)
    assert payload == [
        {
            "id": 31,
            "title": "Week 3 - Applied",
            "status": "attempted",
            "completedSlides": 1,
            "viewedSlides": 0,
            "slideCount": 2,
            "success": False,
            "error": "boom",
            "partial": True,
        }
    ]


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
    staff = User(id=7, name="Jordan", course_role="admin")
    answer = Comment(
        id=9001,
        type="answer",
        content="<document><paragraph>Use brew install python3</paragraph></document>",
        document="Use brew install python3",
        user_id=staff.id,
        is_endorsed=True,
        created_at="2026-01-15T11:00:00.123456+10:00",
        author=staff,
    )

    class FakeClient:
        def fetch_thread(self, thread_id):
            return thread_factory(
                thread_id,
                title="JSON thread",
                number=9,
                user_id=staff.id,
                author=staff,
                is_pinned=True,
                answers=[answer],
            )

    monkeypatch.setattr("edstem_cli.cli._get_client", lambda: FakeClient())
    runner = CliRunner()
    result = runner.invoke(cli, ["thread", "5001", "--json"])
    assert result.exit_code == 0
    payload = json.loads(result.output)
    assert payload["title"] == "JSON thread"
    assert payload["number"] == 9
    assert payload["flags"] == ["pinned"]
    assert payload["endorsement"]["endorsedAnswerIds"] == [9001]
    assert "content" not in payload
    assert payload["users"]["7"]["courseRole"] == "admin"


def test_cli_thread_json_pretty_include_html_and_legacy(monkeypatch, thread_factory) -> None:
    staff = User(id=7, name="Jordan", course_role="admin")
    answer = Comment(
        id=9001,
        type="answer",
        content="<document><paragraph>Use brew install python3</paragraph></document>",
        document="Use brew install python3",
        user_id=staff.id,
        is_endorsed=True,
        created_at="2026-01-15T11:00:00.123456+10:00",
        author=staff,
    )

    class FakeClient:
        def fetch_thread(self, thread_id):
            return thread_factory(
                thread_id,
                title="JSON thread",
                number=9,
                user_id=staff.id,
                author=staff,
                answers=[answer],
            )

    monkeypatch.setattr("edstem_cli.cli._get_client", lambda: FakeClient())
    runner = CliRunner()

    pretty_result = runner.invoke(cli, ["thread", "5001", "--json", "--pretty", "--include-html"])
    assert pretty_result.exit_code == 0
    assert "\n  \"title\"" in pretty_result.output
    pretty_payload = json.loads(pretty_result.output)
    assert pretty_payload["content"].startswith("<document")
    assert pretty_payload["answers"][0]["content"].startswith("<document")

    legacy_result = runner.invoke(cli, ["thread", "5001", "--json", "--legacy-json"])
    assert legacy_result.exit_code == 0
    legacy_payload = json.loads(legacy_result.output)
    assert "author" in legacy_payload
    assert "users" not in legacy_payload
    assert legacy_payload["answers"][0]["author"]["name"] == "Jordan"


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
