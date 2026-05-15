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
    assert "- **Jordan** [staff, endorsed, +2] - 2026-01-15T11:00:00Z" in output
    assert "## Comments" in output
    assert "  - **Anonymous** [anonymous]" in output
    assert "Thanks, that worked." in output


def test_thread_to_markdown_indents_multiline_comment_bodies(thread_factory) -> None:
    staff = User(id=7, name="Jordan", course_role="admin")
    answer = Comment(
        id=9001,
        type="answer",
        document="First line<break/><break/>Second paragraph",
        user_id=staff.id,
        author=staff,
    )
    thread = thread_factory(5001, answers=[answer])

    output = thread_to_markdown(thread)

    assert "  First line" in output
    assert "\n  \n  Second paragraph\n" in output


def test_lesson_to_markdown_renders_outline_and_slides(lesson_factory) -> None:
    lesson = lesson_factory(
        7001,
        title="Week 1",
        module_name="Module A",
        outline=(
            "<document><paragraph>Read before class</paragraph>"
            "<list style=\"bullet\"><list-item><paragraph>Bring laptop</paragraph></list-item>"
            "<list-item><paragraph>Open `main.py`</paragraph></list-item></list></document>"
        ),
    )

    output = lesson_to_markdown(lesson)

    assert output.startswith("# Week 1\n")
    assert "- **Lesson ID:** 7001" in output
    assert "- **Module:** Module A" in output
    assert "## Outline\n\nRead before class" in output
    assert "- Bring laptop" in output
    assert "- Open `main.py`" in output
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


def test_lesson_to_markdown_preserves_block_structure_and_links(lesson_factory) -> None:
    lesson = lesson_factory(
        7001,
        slides=[
            LessonSlide(
                id=99,
                lesson_id=7001,
                title="Structured slide",
                type="document",
                content=(
                    "<document>"
                    "<paragraph>Intro &amp; setup</paragraph>"
                    "<heading level=\"2\">Checklist</heading>"
                    "<list style=\"bullet\">"
                    "<list-item><paragraph>Install dependencies</paragraph></list-item>"
                    "<list-item><paragraph>Read the <link href=\"https://example.com/spec\">spec</link></paragraph></list-item>"
                    "</list>"
                    "<file filename=\"starter.zip\" url=\"https://example.com/starter.zip\"/>"
                    "</document>"
                ),
                index=2,
            )
        ],
    )

    output = lesson_to_markdown(lesson)

    assert "Intro & setup" in output
    assert "#### Checklist" in output
    assert "- Install dependencies" in output
    assert "- Read the [spec](https://example.com/spec)" in output
    assert "File: [starter.zip](https://example.com/starter.zip)" in output


def test_markdown_preserves_literal_angle_brackets(lesson_factory, thread_factory) -> None:
    lesson = lesson_factory(
        7001,
        slides=[
            LessonSlide(
                id=99,
                lesson_id=7001,
                title="Comparisons",
                content="Use x < y and y > z. Array<T> is not Ed XML.",
                index=2,
            )
        ],
    )
    thread = thread_factory(5001, document="Can I write x < y and use Array<T>?")

    lesson_output = lesson_to_markdown(lesson)
    thread_output = thread_to_markdown(thread)

    assert "Use x < y and y > z. Array<T> is not Ed XML." in lesson_output
    assert "Can I write x < y and use Array<T>?" in thread_output


def test_markdown_preserves_malformed_xml_source_text(lesson_factory) -> None:
    lesson = lesson_factory(
        7001,
        slides=[
            LessonSlide(
                id=99,
                lesson_id=7001,
                title="Malformed",
                content="<document><paragraph>Use x < y before fixing parser",
                index=2,
            )
        ],
    )

    output = lesson_to_markdown(lesson)

    assert "<document><paragraph>Use x < y before fixing parser" in output
