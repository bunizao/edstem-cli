from __future__ import annotations

from edstem_cli.client import _parse_thread, _parse_user


def test_parse_user_info_fixture(fixture_loader) -> None:
    data = fixture_loader("user_info.json")
    user = _parse_user(data["user"])
    assert user.id == 12345
    assert user.name == "Alice Student"


def test_parse_thread_detail_fixture(fixture_loader) -> None:
    data = fixture_loader("thread_detail.json")
    users_data = data.get("users") or []
    users_map = {u["id"]: _parse_user(u) for u in users_data}
    thread = _parse_thread(data["thread"], users_map)

    assert thread.id == 5001
    assert thread.is_answered is True
    assert len(thread.answers) == 1
    assert thread.answers[0].is_endorsed is True


def test_parse_course_threads_fixture(fixture_loader) -> None:
    data = fixture_loader("course_threads.json")
    threads = [_parse_thread(t) for t in data["threads"]]
    assert len(threads) == 2
    assert threads[0].is_pinned is True


def test_parse_user_activity_fixture(fixture_loader) -> None:
    data = fixture_loader("user_activity.json")
    items = data["items"]
    assert len(items) == 2
    assert items[0]["type"] == "thread"
    assert items[1]["type"] == "comment"
