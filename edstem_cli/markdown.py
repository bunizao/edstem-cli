"""Markdown renderers for portable Ed content export."""

from __future__ import annotations

import re
from html import unescape
from typing import Iterable, List
from xml.etree import ElementTree

from .models import Comment, Lesson, LessonSlide, Thread


_ED_XML_TAGS = frozenset({
    "document",
    "paragraph",
    "heading",
    "callout",
    "list",
    "list-item",
    "table",
    "table-row",
    "table-cell",
    "figure",
    "video",
    "image",
    "file",
    "break",
    "code",
    "bold",
    "italic",
    "link",
})


def _plain_text(value: str) -> str:
    # type: (str) -> str
    text = (value or "").strip()
    if not text:
        return ""
    if not _looks_like_ed_xml(text):
        return _normalize_text(text)
    try:
        root = ElementTree.fromstring(text if text.startswith("<") else "<document>%s</document>" % text)
    except ElementTree.ParseError:
        try:
            root = ElementTree.fromstring("<document>%s</document>" % text)
        except ElementTree.ParseError:
            return _normalize_text(text)
    return _render_blocks(root).strip()


def _looks_like_ed_xml(value: str) -> bool:
    # type: (str) -> bool
    return any(
        re.search(r"</?%s(?:\s|>|/>)" % re.escape(tag), value)
        for tag in _ED_XML_TAGS
    )


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
        if thread.author.is_staff:
            return "%s [staff]" % thread.author.name
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
    if comment.author and comment.author.is_staff and not comment.is_anonymous:
        markers.append("staff")
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
            for text_line in text.splitlines():
                lines.append("%s  %s" % (indent, text_line) if text_line else "%s  " % indent)
        if comment.comments:
            _append_comments(lines, comment.comments, depth + 1)
        lines.append("")


def _normalize_text(value: str) -> str:
    # type: (str) -> str
    value = unescape(value or "").replace("\r\n", "\n").replace("\r", "\n")
    normalized_lines = []
    for line in value.split("\n"):
        normalized_lines.append(re.sub(r"[ \t\f\v]+", " ", line).strip())
    return "\n".join(normalized_lines).strip()


def _local_tag(value: str) -> str:
    # type: (str) -> str
    if "}" in value:
        return value.rsplit("}", 1)[-1]
    return value


def _render_blocks(root: ElementTree.Element, depth: int = 0) -> str:
    # type: (ElementTree.Element, int) -> str
    blocks = []
    tag = _local_tag(root.tag)

    if tag == "document":
        if root.text and root.text.strip():
            blocks.append(_normalize_text(root.text))
        for child in root:
            child_text = _render_blocks(child, depth)
            if child_text:
                blocks.append(child_text)
            if child.tail and child.tail.strip():
                blocks.append(_normalize_text(child.tail))
        return "\n\n".join(block for block in blocks if block).strip()

    if tag == "paragraph":
        return _normalize_text(_render_inline(root))

    if tag == "heading":
        level = max(4, min(int(root.attrib.get("level") or 1) + 3, 6))
        text = _normalize_text(_render_inline(root))
        if not text:
            return ""
        return "%s %s" % ("#" * level, text)

    if tag == "callout":
        label = str(root.attrib.get("type") or "note").strip().capitalize()
        text = _normalize_text(_render_inline(root))
        if not text:
            return ""
        return "%s: %s" % (label, text)

    if tag == "list":
        return _render_list(root, depth)

    if tag == "table":
        return _render_table(root)

    if tag == "figure":
        for child in root:
            child_text = _render_blocks(child, depth)
            if child_text:
                blocks.append(child_text)
        return "\n\n".join(blocks).strip()

    if tag == "video":
        src = str(root.attrib.get("src") or "").strip()
        return "Video: %s" % src if src else ""

    if tag == "image":
        src = str(root.attrib.get("src") or "").strip()
        return "Image: %s" % src if src else ""

    if tag == "file":
        name = str(root.attrib.get("filename") or "Attachment").strip()
        url = str(root.attrib.get("url") or "").strip()
        if url:
            return "File: [%s](%s)" % (name, url)
        return "File: %s" % name

    return _normalize_text(_render_inline(root))


