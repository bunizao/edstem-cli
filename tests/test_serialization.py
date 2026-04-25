from __future__ import annotations

from edstem_cli.serialization import (
    course_to_dict,
    courses_to_json,
    lesson_to_dict,
    lessons_to_json,
    thread_to_compact_dict,
    thread_from_dict,
    thread_to_json,
    thread_to_dict,
    threads_from_json,
    threads_to_json,
)
from edstem_cli.models import Comment, User


def test_thread_roundtrip_dict(thread_factory) -> None:
    thread = thread_factory(42, title="Test")
    payload = thread_to_dict(thread)
    restored = thread_from_dict(payload)

    assert restored.id == thread.id
    assert restored.title == thread.title
    assert restored.metrics.vote_count == thread.metrics.vote_count


def test_thread_to_compact_dict_hoists_users_and_computes_endorsement(thread_factory) -> None:
    staff = User(id=201297, name="Adrian Kristanto", course_role="admin")
    student = User(id=554538, name="Mandy Wong", course_role="student")
    answer = Comment(
        id=7134903,
        type="answer",
        content="<document><paragraph>Yes, it applies to any actors.</paragraph></document>",
        document="Yes, it applies to any actors.",
        user_id=staff.id,
        vote_count=1,
        is_endorsed=True,
        created_at="2026-04-20T15:06:47.123456+10:00",
        author=staff,
    )
    reply = Comment(
        id=7135309,
        type="comment",
        document="If you think that will help you do the discussion, we can do that.",
        user_id=student.id,
        created_at="2026-04-20T16:03:24.654321+10:00",
        author=student,
    )
    question = Comment(
        id=7124339,
        type="comment",
        document="Is one UML needed for each alternative design?",
        user_id=student.id,
        created_at="2026-04-18T13:09:28.111111+10:00",
        comments=[reply],
        author=student,
    )
    thread = thread_factory(
        3185028,
        number=265,
        title="A1 General Question Clarification",
        type="post",
        category="Assignments",
        subcategory="A1",
        user_id=staff.id,
        course_id=30595,
        is_pinned=True,
        document="Post General clarification questions related to A1 here",
        content="<document><paragraph>Post General clarification questions related to A1 here</paragraph></document>",
        created_at="2026-03-20T16:28:46.619812+11:00",
        updated_at="2026-04-23T17:34:45.619812+10:00",
        answers=[answer],
        comments=[question],
        author=staff,
    )

    payload = thread_to_compact_dict(thread)

    assert "content" not in payload
    assert payload["flags"] == ["pinned"]
    assert payload["createdAt"] == "2026-03-20T16:28:46+11:00"
    assert payload["updatedAt"] == "2026-04-23T17:34:45+10:00"
    assert payload["endorsement"] == {
        "endorsedAnswerIds": [7134903],
        "staffReplyCount": 1,
        "hasStaffAnswer": True,
    }
    assert payload["users"] == {
        "201297": {"name": "Adrian Kristanto", "courseRole": "admin"},
        "554538": {"name": "Mandy Wong", "courseRole": "student"},
    }
    assert payload["answers"][0]["endorsed"] is True
    assert payload["answers"][0]["byStaff"] is True
    assert payload["answers"][0]["createdAt"] == "2026-04-20T15:06:47+10:00"
    assert "type" not in payload["answers"][0]
    assert "voteCount" not in payload["comments"][0]["comments"][0]


def test_thread_to_compact_dict_include_html_keeps_content(thread_factory) -> None:
    staff = User(id=201297, name="Adrian Kristanto", course_role="admin")
    answer = Comment(
        id=7134903,
        type="answer",
        content="<document><paragraph>HTML answer</paragraph></document>",
        document="HTML answer",
        user_id=staff.id,
        created_at="2026-04-20T15:06:47.123456+10:00",
        author=staff,
    )
    thread = thread_factory(
        3185028,
        user_id=staff.id,
        author=staff,
        answers=[answer],
    )

    payload = thread_to_compact_dict(thread, include_html=True)

    assert payload["content"] == thread.content
    assert payload["answers"][0]["content"] == answer.content


