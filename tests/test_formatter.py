from __future__ import annotations

from rich.console import Console

from edstem_cli.formatter import (
    format_number,
    print_activity_table,
    print_comment_tree,
    print_course_table,
    print_lesson_detail,
    print_lesson_table,
    print_thread_detail,
    print_thread_table,
    print_user_profile,
    strip_xml,
)
from edstem_cli.models import Comment, Course, User


def test_format_number_supports_plain_and_compact_units() -> None:
    assert format_number(999) == "999"
    assert format_number(1200) == "1.2K"
    assert format_number(3_500_000) == "3.5M"


def test_strip_xml_removes_tags_and_compacts_whitespace() -> None:
    assert strip_xml("<document><paragraph>Hello</paragraph>   <bold>World</bold></document>") == (
        "Hello World"
    )


def test_print_course_table_renders_course_metadata(course_factory) -> None:
    console = Console(record=True, width=100)
    course = course_factory(101, code="CS101", name="Intro", session="Spring", year="2026")

    print_course_table([course], console)

    output = console.export_text()
    assert "Courses — 1 enrolled" in output
    assert "CS101" in output
    assert "Spring 2026" in output


def test_print_thread_table_shows_visible_markers(thread_factory) -> None:
    console = Console(record=True, width=100)
    thread = thread_factory(
        title="[Quiz] Review",
        is_pinned=True,
        is_private=True,
        is_answered=True,
    )

    print_thread_table([thread], console)

    output = console.export_text()
    assert "[pin]" in output
    assert "[private]" in output
    assert "[answered]" in output
    assert "[Quiz] Review" in output


def test_print_thread_detail_shows_flags_and_full_content(thread_factory) -> None:
    console = Console(record=True, width=100)
    long_text = "Z" * 650 + " [note]"
    thread = thread_factory(
        document=long_text,
        content=long_text,
        is_pinned=True,
        is_private=True,
        is_answered=True,
        is_locked=True,
        author=User(id=1, name="Alice [TA]"),
    )

    print_thread_detail(thread, console)

    output = console.export_text()
    assert "[pinned, private, answered, locked]" in output
    assert output.count("Z") >= 650
    assert "[note]" in output
    assert "Alice [TA]" in output
    assert "..." not in output


def test_print_comment_tree_shows_full_comment_text_and_states() -> None:
    console = Console(record=True, width=100)
    long_text = "B" * 260 + " [reply]"
    comment = Comment(
        id=1,
        content=long_text,
        document=long_text,
        user_id=1,
        vote_count=3,
        is_endorsed=True,
        is_anonymous=True,
    )

    print_comment_tree([comment], "Comments (1)", console)

    output = console.export_text()
    assert "Anonymous [endorsed]" in output
    assert output.count("B") == 260
    assert "[reply]" in output
    assert "(+3)" in output
    assert "..." not in output


def test_print_user_profile_shows_course_count() -> None:
    console = Console(record=True, width=100)
    user = User(id=1, name="Alice [Student]", email="alice@test.com", role="user")
    courses = [Course(id=100, code="CS101", name="Intro")]

    print_user_profile(user, courses, console)

    output = console.export_text()
    assert "Alice [Student]" in output
    assert "alice@test.com" in output
    assert "Enrolled in 1 course(s)" in output


def test_print_activity_table_formats_thread_and_comment_rows() -> None:
    console = Console(record=True, width=100)
    items = [
        {
            "type": "thread",
            "value": {
                "title": "Question [1]",
                "course_code": "CS101",
                "created_at": "2026-01-15",
            },
        },
        {
            "type": "comment",
            "value": {
                "document": "<document><paragraph>Hello [2]</paragraph></document>",
                "thread_title": "Question [1]",
                "course_code": "CS101",
                "created_at": "2026-01-16",
            },
        },
    ]

    print_activity_table(items, console)

    output = console.export_text()
    assert "Activity — 2 items" in output
    assert "Question [1]" in output
    assert "Re: Question [1] — Hello [2]" in output


def test_print_lesson_table_shows_module_and_markers(lesson_factory) -> None:
    console = Console(record=True, width=120)
    lesson = lesson_factory(
        55,
        title="Lesson [A]",
        module_name="Module [1]",
        openable=True,
        is_hidden=True,
    )

    print_lesson_table([lesson], console)

    output = console.export_text()
    assert "Lessons — 1" in output
    assert "Lesson [A]" in output
    assert "Module [1]" in output
    assert "open" in output
    assert "hidden" in output


def test_print_lesson_detail_shows_metadata_and_slide_preview(lesson_factory) -> None:
    console = Console(record=True, width=120)
    lesson = lesson_factory(
        77,
        title="Lesson detail",
        outline="<document><paragraph>Outline [1]</paragraph></document>",
    )

    print_lesson_detail(lesson, console)

    output = console.export_text()
    assert "Lesson 77 Lesson detail" in output
    assert "Type: general  Kind: content" in output
    assert "Outline [1]" in output
    assert "Slides — 1" in output
    assert "Hello lesson" in output
