"""Markdown renderers for portable Ed content export."""

from __future__ import annotations

from typing import Iterable, List

from .formatter import strip_xml
from .models import Comment, Lesson, LessonSlide, Thread


def _plain_text(value: str) -> str:
    # type: (str) -> str
    return strip_xml(value or "")


def _heading_text(value: str) -> str:
    # type: (str) -> str
    return (value or "").replace("\n", " ").strip() or "Untitled"


def _append_text_block(lines: List[str], text: str) -> None:
    # type: (List[str], str) -> None
    cleaned = _plain_text(text)
    if cleaned:
        lines.append(cleaned)
        lines.append("")


def _metadata_line(label: str, value: object) -> str:
    # type: (str, object) -> str
    return "- **%s:** %s" % (label, value if value not in (None, "") else "-")


def _author_name(comment: Comment) -> str:
    # type: (Comment) -> str
    if comment.is_anonymous:
        return "Anonymous"
    if comment.author:
        return comment.author.name
    if comment.user_id:
        return "User %d" % comment.user_id
    return "Unknown user"


def _thread_author_name(thread: Thread) -> str:
    # type: (Thread) -> str
    if thread.is_anonymous:
        return "Anonymous"
    if thread.author:
        return thread.author.name
    if thread.user_id:
        return "User %d" % thread.user_id
    return "Unknown user"


def _thread_flags(thread: Thread) -> List[str]:
    # type: (Thread) -> List[str]
    flags = []
    if thread.is_pinned:
        flags.append("pinned")
    if thread.is_private:
        flags.append("private")
    if thread.is_answered:
        flags.append("answered")
    if thread.is_endorsed:
        flags.append("endorsed")
    if thread.is_anonymous:
        flags.append("anonymous")
    if thread.is_locked:
        flags.append("locked")
    return flags


def _lesson_flags(lesson: Lesson) -> List[str]:
    # type: (Lesson) -> List[str]
    flags = []
    if lesson.openable:
        flags.append("openable")
    if lesson.openable_without_attempt:
        flags.append("open without attempt")
    if lesson.is_hidden:
        flags.append("hidden")
    if lesson.is_unlisted:
        flags.append("unlisted")
    if lesson.is_timed:
        flags.append("timed")
    return flags


def _comment_markers(comment: Comment) -> List[str]:
    # type: (Comment) -> List[str]
    markers = []
    if comment.is_endorsed:
        markers.append("endorsed")
    if comment.is_resolved:
        markers.append("resolved")
    if comment.is_anonymous:
        markers.append("anonymous")
    if comment.vote_count:
        markers.append("+%d" % comment.vote_count)
    return markers


def _append_comments(lines: List[str], comments: Iterable[Comment], depth: int = 0) -> None:
    # type: (List[str], Iterable[Comment], int) -> None
    for comment in comments:
        indent = "  " * depth
        markers = _comment_markers(comment)
        marker_text = " [%s]" % ", ".join(markers) if markers else ""
        created = " - %s" % comment.created_at if comment.created_at else ""
        lines.append("%s- **%s**%s%s" % (indent, _author_name(comment), marker_text, created))
        text = _plain_text(comment.document or comment.content)
        if text:
            lines.append("%s  %s" % (indent, text))
        if comment.comments:
            _append_comments(lines, comment.comments, depth + 1)
        lines.append("")


def thread_to_markdown(thread: Thread) -> str:
    # type: (Thread) -> str
    """Render a thread and its replies as readable Markdown."""
    number = "#%d " % thread.number if thread.number else ""
    lines = ["# %s%s" % (number, _heading_text(thread.title)), ""]
    flags = _thread_flags(thread)

    lines.extend(
        [
            _metadata_line("Thread ID", thread.id),
            _metadata_line("Course ID", thread.course_id),
            _metadata_line("Type", thread.type),
            _metadata_line("Category", thread.category),
            _metadata_line("Subcategory", thread.subcategory),
            _metadata_line("Author", _thread_author_name(thread)),
            _metadata_line("Created", thread.created_at),
            _metadata_line("Updated", thread.updated_at),
            _metadata_line("Flags", ", ".join(flags) if flags else "-"),
            _metadata_line("Votes", thread.metrics.vote_count),
            _metadata_line("Views", thread.metrics.view_count),
            _metadata_line("Replies", thread.metrics.reply_count),
            "",
            "## Post",
            "",
        ]
    )
    _append_text_block(lines, thread.document or thread.content)

    if thread.answers:
        lines.extend(["## Answers", ""])
        _append_comments(lines, thread.answers)

    if thread.comments:
        lines.extend(["## Comments", ""])
        _append_comments(lines, thread.comments)

    return "\n".join(lines).rstrip() + "\n"


def _append_slide(lines: List[str], slide: LessonSlide) -> None:
    # type: (List[str], LessonSlide) -> None
    title = _heading_text(slide.title)
    prefix = "%d. " % slide.index if slide.index else ""
    lines.extend(
        [
            "### %s%s" % (prefix, title),
            "",
            _metadata_line("Slide ID", slide.id),
            _metadata_line("Type", slide.type),
            _metadata_line("Status", slide.status),
            _metadata_line("Hidden", "yes" if slide.is_hidden else "no"),
            "",
        ]
    )
    _append_text_block(lines, slide.content)


def lesson_to_markdown(lesson: Lesson) -> str:
    # type: (Lesson) -> str
    """Render a lesson and loaded slides as readable Markdown."""
    flags = _lesson_flags(lesson)
    lines = [
        "# %s" % _heading_text(lesson.title),
        "",
        _metadata_line("Lesson ID", lesson.id),
        _metadata_line("Course ID", lesson.course_id),
        _metadata_line("Module", lesson.module_name),
        _metadata_line("Type", lesson.type),
        _metadata_line("Kind", lesson.kind),
        _metadata_line("State", lesson.state),
        _metadata_line("Status", lesson.status),
        _metadata_line("Slides", lesson.slide_count or len(lesson.slides)),
        _metadata_line("Flags", ", ".join(flags) if flags else "-"),
        _metadata_line("Available", lesson.available_at),
        _metadata_line("Due", lesson.due_at),
        _metadata_line("Locked", lesson.locked_at),
        _metadata_line("Solutions", lesson.solutions_at),
        _metadata_line("Created", lesson.created_at),
        _metadata_line("Updated", lesson.updated_at),
        "",
    ]

    outline = _plain_text(lesson.outline)
    if outline:
        lines.extend(["## Outline", "", outline, ""])

    if lesson.slides:
        lines.extend(["## Slides", ""])
        for slide in lesson.slides:
            _append_slide(lines, slide)

    return "\n".join(lines).rstrip() + "\n"