def test_thread_from_compact_dict_roundtrip(thread_factory) -> None:
    staff = User(id=201297, name="Adrian Kristanto", course_role="admin")
    answer = Comment(
        id=7134903,
        type="answer",
        document="Yes, it applies to any actors.",
        user_id=staff.id,
        vote_count=1,
        is_endorsed=True,
        created_at="2026-04-20T15:06:47.123456+10:00",
        author=staff,
    )
    thread = thread_factory(
        3185028,
        user_id=staff.id,
        author=staff,
        is_pinned=True,
        answers=[answer],
        updated_at="2026-04-23T17:34:45.619812+10:00",
    )

    payload = thread_to_compact_dict(thread)
    restored = thread_from_dict(payload)

    assert thread_to_compact_dict(restored) == payload


def test_thread_from_legacy_payload_keeps_embedded_authors(thread_factory) -> None:
    staff = User(id=201297, name="Adrian Kristanto", course_role="admin")
    answer = Comment(
        id=7134903,
        type="answer",
        document="Yes, it applies to any actors.",
        user_id=staff.id,
        is_endorsed=True,
        created_at="2026-04-20T15:06:47.123456+10:00",
        author=staff,
    )
    thread = thread_factory(3185028, user_id=staff.id, author=staff, answers=[answer])

    restored = thread_from_dict(thread_to_dict(thread))

    assert restored.author is not None
    assert restored.author.name == "Adrian Kristanto"
    assert restored.answers[0].author is not None
    assert restored.answers[0].author.course_role == "admin"


def test_thread_to_json_compact_is_not_pretty(thread_factory) -> None:
    thread = thread_factory(42, title="Compact")

    payload = thread_to_json(thread)

    assert "\n" not in payload


def test_threads_json_roundtrip(thread_factory) -> None:
    threads = [thread_factory(1, title="First"), thread_factory(2, category="HW1")]
    raw = threads_to_json(threads)
    restored = threads_from_json(raw)

    assert [t.id for t in restored] == [1, 2]
    assert restored[1].category == "HW1"


def test_course_to_dict(course_factory) -> None:
    course = course_factory(100, code="CS101", name="Intro")
    data = course_to_dict(course)
    assert data["id"] == 100
    assert data["code"] == "CS101"


def test_courses_to_json(course_factory) -> None:
    courses = [course_factory(100), course_factory(200, code="MATH201")]
    raw = courses_to_json(courses)
    assert '"CS101"' in raw
    assert '"MATH201"' in raw


def test_lesson_to_dict(lesson_factory) -> None:
    lesson = lesson_factory(42, title="Week 1", module_name="Module A")
    data = lesson_to_dict(lesson)
    assert data["id"] == 42
    assert data["title"] == "Week 1"
    assert data["moduleName"] == "Module A"
    assert data["slides"][0]["title"] == "Slide 1"


def test_lesson_to_dict_omits_empty_and_default_fields(lesson_factory) -> None:
    lesson = lesson_factory(
        42,
        course_id=29579,
        module_name="",
        number=-1,
        outline="",
        slides=[],
        openable_without_attempt=False,
        is_hidden=False,
        is_unlisted=False,
        is_timed=False,
        due_at="",
        locked_at="",
        updated_at="",
    )
    data = lesson_to_dict(lesson)

    assert "courseId" not in data
    assert "moduleName" not in data
    assert "number" not in data
    assert "outline" not in data
    assert "slides" not in data
    assert "openableWithoutAttempt" not in data
    assert "isHidden" not in data
    assert "isUnlisted" not in data
    assert "isTimed" not in data
    assert "dueAt" not in data
    assert "lockedAt" not in data
    assert "updatedAt" not in data


def test_lesson_to_dict_keeps_meaningful_optional_fields(lesson_factory) -> None:
    lesson = lesson_factory(
        42,
        number=7,
        slides=[],
        openable_without_attempt=True,
        is_hidden=True,
        is_unlisted=True,
        is_timed=True,
        locked_at="2026-01-21T10:00:00.000Z",
        updated_at="2026-01-02T10:00:00.000Z",
    )
    data = lesson_to_dict(lesson)

    assert data["number"] == 7
    assert data["openableWithoutAttempt"] is True
    assert data["isHidden"] is True
    assert data["isUnlisted"] is True
    assert data["isTimed"] is True
    assert data["lockedAt"] == "2026-01-21T10:00:00.000Z"
    assert data["updatedAt"] == "2026-01-02T10:00:00.000Z"


def test_lessons_to_json(lesson_factory) -> None:
    lessons = [lesson_factory(1, title="First"), lesson_factory(2, title="Second")]
    raw = lessons_to_json(lessons)
    assert '"First"' in raw
    assert '"Second"' in raw
