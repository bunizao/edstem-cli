"""CLI entry point for edstem-cli.

Commands:
    edstem courses                          # list enrolled courses
    edstem lessons <course_id>             # list lessons
    edstem lessons read <course_id>        # mark lessons as read
    edstem lessons quiz <slide_id>         # view quiz questions
    edstem lessons quiz <slide_id> --answer <question_id> --choice 2
    edstem lessons quiz <slide_id> --submit
    edstem lesson <lesson_id>              # view lesson + slides
    edstem threads <course_id>              # list threads
    edstem threads <course_id> --sort top   # by votes
    edstem threads <course_id> --category X # filter by category
    edstem thread <thread_id>               # view thread + comments
    edstem thread <course_id>#<number>      # by course thread number
    edstem update                           # update the installed CLI
    edstem activity <course_id>             # your activity in course
    edstem user                             # current user profile
"""

from __future__ import annotations

import json
import logging
import sys
import time
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
    strip_xml,
)
from .serialization import (
    courses_to_json,
    lesson_question_responses_to_json,
    lesson_questions_to_json,
    lesson_to_dict,
    lessons_to_json,
    threads_to_json,
)
from .self_update import perform_update
from .skill_bundle import (
    format_skill_summary,
    install_skill,
)

console = Console(stderr=True)


class _LegacyCompatibleGroup(click.Group):
    """Group that treats unknown leading tokens as legacy default-command args."""

    def invoke(self, ctx):
        # type: (click.Context) -> object
        def _invoke_group_callback():
            # type: () -> object
            with ctx:
                return click.Command.invoke(self, ctx)

        protected_args = _get_ctx_protected_args(ctx)
        if not protected_args:
            return super().invoke(ctx)

        args = [*protected_args, *ctx.args]
        ctx.args = []
        _set_ctx_protected_args(ctx, [])

        cmd_name = args[0]
        cmd = self.get_command(ctx, cmd_name)
        if cmd is None and ctx.token_normalize_func is not None:
            cmd_name = ctx.token_normalize_func(cmd_name)
            cmd = self.get_command(ctx, cmd_name)

        if cmd is None:
            ctx.args = args
            return _invoke_group_callback()

        with ctx:
            ctx.invoked_subcommand = cmd_name
            click.Command.invoke(self, ctx)
            sub_ctx = cmd.make_context(cmd_name, args[1:], parent=ctx)
            with sub_ctx:
                return sub_ctx.command.invoke(sub_ctx)


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


def _get_ctx_protected_args(ctx):
    # type: (click.Context) -> list[str]
    """Read protected args across Click versions."""
    if hasattr(ctx, "_protected_args"):
        return list(ctx._protected_args)
    return list(getattr(ctx, "protected_args", []))


def _set_ctx_protected_args(ctx, args):
    # type: (click.Context, list[str]) -> None
    """Write protected args across Click versions."""
    if hasattr(ctx, "_protected_args"):
        ctx._protected_args = list(args)
        return
    ctx.protected_args = list(args)


def _invoke_subcommand_from_args(ctx, command_name):
    # type: (click.Context, str) -> None
    """Invoke a subcommand with the current leftover arguments."""
    command = ctx.command.get_command(ctx, command_name)
    if command is None:
        raise RuntimeError("Unknown command: %s" % command_name)
    info_name = "%s %s" % (ctx.info_name or ctx.command.name or "cli", command_name)
    sub_ctx = command.make_context(info_name, list(ctx.args), parent=ctx)
    with sub_ctx:
        command.invoke(sub_ctx)


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


def _lesson_slide_count(lesson):
    # type: (Lesson) -> int
    """Return the declared slide count, falling back to loaded slides."""
    if lesson.slide_count > 0:
        return lesson.slide_count
    return len(lesson.slides)


@click.group()
@click.option("--verbose", "-v", is_flag=True, help="Enable debug logging.")
@click.version_option(version=__version__)
def cli(verbose):
    # type: (bool) -> None
    """edstem — Ed Discussion CLI tool"""
    _setup_logging(verbose)


def _install_skill_command(extra_args):
    # type: (list[str]) -> None
    """Delegate skill installation to the shared skills CLI."""
    install_skill(extra_args)


@cli.group(invoke_without_command=True)
@click.pass_context
def skills(ctx):
    # type: (click.Context) -> None
    """Show skill metadata or delegate to `npx skills add`."""
    if ctx.invoked_subcommand is not None:
        return
    click.echo(format_skill_summary())


@skills.command(
    "add",
    context_settings={"ignore_unknown_options": True, "allow_extra_args": True},
)
@click.pass_context
def add_skill_command(ctx):
    # type: (click.Context) -> None
    """Install the published skill through `npx skills add`."""
    _run_guarded(lambda: _install_skill_command(list(ctx.args)))


