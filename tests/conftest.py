from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from edstem_cli.models import Course, Thread, ThreadMetrics


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
def fixture_loader():
    fixture_dir = Path(__file__).parent / "fixtures"

    def _load(name: str) -> Any:
        return json.loads((fixture_dir / name).read_text(encoding="utf-8"))

    return _load
