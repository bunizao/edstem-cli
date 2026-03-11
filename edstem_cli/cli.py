"""CLI entry point for edstem-cli.

Commands:
    edstem courses                          # list enrolled courses
    edstem lessons <course_id>             # list lessons
    edstem lesson <lesson_id>              # view lesson + slides
    edstem threads <course_id>              # list threads
    edstem threads <course_id> --sort top   # by votes
    edstem threads <course_id> --category X # filter by category
    edstem thread <thread_id>               # view thread + comments
    edstem thread <course_id>#<number>      # by course thread number
    edstem activity <course_id>             # your activity in course
    edstem user                             # current user profile
"""

from __future__ import annotations

import json
import logging
import sys
from pathlib import Path

import click
from rich.console import Console

from . import __version__
from .auth import get_token
from .client import EdClient
from .config import load_config
from .constants import ACTIVITY_FILTERS, SORT_OPTIONS
from .filter import filter_threads
from .formatter import (
    print_activity_table,
    print_comment_tree,
    print_course_table,
    print_lesson_detail,
    print_lesson_table,
    print_thread_detail,
    print_thread_table,
    print_user_profile,
)
from .serialization import courses_to_json, lesson_to_dict, lessons_to_json, threads_to_json

console = Console(stderr=True)


def _setup_logging(verbose):
    # type: (bool) -> None
    level = logging.DEBUG if verbose else logging.WARNING
    logging.basicConfig(
        level=level,
        format="%(levelname)s %(name)s: %(message)s",
        stream=sys.stderr,
    )


def _get_client():
    # type: () -> EdClient
    """Create an authenticated API client."""
    token = get_token()
    return EdClient(token)


def _exit_with_error(exc):
    # type: (Exception) -> None
    console.print("[red]Error: %s[/red]" % exc)
    sys.exit(1)


def _run_guarded(action):
    # type: (Callable[[], Any]) -> Any
    try:
        return action()
    except RuntimeError as exc:
        _exit_with_error(exc)


def _save_output(path, content):
    # type: (str, str) -> None
    """Write command output to disk and report the destination on stderr."""
    Path(path).write_text(content, encoding="utf-8")
    click.echo("Saved to %s" % path, err=True)


def _resolve_fetch_count(max_count, configured):
    # type: (Optional[int], int) -> int
    """Resolve fetch count with bounds checks."""
    if max_count is not None:
        if max_count <= 0:
            raise RuntimeError("--max must be greater than 0")
        return max_count
    return max(configured, 1)


def _parse_thread_ref(ref):
    # type: (str) -> tuple
    """Parse a thread reference: either <thread_id> or <course_id>#<number>."""
    if "#" in ref:
        parts = ref.split("#", 1)
        try:
            return int(parts[0]), int(parts[1])
        except ValueError:
            raise RuntimeError("Invalid thread reference: %s (expected course_id#number)" % ref)
    try:
        return int(ref), None
    except ValueError:
        raise RuntimeError("Invalid thread ID: %s" % ref)


def _filter_courses(course_list, include_archived=False):
    # type: (list, bool) -> list
    """Hide archived courses unless explicitly requested."""
    if include_archived:
        return list(course_list)
    return [course for course in course_list if str(course.status).lower() != "archived"]


def _filter_lessons(lesson_list, module=None, lesson_type=None, state=None, status=None):
    # type: (list, Optional[str], Optional[str], Optional[str], Optional[str]) -> list
    """Filter lessons using small explicit matching rules."""
    filtered = list(lesson_list)
    if module:
        query = module.strip().lower()
        filtered = [
            lesson for lesson in filtered
            if query == str(lesson.module_id).lower()
            or query in (lesson.module_name or "").lower()
        ]
    if lesson_type:
        query = lesson_type.strip().lower()
        filtered = [lesson for lesson in filtered if (lesson.type or "").lower() == query]
    if state:
        query = state.strip().lower()
        filtered = [lesson for lesson in filtered if (lesson.state or "").lower() == query]
    if status:
        query = status.strip().lower()
        filtered = [lesson for lesson in filtered if (lesson.status or "").lower() == query]
    return filtered


@click.group()
@click.option("--verbose", "-v", is_flag=True, help="Enable debug logging.")
@click.version_option(version=__version__)
def cli(verbose):
    # type: (bool) -> None
    """edstem — Ed Discussion CLI tool"""
    _setup_logging(verbose)


@cli.command()
@click.option(
    "--archived",
    "include_archived",
    is_flag=True,
    help="Include archived courses in the output.",
)
@click.option("--json", "as_json", is_flag=True, help="Output as JSON.")
@click.option("--output", "-o", "output_file", type=str, default=None, help="Save to file.")
def courses(include_archived, as_json, output_file):
    # type: (bool, bool, Optional[str]) -> None
    """List enrolled courses."""
    def _run():
        client = _get_client()
        user, course_list = client.fetch_user()
        course_list = _filter_courses(course_list, include_archived=include_archived)
        payload = courses_to_json(course_list)

        if output_file:
            _save_output(output_file, payload)

        if as_json:
            click.echo(payload)
            return

        print_course_table(course_list, console)

    _run_guarded(_run)


