"""Thread formatter for terminal output (rich) and JSON export."""

from __future__ import annotations

import re

from rich.console import Console
from rich.markup import escape
from rich.panel import Panel
from rich.table import Table
from rich.tree import Tree


def format_number(n):
    # type: (int) -> str
    """Format number with K/M suffixes."""
    if n >= 1_000_000:
        return "%.1fM" % (n / 1_000_000)
    if n >= 1_000:
        return "%.1fK" % (n / 1_000)
    return str(n)


def strip_xml(text):
    # type: (str) -> str
    """Strip Ed XML document tags to plain text."""
    if not text:
        return ""
    cleaned = re.sub(r"<[^>]+>", "", text)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def print_course_table(courses, console=None, title=None):
    # type: (list, Optional[Console], Optional[str]) -> None
    """Print courses as a rich table."""
    if console is None:
        console = Console()

    if not title:
        title = "Courses — %d enrolled" % len(courses)

    table = Table(title=title, show_lines=True, expand=True)
    table.add_column("ID", style="dim", width=8, justify="right")
    table.add_column("Code", style="cyan", width=14, no_wrap=True)
    table.add_column("Name", ratio=3)
    table.add_column("Session", width=16)
    table.add_column("Role", style="green", width=10)
    table.add_column("Status", width=10)

    for course in courses:
        session = "%s %s" % (course.session, course.year) if course.session else course.year
        table.add_row(
            str(course.id),
            course.code,
            course.name,
            session,
            course.role,
            course.status,
        )

    console.print(table)


def print_thread_table(threads, console=None, title=None):
    # type: (list, Optional[Console], Optional[str]) -> None
    """Print threads as a rich table."""
    if console is None:
        console = Console()

    if not title:
        title = "Threads — %d" % len(threads)

    table = Table(title=title, show_lines=True, expand=True)
    table.add_column("#", style="dim", width=5, justify="right")
    table.add_column("Type", style="cyan", width=8)
    table.add_column("Title", ratio=3)
    table.add_column("Category", width=16)
    table.add_column("Stats", style="green", width=20, no_wrap=True)

    for thread in threads:
        text = escape(thread.title)
        if thread.is_pinned:
            text = escape("[pin] ") + text
        if thread.is_private:
            text = escape("[private] ") + text
        if thread.is_answered:
            text += escape(" [answered]")

        stats = "votes %s  views %s\nreplies %s" % (
            format_number(thread.metrics.vote_count),
            format_number(thread.metrics.view_count),
            format_number(thread.metrics.reply_count),
        )

        table.add_row(
            str(thread.number),
            thread.type,
            text,
            thread.category,
            stats,
        )

    console.print(table)


def print_thread_detail(thread, console=None):
    # type: (Thread, Optional[Console]) -> None
    """Print a single thread in detail using a rich panel."""
    if console is None:
        console = Console()

    header = escape("#%d %s" % (thread.number, thread.title))
    body_parts = []

    flags = []
    if thread.is_pinned:
        flags.append("pinned")
    if thread.is_private:
        flags.append("private")
    if thread.is_answered:
        flags.append("answered")
    if thread.is_locked:
        flags.append("locked")
    if flags:
        body_parts.append(escape("[%s]" % ", ".join(flags)))
        body_parts.append("")

    body_parts.append(
        "Type: %s  Category: %s"
        % (escape(thread.type), escape(thread.category or "-"))
    )
    if thread.author:
        body_parts.append("Author: %s" % escape(thread.author.name))
    body_parts.append("")

    content_text = strip_xml(thread.document or thread.content)
    if content_text:
        body_parts.append(escape(content_text))
        body_parts.append("")

    m = thread.metrics
    body_parts.append(
        "votes %s  views %s  replies %s  stars %s"
        % (
            format_number(m.vote_count),
            format_number(m.view_count),
            format_number(m.reply_count),
            format_number(m.star_count),
        )
    )
    if thread.created_at:
        body_parts.append("Created: %s" % thread.created_at)

    console.print(Panel(
        "\n".join(body_parts),
        title=header,
        border_style="blue",
        expand=True,
    ))


def _add_comment_to_tree(tree_node, comment, depth=0):
    # type: (Any, Comment, int) -> None
    """Recursively add a comment and its replies to a Rich tree."""
    author_name = comment.author.name if comment.author else "User %d" % comment.user_id
    if comment.is_anonymous:
        author_name = "Anonymous"
    label = "[bold]%s[/bold]" % escape(author_name)
    if comment.is_endorsed:
        label += escape(" [endorsed]")

    text = strip_xml(comment.document or comment.content)

    entry = "%s: %s" % (label, escape(text))
    if comment.vote_count:
        entry += " [dim](+%d)[/dim]" % comment.vote_count

    child = tree_node.add(entry)
    for reply in comment.comments:
        _add_comment_to_tree(child, reply, depth + 1)


def print_comment_tree(comments, label, console=None):
    # type: (list, str, Optional[Console]) -> None
    """Print comments as a rich tree."""
    if console is None:
        console = Console()
    if not comments:
        return

    tree = Tree(label)
    for comment in comments:
        _add_comment_to_tree(tree, comment)
    console.print(tree)


def print_user_profile(user, courses=None, console=None):
    # type: (User, Optional[list], Optional[Console]) -> None
    """Print user profile as a rich panel."""
    if console is None:
        console = Console()

    header = escape(user.name)

    lines = []
    if user.email:
        lines.append("Email: %s" % escape(user.email))
    if user.role:
        lines.append("Role: %s" % escape(user.role))

    if courses:
        lines.append("")
        lines.append("Enrolled in %d course(s)" % len(courses))

    console.print(Panel(
        "\n".join(lines),
        title=header,
        border_style="cyan",
        expand=True,
    ))


def print_activity_table(items, console=None, title=None):
    # type: (list, Optional[Console], Optional[str]) -> None
    """Print user activity items as a rich table."""
    if console is None:
        console = Console()

    if not title:
        title = "Activity — %d items" % len(items)

    table = Table(title=title, show_lines=True, expand=True)
    table.add_column("Type", style="cyan", width=10)
    table.add_column("Course", width=14)
    table.add_column("Title / Content", ratio=3)
    table.add_column("Created", style="dim", width=20)

    for item in items:
        item_type = str(item.get("type") or "")
        value = item.get("value") or {}

        course_code = str(value.get("course_code") or "")
        created = str(value.get("created_at") or "")

        if item_type == "thread":
            content = str(value.get("title") or "")
        else:
            content = strip_xml(str(value.get("document") or ""))
            if len(content) > 100:
                content = content[:97] + "..."
            thread_title = str(value.get("thread_title") or "")
            if thread_title:
                content = "Re: %s — %s" % (thread_title, content)

        table.add_row(
            escape(item_type),
            escape(course_code),
            escape(content),
            escape(created),
        )

    console.print(table)
