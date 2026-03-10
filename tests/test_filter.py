from __future__ import annotations

from edstem_cli.filter import filter_threads


def test_filter_by_category(thread_factory) -> None:
    threads = [
        thread_factory(1, category="General"),
        thread_factory(2, category="HW1"),
        thread_factory(3, category="General"),
    ]
    result = filter_threads(threads, category="General")
    assert [t.id for t in result] == [1, 3]


def test_filter_by_type(thread_factory) -> None:
    threads = [
        thread_factory(1, type="question"),
        thread_factory(2, type="post"),
        thread_factory(3, type="question"),
    ]
    result = filter_threads(threads, thread_type="question")
    assert [t.id for t in result] == [1, 3]


def test_filter_by_answered(thread_factory) -> None:
    threads = [
        thread_factory(1, is_answered=True),
        thread_factory(2, is_answered=False),
    ]
    result = filter_threads(threads, answered=True)
    assert [t.id for t in result] == [1]


def test_filter_unanswered(thread_factory) -> None:
    threads = [
        thread_factory(1, is_answered=True),
        thread_factory(2, is_answered=False),
    ]
    result = filter_threads(threads, answered=False)
    assert [t.id for t in result] == [2]


def test_filter_no_criteria_returns_all(thread_factory) -> None:
    threads = [thread_factory(1), thread_factory(2)]
    result = filter_threads(threads)
    assert len(result) == 2
