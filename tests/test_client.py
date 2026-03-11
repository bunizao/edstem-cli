"""Unit tests for client.py parsing functions."""

from __future__ import annotations

from edstem_cli.client import (
    EdAPIError,
    EdClient,
    _parse_comment,
    _parse_course,
    _parse_lesson,
    _parse_lesson_module,
    _parse_lesson_slide,
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


class TestParseLessonModule:
    def test_basic_lesson_module(self):
        module = _parse_lesson_module({"id": 8, "course_id": 100, "name": "Week 1"})
        assert module.id == 8
        assert module.course_id == 100
        assert module.name == "Week 1"


class TestParseLessonSlide:
    def test_basic_lesson_slide(self):
        slide = _parse_lesson_slide(
            {"id": 5, "lesson_id": 9, "index": 2, "type": "document", "title": "Slide A"}
        )
        assert slide.id == 5
        assert slide.lesson_id == 9
        assert slide.index == 2
        assert slide.title == "Slide A"


class TestParseLesson:
    def test_basic_lesson(self):
        lesson = _parse_lesson(
            {
                "id": 7001,
                "course_id": 100,
                "module_id": 8,
                "title": "Week 1 workshop",
                "type": "general",
                "kind": "content",
                "state": "active",
                "status": "attempted",
                "slide_count": 3,
                "openable": True,
                "slides": [{"id": 90, "lesson_id": 7001, "index": 1, "title": "Intro"}],
            },
            {8: "Week 1"},
        )
        assert lesson.id == 7001
        assert lesson.module_name == "Week 1"
        assert lesson.slide_count == 3
        assert lesson.openable is True
        assert len(lesson.slides) == 1


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

    def test_get_rejects_redirect_responses(self):
        class FakeResponse:
            status_code = 302
            ok = False
            headers = {"location": "https://edstem.org"}

            @staticmethod
            def json():
                return {}

        client = EdClient("token")
        client._session.get = lambda *args, **kwargs: FakeResponse()

        try:
            client._get("user")
        except EdAPIError as exc:
            assert exc.status_code == 302
            assert "redirected to https://edstem.org" in str(exc)
        else:
            raise AssertionError("_get should reject redirect responses")

    def test_get_rejects_non_json_success_responses(self):
        class FakeResponse:
            status_code = 200
            ok = True
            headers = {"content-type": "text/html"}

            @staticmethod
            def json():
                raise ValueError("not json")

        client = EdClient("token")
        client._session.get = lambda *args, **kwargs: FakeResponse()

        try:
            client._get("user")
        except EdAPIError as exc:
            assert "non-JSON response" in str(exc)
        else:
            raise AssertionError("_get should reject non-JSON success responses")

    def test_fetch_threads_clamps_limit_and_passes_sort(self):
        client = EdClient("token")
        captured = {}

        def fake_get(path, params=None):
            captured["path"] = path
            captured["params"] = params
            return {"threads": []}

        client._get = fake_get
        result = client.fetch_threads(321, limit=999, sort="top")

        assert result == []
        assert captured["path"] == "courses/321/threads"
        assert captured["params"]["limit"] == 100
        assert captured["params"]["sort"] == "top"

    def test_fetch_lessons_returns_modules_and_lessons(self):
        client = EdClient("token")
        client._get = lambda path, params=None: {
            "modules": [{"id": 7, "course_id": 321, "name": "Week 1"}],
            "lessons": [
                {
                    "id": 11,
                    "course_id": 321,
                    "module_id": 7,
                    "title": "Workshop",
                    "type": "general",
                    "slide_count": 4,
                }
            ],
        }

        modules, lessons = client.fetch_lessons(321)

        assert modules[0].name == "Week 1"
        assert lessons[0].id == 11
        assert lessons[0].module_name == "Week 1"

    def test_fetch_lesson_parses_nested_slides(self):
        client = EdClient("token")
        client._get = lambda path, params=None: {
            "lesson": {
                "id": 22,
                "title": "Lesson detail",
                "slides": [{"id": 1, "lesson_id": 22, "index": 1, "title": "Slide 1"}],
            }
        }

        lesson = client.fetch_lesson(22)

        assert lesson.id == 22
        assert lesson.title == "Lesson detail"
        assert lesson.slides[0].title == "Slide 1"

    def test_fetch_user_parses_enrollments(self):
        client = EdClient("token")
        client._get = lambda path, params=None: {
            "user": {"id": 7, "name": "Alice"},
            "courses": [
                {
                    "course": {"id": 101, "code": "CS101", "name": "Intro", "status": "active"},
                    "role": {"role": "student"},
                }
            ],
        }

        user, courses = client.fetch_user()

        assert user.id == 7
        assert courses[0].id == 101
        assert courses[0].role == "student"

    def test_fetch_thread_parses_author_from_users_map(self):
        client = EdClient("token")
        client._get = lambda path, params=None: {
            "thread": {"id": 88, "user_id": 99, "title": "Hello"},
            "users": [{"id": 99, "name": "Bob"}],
        }

        thread = client.fetch_thread(88)

        assert thread.id == 88
        assert thread.author is not None
        assert thread.author.name == "Bob"


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
