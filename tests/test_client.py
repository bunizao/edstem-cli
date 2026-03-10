"""Unit tests for client.py parsing functions."""

from __future__ import annotations

from edstem_cli.client import (
    EdAPIError,
    EdClient,
    _parse_comment,
    _parse_course,
    _parse_thread,
    _parse_user,
)


class TestParseUser:
    def test_basic_user(self):
        user = _parse_user({"id": 1, "name": "Alice", "email": "a@b.com", "role": "student"})
        assert user.id == 1
        assert user.name == "Alice"
        assert user.email == "a@b.com"

    def test_missing_fields(self):
        user = _parse_user({})
        assert user.id == 0
        assert user.name == ""


class TestParseCourse:
    def test_basic_course(self):
        course = _parse_course(
            {"id": 100, "code": "CS101", "name": "Intro", "year": "2026", "status": "active"},
            role="student",
        )
        assert course.id == 100
        assert course.code == "CS101"
        assert course.role == "student"


class TestParseThread:
    def test_basic_thread(self):
        thread = _parse_thread({
            "id": 5001,
            "number": 1,
            "title": "Test",
            "type": "question",
            "vote_count": 10,
            "view_count": 200,
            "reply_count": 5,
            "is_pinned": True,
            "is_answered": True,
        })
        assert thread.id == 5001
        assert thread.number == 1
        assert thread.is_pinned is True
        assert thread.metrics.vote_count == 10
        assert thread.metrics.view_count == 200

    def test_thread_with_users_map(self):
        from edstem_cli.models import User
        users_map = {12345: User(id=12345, name="Alice")}
        thread = _parse_thread({"id": 1, "user_id": 12345}, users_map)
        assert thread.author is not None
        assert thread.author.name == "Alice"

    def test_thread_with_comments(self):
        thread = _parse_thread({
            "id": 1,
            "answers": [{"id": 100, "type": "answer", "vote_count": 3}],
            "comments": [{"id": 200, "type": "comment"}],
        })
        assert len(thread.answers) == 1
        assert thread.answers[0].vote_count == 3
        assert len(thread.comments) == 1


class TestParseComment:
    def test_nested_comments(self):
        comment = _parse_comment({
            "id": 100,
            "type": "answer",
            "vote_count": 5,
            "is_endorsed": True,
            "comments": [
                {"id": 101, "type": "comment", "vote_count": 1, "comments": []},
            ],
        })
        assert comment.id == 100
        assert comment.is_endorsed is True
        assert len(comment.comments) == 1
        assert comment.comments[0].id == 101


class TestEdAPIError:
    def test_stores_status_code(self):
        err = EdAPIError(429, "Rate limited")
        assert err.status_code == 429
        assert str(err) == "Rate limited"

    def test_is_runtime_error(self):
        err = EdAPIError(500, "Server error")
        assert isinstance(err, RuntimeError)


class TestEdClientRequests:
    def test_get_rejects_bad_token_400(self):
        class FakeResponse:
            status_code = 400
            ok = False
            headers = {"content-type": "application/json"}

            @staticmethod
            def json():
                return {"code": "bad_token", "message": "Invalid token"}

        client = EdClient("token")
        client._session.get = lambda *args, **kwargs: FakeResponse()

        try:
            client._get("user")
        except EdAPIError as exc:
            assert exc.status_code == 400
            assert "Authentication failed" in str(exc)
        else:
            raise AssertionError("_get should reject bad_token responses")

    def test_get_preserves_forbidden_403_message(self):
        class FakeResponse:
            status_code = 403
            ok = False
            headers = {"content-type": "application/json"}

            @staticmethod
            def json():
                return {"code": "unknown", "message": "Forbidden"}

        client = EdClient("token")
        client._session.get = lambda *args, **kwargs: FakeResponse()

        try:
            client._get("threads/30595")
        except EdAPIError as exc:
            assert exc.status_code == 403
            assert str(exc) == "Ed API error (HTTP 403): Forbidden"
        else:
            raise AssertionError("_get should preserve forbidden responses")

    def test_fetch_user_activity_sends_all_filter(self):
        client = EdClient("token")
        captured = {}

        def fake_get(path, params=None):
            captured["path"] = path
            captured["params"] = params
            return {"items": []}

        client._get = fake_get
        result = client.fetch_user_activity(123)

        assert result == []
        assert captured["path"] == "users/123/profile/activity"
        assert captured["params"]["filter"] == "all"


class TestClientFixtures:
    def test_parse_user_info_fixture(self, fixture_loader):
        data = fixture_loader("user_info.json")
        user = _parse_user(data["user"])
        assert user.id == 12345
        assert user.name == "Alice Student"

        courses = []
        for enrollment in data["courses"]:
            course = _parse_course(enrollment["course"], enrollment["role"]["role"])
            courses.append(course)
        assert len(courses) == 2
        assert courses[0].code == "CS101"
        assert courses[0].role == "student"
        assert courses[1].status == "archived"

    def test_parse_thread_detail_fixture(self, fixture_loader):
        data = fixture_loader("thread_detail.json")
        users_data = data.get("users") or []
        users_map = {u["id"]: _parse_user(u) for u in users_data}
        thread = _parse_thread(data["thread"], users_map)

        assert thread.id == 5001
        assert thread.title == "How do I install Python?"
        assert thread.is_pinned is True
        assert thread.is_answered is True
        assert thread.metrics.vote_count == 5

        assert len(thread.answers) == 1
        assert thread.answers[0].is_endorsed is True
        assert thread.answers[0].author.name == "Bob TA"
        assert len(thread.answers[0].comments) == 1

        assert len(thread.comments) == 1
        assert thread.comments[0].is_anonymous is True

    def test_parse_course_threads_fixture(self, fixture_loader):
        data = fixture_loader("course_threads.json")
        threads = [_parse_thread(t) for t in data["threads"]]

        assert len(threads) == 2
        assert threads[0].number == 1
        assert threads[0].is_pinned is True
        assert threads[1].category == "HW1"
        assert threads[1].metrics.vote_count == 20
