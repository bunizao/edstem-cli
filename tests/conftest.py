from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from edstem_cli.models import Course, Lesson, LessonSlide, Thread, ThreadMetrics


@pytest.fixture()
def thread_factory():
    def _make_thread(thread_id: int = 1, **overrides: Any) -> Thread:
        metrics = overrides.pop(
            "metrics",
            ThreadMetrics(vote_count=5, view_count=100, reply_count=3),
        )
        return Thread(
            id=thread_id,
            number=overrides.pop("number", thread_id),
            title=overrides.pop("title", "Test thread"),
            content=overrides.pop("content", "<document><paragraph>hello</paragraph></document>"),
            document=overrides.pop("document", "hello"),
            type=overrides.pop("type", "question"),
            category=overrides.pop("category", "General"),
            metrics=metrics,
            user_id=overrides.pop("user_id", 1),
            course_id=overrides.pop("course_id", 100),
            is_pinned=overrides.pop("is_pinned", False),
            is_private=overrides.pop("is_private", False),
            is_answered=overrides.pop("is_answered", False),
            is_locked=overrides.pop("is_locked", False),
            is_anonymous=overrides.pop("is_anonymous", False),
            created_at=overrides.pop("created_at", "2026-01-15T10:00:00.000Z"),
            answers=overrides.pop("answers", []),
            comments=overrides.pop("comments", []),
            author=overrides.pop("author", None),
        )

    return _make_thread


@pytest.fixture()
def course_factory():
    def _make_course(course_id: int = 100, **overrides: Any) -> Course:
        return Course(
            id=course_id,
            code=overrides.pop("code", "CS101"),
            name=overrides.pop("name", "Intro to CS"),
            year=overrides.pop("year", "2026"),
            session=overrides.pop("session", "Spring"),
            status=overrides.pop("status", "active"),
            role=overrides.pop("role", "student"),
        )

    return _make_course


@pytest.fixture()
def lesson_factory():
    def _make_lesson(lesson_id: int = 1, **overrides: Any) -> Lesson:
        slides = overrides.pop(
            "slides",
            [
                LessonSlide(
                    id=11,
                    lesson_id=lesson_id,
                    course_id=overrides.get("course_id", 100),
                    title="Slide 1",
                    type="document",
                    content="<document><paragraph>Hello lesson</paragraph></document>",
                    index=1,
                    status="completed",
                )
            ],
        )
        return Lesson(
            id=lesson_id,
            course_id=overrides.pop("course_id", 100),
            module_id=overrides.pop("module_id", 10),
            module_name=overrides.pop("module_name", "Week 1"),
            number=overrides.pop("number", lesson_id),
            title=overrides.pop("title", "Lesson title"),
            type=overrides.pop("type", "general"),
            kind=overrides.pop("kind", "content"),
            state=overrides.pop("state", "active"),
            status=overrides.pop("status", "attempted"),
            outline=overrides.pop("outline", "<document><paragraph>Outline</paragraph></document>"),
            slide_count=overrides.pop("slide_count", len(slides)),
            slides=slides,
            openable=overrides.pop("openable", True),
            openable_without_attempt=overrides.pop("openable_without_attempt", False),
            is_hidden=overrides.pop("is_hidden", False),
            is_unlisted=overrides.pop("is_unlisted", False),
            is_timed=overrides.pop("is_timed", False),
            available_at=overrides.pop("available_at", "2026-01-10T10:00:00.000Z"),
            due_at=overrides.pop("due_at", "2026-01-20T10:00:00.000Z"),
            locked_at=overrides.pop("locked_at", ""),
            solutions_at=overrides.pop("solutions_at", ""),
            created_at=overrides.pop("created_at", "2026-01-01T10:00:00.000Z"),
            updated_at=overrides.pop("updated_at", "2026-01-02T10:00:00.000Z"),
        )

    return _make_lesson


@pytest.fixture()
def fixture_loader():
    fixture_dir = Path(__file__).parent / "fixtures"

    def _load(name: str) -> Any:
        return json.loads((fixture_dir / name).read_text(encoding="utf-8"))

    return _load