@cli.command()
@click.argument("course_id", type=int)
@click.option("--module", type=str, default=None, help="Filter by module ID or module name.")
@click.option("--type", "lesson_type", type=str, default=None, help="Filter by lesson type.")
@click.option("--state", type=str, default=None, help="Filter by lesson state.")
@click.option("--status", type=str, default=None, help="Filter by lesson status.")
@click.option("--json", "as_json", is_flag=True, help="Output as JSON.")
@click.option("--output", "-o", "output_file", type=str, default=None, help="Save to file.")
def lessons(course_id, module, lesson_type, state, status, as_json, output_file):
    # type: (int, Optional[str], Optional[str], Optional[str], Optional[str], bool, Optional[str]) -> None
    """List lessons in a course."""
    def _run():
        client = _get_client()
        modules, lesson_list = client.fetch_lessons(course_id)
        lesson_list = _filter_lessons(
            lesson_list,
            module=module,
            lesson_type=lesson_type,
            state=state,
            status=status,
        )
        payload = lessons_to_json(lesson_list)

        if output_file:
            _save_output(output_file, payload)

        if as_json:
            click.echo(payload)
            return

        title = "Lessons — %d" % len(lesson_list)
        if modules:
            title += " across %d module(s)" % len(modules)
        print_lesson_table(lesson_list, console, title=title)

    _run_guarded(_run)


@cli.command()
@click.argument("lesson_id", type=int)
@click.option("--json", "as_json", is_flag=True, help="Output as JSON.")
def lesson(lesson_id, as_json):
    # type: (int, bool) -> None
    """View a lesson and its slides."""
    def _run():
        client = _get_client()
        current_lesson = client.fetch_lesson(lesson_id)

        if as_json:
            click.echo(json.dumps(lesson_to_dict(current_lesson), ensure_ascii=False, indent=2))
            return

        print_lesson_detail(current_lesson, console)

    _run_guarded(_run)


@cli.command()
@click.argument("course_id", type=int)
@click.option("--max", "-n", "max_count", type=int, default=None, help="Max threads to fetch.")
@click.option(
    "--sort", "-s",
    type=click.Choice(SORT_OPTIONS, case_sensitive=False),
    default="new",
    help="Sort order.",
)
@click.option("--category", "-c", type=str, default=None, help="Filter by category.")
@click.option("--type", "-t", "thread_type", type=str, default=None, help="Filter by type.")
@click.option("--answered", is_flag=True, default=False, help="Only show answered threads.")
@click.option("--unanswered", is_flag=True, default=False, help="Only show unanswered threads.")
@click.option("--json", "as_json", is_flag=True, help="Output as JSON.")
@click.option("--output", "-o", "output_file", type=str, default=None, help="Save to file.")
def threads(course_id, max_count, sort, category, thread_type, answered, unanswered,
            as_json, output_file):
    # type: (...) -> None
    """List threads in a course."""
    def _run():
        config = load_config()
        fetch_count = _resolve_fetch_count(
            max_count, config.get("fetch", {}).get("count", 30)
        )
        client = _get_client()
        thread_list = client.fetch_threads(course_id, limit=fetch_count, sort=sort)

        answered_flag = None
        if answered:
            answered_flag = True
        elif unanswered:
            answered_flag = False

        thread_list = filter_threads(
            thread_list, category=category, thread_type=thread_type, answered=answered_flag
        )
        payload = threads_to_json(thread_list)

        if output_file:
            _save_output(output_file, payload)

        if as_json:
            click.echo(payload)
            return

        print_thread_table(thread_list, console)

    _run_guarded(_run)


@cli.command()
@click.argument("thread_ref")
@click.option("--json", "as_json", is_flag=True, help="Output as JSON.")
def thread(thread_ref, as_json):
    # type: (str, bool) -> None
    """View a thread and its comments.

    THREAD_REF is either a thread ID or course_id#number.
    """
    def _run():
        thread_id, number = _parse_thread_ref(thread_ref)
        client = _get_client()

        if number is not None:
            t = client.fetch_course_thread(thread_id, number)
        else:
            t = client.fetch_thread(thread_id)

        if as_json:
            from .serialization import thread_to_dict
            click.echo(json.dumps(thread_to_dict(t), ensure_ascii=False, indent=2))
            return

        print_thread_detail(t, console)
        console.print()

        if t.answers:
            print_comment_tree(t.answers, "Answers (%d)" % len(t.answers), console)
            console.print()
        if t.comments:
            print_comment_tree(t.comments, "Comments (%d)" % len(t.comments), console)
            console.print()

    _run_guarded(_run)


@cli.command()
@click.argument("course_id", type=int, required=False, default=None)
@click.option("--max", "-n", "max_count", type=int, default=None, help="Max items.")
@click.option(
    "--filter", "-f", "filter_type",
    type=click.Choice(ACTIVITY_FILTERS, case_sensitive=False),
    default="all",
    help="Filter activity type.",
)
@click.option("--json", "as_json", is_flag=True, help="Output as JSON.")
def activity(course_id, max_count, filter_type, as_json):
    # type: (Optional[int], Optional[int], str, bool) -> None
    """View your activity, optionally in a specific course."""
    def _run():
        config = load_config()
        fetch_count = _resolve_fetch_count(
            max_count, config.get("fetch", {}).get("count", 30)
        )
        client = _get_client()
        user, _ = client.fetch_user()
        items = client.fetch_user_activity(
            user.id, course_id=course_id, limit=fetch_count, filter_type=filter_type
        )

        if as_json:
            click.echo(json.dumps(items, ensure_ascii=False, indent=2))
            return

        print_activity_table(items, console)

    _run_guarded(_run)


@cli.command()
@click.option("--json", "as_json", is_flag=True, help="Output as JSON.")
def user(as_json):
    # type: (bool,) -> None
    """View current user profile and courses."""
    def _run():
        client = _get_client()
        u, course_list = client.fetch_user()

        if as_json:
            from .serialization import user_to_dict, courses_to_json
            data = user_to_dict(u)
            data["courses"] = json.loads(courses_to_json(course_list))
            click.echo(json.dumps(data, ensure_ascii=False, indent=2))
            return

        print_user_profile(u, course_list, console)

    _run_guarded(_run)


if __name__ == "__main__":
    cli()
