from __future__ import annotations

from edstem_cli.serialization import (
    course_to_dict,
    courses_to_json,
    lesson_to_dict,
    lessons_to_json,
    thread_from_dict,
    thread_to_dict,
    threads_from_json,
    threads_to_json,
)


def test_thread_roundtrip_dict(thread_factory) -> None:
    thread = thread_factory(42, title="Test")
    payload = thread_to_dict(thread)
    restored = thread_from_dict(payload)

    assert restored.id == thread.id
    assert restored.title == thread.title
    assert restored.metrics.vote_count == thread.metrics.vote_count


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


def test_lessons_to_json(lesson_factory) -> None:
    lessons = [lesson_factory(1, title="First"), lesson_factory(2, title="Second")]
    raw = lessons_to_json(lessons)
    assert '"First"' in raw
    assert '"Second"' in raw