@skills.command(
    "install",
    hidden=True,
    context_settings={"ignore_unknown_options": True, "allow_extra_args": True},
)
@click.pass_context
def install_skill_command(ctx):
    # type: (click.Context) -> None
    """Backward-compatible alias for `skills add`."""
    _run_guarded(lambda: _install_skill_command(list(ctx.args)))


@skills.command(
    "i",
    hidden=True,
    context_settings={"ignore_unknown_options": True, "allow_extra_args": True},
)
@click.pass_context
def install_skill_alias(ctx):
    # type: (click.Context) -> None
    """Backward-compatible alias for `skills add`."""
    _run_guarded(lambda: _install_skill_command(list(ctx.args)))


@cli.command()
def update():
    # type: () -> None
    """Update the installed CLI in place."""
    _run_guarded(perform_update)
    click.echo("Updated edstem-cli.")


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


@cli.group(
    "lessons",
    cls=_LegacyCompatibleGroup,
    invoke_without_command=True,
    context_settings={"ignore_unknown_options": True, "allow_extra_args": True},
)
@click.pass_context
def lessons_group(ctx):
    # type: (click.Context) -> None
    """List or update course lessons."""
    if ctx.invoked_subcommand is None:
        _invoke_subcommand_from_args(ctx, "list")


@lessons_group.command("list")
@click.argument("course_id", type=int)
@click.option("--module", type=str, default=None, help="Filter by module ID or module name.")
@click.option("--type", "lesson_type", type=str, default=None, help="Filter by lesson type.")
@click.option("--state", type=str, default=None, help="Filter by lesson state.")
@click.option("--status", type=str, default=None, help="Filter by lesson status.")
@click.option("--json", "as_json", is_flag=True, help="Output as JSON.")
@click.option("--output", "-o", "output_file", type=str, default=None, help="Save to file.")
def lessons_list(course_id, module, lesson_type, state, status, as_json, output_file):
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


def _run_slide_questions(slide_id, as_json, output_file):
    # type: (int, bool, Optional[str]) -> None
    """List quiz questions for a slide."""
    client = _get_client()
    questions = client.fetch_slide_questions(slide_id)
    payload = lesson_questions_to_json(questions)

    if output_file:
        _save_output(output_file, payload)

    if as_json:
        click.echo(payload)
        return

    if not questions:
        click.echo("No quiz questions found for this slide.")
        return

    for question in questions:
        label = question.type or "question"
        click.echo("Question %d [%s]" % (question.id, label))
        click.echo(strip_xml(question.content) or "-")
        for idx, answer in enumerate(question.answers, start=1):
            click.echo("  %d. %s" % (idx, strip_xml(answer) or "-"))
        click.echo("")


def _run_slide_responses(slide_id, as_json, output_file):
    # type: (int, bool, Optional[str]) -> None
    """List saved quiz responses for a slide."""
    client = _get_client()
    responses = client.fetch_slide_question_responses(slide_id)
    payload = lesson_question_responses_to_json(responses)

    if output_file:
        _save_output(output_file, payload)

    if as_json:
        click.echo(payload)
        return

    if not responses:
        click.echo("No saved responses found for this slide.")
        return

    for response in responses:
        correctness = "correct" if response.correct else "incorrect"
        if response.correct is None:
            correctness = "ungraded"
        click.echo(
            "Question %d -> %s %s"
            % (response.question_id, response.data, correctness)
        )


def _run_slide_answer(question_id, choices, amend, as_json):
    # type: (int, tuple[int, ...], bool, bool) -> None
    """Submit selected answer choices for a quiz question.

    Choice numbers are 1-based in the CLI and converted to the Ed API format.
    Pass no choices to submit an empty response.
    """
    if any(choice <= 0 for choice in choices):
        raise RuntimeError("--choice values must be greater than or equal to 1")

    client = _get_client()
    response = [choice - 1 for choice in choices]
    result = client.submit_slide_question_response(question_id, response, amend=amend)
    payload = json.dumps(result, ensure_ascii=False, indent=2)

    if as_json:
        click.echo(payload)
        return

    correctness = result.get("correct")
    if correctness is True:
        click.echo("Answer accepted: correct.")
    elif correctness is False:
        click.echo("Answer accepted: incorrect.")
    else:
        click.echo("Answer accepted.")
    if result.get("slideCompleted"):
        click.echo("Slide status advanced to completed.")


def _run_slide_submit(slide_id, as_json):
    # type: (int, bool) -> None
    """Submit all saved question responses for a quiz slide."""
    client = _get_client()
    submitted = client.submit_all_slide_questions(slide_id)
    payload = json.dumps({"submitted": submitted}, ensure_ascii=False, indent=2)

    if as_json:
        click.echo(payload)
        return

    click.echo("Submitted all saved responses for slide %d." % slide_id)


