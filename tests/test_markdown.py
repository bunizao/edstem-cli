from __future__ import annotations

from edstem_cli.markdown import lesson_to_markdown, thread_to_markdown
from edstem_cli.models import Comment, LessonSlide, User


def test_thread_to_markdown_renders_post_and_replies(thread_factory) -> None:
    staff = User(id=7, name="Jordan", course_role="admin")
    answer = Comment(
        id=9001,
        type="answer",
        document="Use brew install python3",
        user_id=staff.id,
        is_endorsed=True,
        vote_count=2,
        created_at="2026-01-15T11:00:00Z",
        author=staff,
    )
    reply = Comment(
        id=9002,
        document="Thanks, that worked.",
        user_id=5,
        is_anonymous=True,
    )
    comment = Comment(
        id=9003,
        document="Same issue here.",
        user_id=6,
        comments=[reply],
    )
    thread = thread_factory(
        5001,
        number=9,
        title="Install Python",
        document="How do I install Python on macOS?",
        user_id=staff.id,
        author=staff,
        is_answered=True,
        answers=[answer],
        comments=[comment],
    )

    output = thread_to_markdown(thread)

    assert output.startswith("# #9 Install Python\n")
    assert "- **Author:** Jordan" in output
    assert "- **Flags:** answered" in output
    assert "## Post\n\nHow do I install Python on macOS?" in output
    assert "## Answers" in output
    assert "- **Jordan** [endorsed, +2] - 2026-01-15T11:00:00Z" in output
    assert "## Comments" in output
    assert "  - **Anonymous** [anonymous]" in output
    assert "Thanks, that worked." in output


def test_lesson_to_markdown_renders_outline_and_slides(lesson_factory) -> None:
    lesson = lesson_factory(
        7001,
        title="Week 1",
        module_name="Module A",
        outline="<document><paragraph>Read before class</paragraph></document>",
    )

    output = lesson_to_markdown(lesson)

    assert output.startswith("# Week 1\n")
    assert "- **Lesson ID:** 7001" in output
    assert "- **Module:** Module A" in output
    assert "## Outline\n\nRead before class" in output
    assert "## Slides" in output
    assert "### 1. Slide 1" in output
    assert "- **Status:** completed" in output
    assert "Hello lesson" in output


def test_lesson_to_markdown_includes_quiz_slide_passage(lesson_factory) -> None:
    lesson = lesson_factory(
        7001,
        slides=[
            LessonSlide(
                id=44,
                lesson_id=7001,
                title="Feedback",
                type="quiz",
                content="<document><paragraph>Explain your answer.</paragraph></document>",
                index=3,
            )
        ],
    )

    output = lesson_to_markdown(lesson)

    assert "### 3. Feedback" in output
    assert "- **Type:** quiz" in output
    assert "Explain your answer." in output
