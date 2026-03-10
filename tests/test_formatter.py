from __future__ import annotations

from rich.console import Console

from edstem_cli.formatter import print_comment_tree, print_thread_detail
from edstem_cli.models import Comment


def test_print_thread_detail_shows_full_content(thread_factory) -> None:
    console = Console(record=True, width=100)
    long_text = "A" * 650
    thread = thread_factory(document=long_text, content=long_text)

    print_thread_detail(thread, console)

    output = console.export_text()
    assert output.count("A") == len(long_text)
    assert "..." not in output


def test_print_comment_tree_shows_full_comment_text() -> None:
    console = Console(record=True, width=100)
    long_text = "B" * 260
    comment = Comment(id=1, content=long_text, document=long_text, user_id=1)

    print_comment_tree([comment], "Comments (1)", console)

    output = console.export_text()
    assert output.count("B") == len(long_text)
    assert "..." not in output