@lessons_group.command("questions")
@click.argument("slide_id", type=int)
@click.option("--json", "as_json", is_flag=True, help="Output as JSON.")
@click.option("--output", "-o", "output_file", type=str, default=None, help="Save to file.")
def lesson_questions(slide_id, as_json, output_file):
    # type: (int, bool, Optional[str]) -> None
    """List quiz questions for a slide."""
    _run_guarded(lambda: _run_slide_questions(slide_id, as_json, output_file))


@lessons_group.command("quiz")
@click.argument("slide_id", type=int)
@click.option(
    "--responses",
    "show_responses",
    is_flag=True,
    help="Show saved responses instead of listing questions.",
)
@click.option(
    "--answer",
    "question_id",
    type=int,
    default=None,
    help="Submit an answer for this question ID.",
)
@click.option(
    "--choice",
    "choices",
    type=int,
    multiple=True,
    help="1-based answer choice. Repeat for multi-select questions.",
)
@click.option(
    "--submit",
    "submit_all",
    is_flag=True,
    help="Submit all saved responses for the slide.",
)
@click.option("--json", "as_json", is_flag=True, help="Output as JSON.")
@click.option("--output", "-o", "output_file", type=str, default=None, help="Save to file.")
@click.option("--amend", is_flag=True, help="Amend an existing submitted response.")
def lesson_quiz(slide_id, show_responses, question_id, choices, submit_all, as_json, output_file, amend):
    # type: (int, bool, Optional[int], tuple[int, ...], bool, bool, Optional[str], bool) -> None
    """Inspect or answer a quiz slide through one stable entrypoint."""

    def _run():
        action_count = sum(
            1 for enabled in [show_responses, question_id is not None, submit_all] if enabled
        )
        if action_count > 1:
            raise RuntimeError("Use only one of --responses, --answer, or --submit")
        if choices and question_id is None:
            raise RuntimeError("--choice requires --answer")
        if output_file and (question_id is not None or submit_all):
            raise RuntimeError("--output is only supported for listing questions or responses")

        if question_id is not None:
            _run_slide_answer(question_id, choices, amend, as_json)
            return
        if submit_all:
            _run_slide_submit(slide_id, as_json)
            return
        if show_responses:
            _run_slide_responses(slide_id, as_json, output_file)
            return
        _run_slide_questions(slide_id, as_json, output_file)

    _run_guarded(_run)


@lessons_group.command("responses", hidden=True)
@click.argument("slide_id", type=int)
@click.option("--json", "as_json", is_flag=True, help="Output as JSON.")
@click.option("--output", "-o", "output_file", type=str, default=None, help="Save to file.")
def lesson_responses(slide_id, as_json, output_file):
    # type: (int, bool, Optional[str]) -> None
    _run_guarded(lambda: _run_slide_responses(slide_id, as_json, output_file))


@lessons_group.command("answer", hidden=True)
@click.argument("question_id", type=int)
@click.option(
    "--choice",
    "choices",
    type=int,
    multiple=True,
    help="1-based answer choice. Repeat for multi-select questions.",
)
@click.option("--amend", is_flag=True, help="Amend an existing submitted response.")
@click.option("--json", "as_json", is_flag=True, help="Output as JSON.")
def lesson_answer(question_id, choices, amend, as_json):
    # type: (int, tuple[int, ...], bool, bool) -> None
    _run_guarded(lambda: _run_slide_answer(question_id, choices, amend, as_json))


@lessons_group.command("submit", hidden=True)
@click.argument("slide_id", type=int)
@click.option("--json", "as_json", is_flag=True, help="Output as JSON.")
def lesson_submit(slide_id, as_json):
    # type: (int, bool) -> None
    _run_guarded(lambda: _run_slide_submit(slide_id, as_json))


@cli.group("slides", hidden=True)
def slides_group():
    # type: () -> None
    """Backward-compatible alias for lesson slide commands."""


@slides_group.command("questions", hidden=True)
@click.argument("slide_id", type=int)
@click.option("--json", "as_json", is_flag=True, help="Output as JSON.")
@click.option("--output", "-o", "output_file", type=str, default=None, help="Save to file.")
def slide_questions(slide_id, as_json, output_file):
    # type: (int, bool, Optional[str]) -> None
    _run_guarded(lambda: _run_slide_questions(slide_id, as_json, output_file))


@slides_group.command("responses", hidden=True)
@click.argument("slide_id", type=int)
@click.option("--json", "as_json", is_flag=True, help="Output as JSON.")
@click.option("--output", "-o", "output_file", type=str, default=None, help="Save to file.")
def slide_responses(slide_id, as_json, output_file):
    # type: (int, bool, Optional[str]) -> None
    _run_guarded(lambda: _run_slide_responses(slide_id, as_json, output_file))