def _render_list(node: ElementTree.Element, depth: int) -> str:
    # type: (ElementTree.Element, int) -> str
    lines = []
    ordered = str(node.attrib.get("style") or "").lower() in {"ordered", "numbered"}
    index = 1
    for child in node:
        if _local_tag(child.tag) != "list-item":
            continue
        prefix = "%s%s " % ("  " * depth, "%d." % index if ordered else "-")
        item_text = _render_list_item(child, depth)
        if item_text:
            item_lines = item_text.splitlines()
            lines.append("%s%s" % (prefix, item_lines[0]))
            for extra_line in item_lines[1:]:
                lines.append("%s  %s" % ("  " * depth, extra_line))
        else:
            lines.append(prefix.rstrip())
        index += 1
    return "\n".join(lines).strip()


def _render_list_item(node: ElementTree.Element, depth: int) -> str:
    # type: (ElementTree.Element, int) -> str
    parts = []
    nested_lists = []
    if node.text and node.text.strip():
        parts.append(_normalize_text(node.text))
    for child in node:
        tag = _local_tag(child.tag)
        if tag == "list":
            nested = _render_list(child, depth + 1)
            if nested:
                nested_lists.append(nested)
        else:
            rendered = _render_blocks(child, depth + 1)
            if rendered:
                parts.append(rendered)
        if child.tail and child.tail.strip():
            parts.append(_normalize_text(child.tail))
    text = "\n".join(part for part in parts if part).strip()
    if nested_lists:
        suffix = "\n".join(nested_lists)
        if text:
            return "%s\n%s" % (text, suffix)
        return suffix
    return text


def _render_table(node: ElementTree.Element) -> str:
    # type: (ElementTree.Element) -> str
    rows = []
    for row in node:
        if _local_tag(row.tag) != "table-row":
            continue
        cells = []
        for cell in row:
            if _local_tag(cell.tag) != "table-cell":
                continue
            cell_text = _normalize_text(_render_inline(cell))
            cells.append(cell_text)
        if cells:
            rows.append(cells)
    if not rows:
        return ""
    lines = ["| %s |" % " | ".join(row) for row in rows]
    if len(rows) > 1:
        lines.insert(1, "| %s |" % " | ".join("---" for _ in rows[0]))
    return "\n".join(lines)


def _render_inline(node: ElementTree.Element) -> str:
    # type: (ElementTree.Element) -> str
    parts = []
    if node.text:
        parts.append(unescape(node.text))
    for child in node:
        tag = _local_tag(child.tag)
        if tag == "break":
            parts.append("\n")
        elif tag == "code":
            parts.append("`%s`" % _normalize_text(_render_inline(child)))
        elif tag == "bold":
            parts.append("**%s**" % _normalize_text(_render_inline(child)))
        elif tag == "italic":
            parts.append("*%s*" % _normalize_text(_render_inline(child)))
        elif tag == "link":
            label = _normalize_text(_render_inline(child)) or str(child.attrib.get("href") or "").strip()
            href = str(child.attrib.get("href") or "").strip()
            if href:
                parts.append("[%s](%s)" % (label, href))
            else:
                parts.append(label)
        elif tag == "image":
            src = str(child.attrib.get("src") or "").strip()
            if src:
                parts.append("Image: %s" % src)
        elif tag == "video":
            src = str(child.attrib.get("src") or "").strip()
            if src:
                parts.append("Video: %s" % src)
        elif tag == "file":
            name = str(child.attrib.get("filename") or "Attachment").strip()
            url = str(child.attrib.get("url") or "").strip()
            parts.append("File: [%s](%s)" % (name, url) if url else "File: %s" % name)
        else:
            parts.append(_render_inline(child))
        if child.tail:
            parts.append(unescape(child.tail))
    return "".join(parts)


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