@slides_group.command("answer", hidden=True)
@click.argument("question_id", type=int)
@click.option(
    "--choice",
    "choices",
    type=int,
    multiple=True,
    help="1-based answer choice. Repeat for multi-select questions.",
)
@click.option("--amend", is_flag=True, help="Amend an existing submitted response.")
@click.option("--json", "as_json", is_flag=True, help="Output as JSON.")
def slide_answer(question_id, choices, amend, as_json):
    # type: (int, tuple[int, ...], bool, bool) -> None
    _run_guarded(lambda: _run_slide_answer(question_id, choices, amend, as_json))


@slides_group.command("submit", hidden=True)
@click.argument("slide_id", type=int)
@click.option("--json", "as_json", is_flag=True, help="Output as JSON.")
def slide_submit(slide_id, as_json):
    # type: (int, bool) -> None
    _run_guarded(lambda: _run_slide_submit(slide_id, as_json))


@lessons_group.command("read")
@click.argument("course_id", type=int)
@click.argument("queries", nargs=-1)
@click.option(
    "--delay",
    type=float,
    default=0.0,
    show_default=True,
    help="Seconds to wait between slide actions.",
)
@click.option("--json", "as_json", is_flag=True, help="Output as JSON.")
@click.option("--output", "-o", "output_file", type=str, default=None, help="Save to file.")
def lessons_read(course_id, queries, delay, as_json, output_file):
    # type: (int, tuple[str, ...], float, bool, Optional[str]) -> None
    """Mark matching lessons as read by visiting lessons and slides."""

    def _run():
        if delay < 0:
            raise RuntimeError("--delay must be greater than or equal to 0")

        client = _get_client()
        modules, lesson_list = client.fetch_lessons(course_id)
        normalized_queries = [query.strip().lower() for query in queries if query.strip()]
        if normalized_queries:
            lesson_list = [
                lesson
                for lesson in lesson_list
                if all(
                    query in ((lesson.title or "") + " " + (lesson.module_name or "")).lower()
                    for query in normalized_queries
                )
            ]

        results = []
        for lesson in lesson_list:
            current_lesson = None
            completed_slides = 0
            viewed_slides = 0
            try:
                current_lesson = client.fetch_lesson(lesson.id, view=True)

                for slide in current_lesson.slides:
                    if (slide.type or "").lower() == "quiz":
                        client.fetch_slide(slide.id, view=True)
                        viewed_slides += 1
                    else:
                        client.complete_slide(slide.id)
                        completed_slides += 1
                    if delay > 0:
                        time.sleep(delay)

                refreshed = client.fetch_lesson(lesson.id)
                results.append(
                    {
                        "id": refreshed.id,
                        "title": refreshed.title,
                        "status": refreshed.status,
                        "completedSlides": completed_slides,
                        "viewedSlides": viewed_slides,
                        "slideCount": _lesson_slide_count(refreshed),
                        "success": True,
                    }
                )
            except RuntimeError as exc:
                failed_lesson = current_lesson or lesson
                if completed_slides > 0 or viewed_slides > 0:
                    try:
                        failed_lesson = client.fetch_lesson(lesson.id)
                    except RuntimeError:
                        pass

                result = {
                    "id": failed_lesson.id,
                    "title": failed_lesson.title,
                    "status": failed_lesson.status,
                    "completedSlides": completed_slides,
                    "viewedSlides": viewed_slides,
                    "slideCount": _lesson_slide_count(failed_lesson),
                    "success": False,
                    "error": str(exc),
                }
                if completed_slides > 0 or viewed_slides > 0:
                    result["partial"] = True
                results.append(result)

        payload = json.dumps(results, ensure_ascii=False, indent=2)

        if output_file:
            _save_output(output_file, payload)

        if as_json:
            click.echo(payload)
            return

        if not results:
            click.echo("No lessons matched the supplied filters.")
            return

        success_count = sum(1 for result in results if result.get("success"))
        failure_count = len(results) - success_count
        click.echo(
            "Processed %d lesson(s): %d succeeded, %d failed."
            % (len(results), success_count, failure_count)
        )
        for result in results:
            if result.get("success"):
                click.echo(
                    "OK %s %s -> %s (completed=%d viewed=%d)"
                    % (
                        result["id"],
                        result["title"],
                        result["status"],
                        result["completedSlides"],
                        result["viewedSlides"],
                    )
                )
            else:
                if result.get("partial"):
                    click.echo(
                        "FAIL %s %s -> %s (completed=%d viewed=%d)"
                        % (
                            result["id"],
                            result["title"],
                            result["error"],
                            result["completedSlides"],
                            result["viewedSlides"],
                        )
                    )
                else:
                    click.echo(
                        "FAIL %s %s -> %s"
                        % (result["id"], result["title"], result["error"])
                    )

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
