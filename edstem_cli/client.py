"""Ed Discussion REST API client."""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Tuple

import requests

from .constants import get_api_base_url
from .models import (
    Comment,
    Course,
    Lesson,
    LessonModule,
    LessonQuestion,
    LessonQuestionResponse,
    LessonSlide,
    Thread,
    ThreadMetrics,
    User,
)

logger = logging.getLogger(__name__)


class EdAPIError(RuntimeError):
    """API error with HTTP status code."""

    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code


class EdClient:
    """REST client for the Ed Discussion API."""

    def __init__(self, token: str) -> None:
        self._session = requests.Session()
        self._session.headers.update({
            "Authorization": "Bearer %s" % token,
            "Accept": "application/json",
        })

    def _get(self, path: str, params: Optional[Dict[str, Any]] = None) -> Any:
        url = get_api_base_url() + path.lstrip("/")
        logger.debug("GET %s params=%s", url, params)
        try:
            resp = self._session.get(url, params=params, timeout=15, allow_redirects=False)
        except requests.RequestException as exc:
            raise EdAPIError(0, "Failed to reach the Ed API: %s" % exc) from exc

        code, message = _extract_error_details(resp)
        if resp.status_code in (400, 401, 403):
            if code == "bad_token" or resp.status_code == 401:
                raise EdAPIError(
                    resp.status_code,
                    "Authentication failed (HTTP %d). Check your Ed API token."
                    % resp.status_code,
                )
            raise EdAPIError(resp.status_code, _format_api_error(resp.status_code, message))
        if 300 <= resp.status_code < 400:
            location = resp.headers.get("location") or "an unknown location"
            raise EdAPIError(
                resp.status_code,
                "Ed API base URL redirected to %s. "
                "Set ED_API_BASE_URL to a valid JSON API endpoint." % location,
            )
        if resp.status_code == 404:
            raise EdAPIError(
                404,
                message or "Not found: %s" % path,
            )
        if not resp.ok:
            raise EdAPIError(resp.status_code, _format_api_error(resp.status_code, message))
        try:
            return resp.json()
        except ValueError as exc:
            raise EdAPIError(
                resp.status_code,
                "Ed API returned a non-JSON response. "
                "Set ED_API_BASE_URL to a valid JSON API endpoint.",
            ) from exc

    def _put(
        self,
        path: str,
        params: Optional[Dict[str, Any]] = None,
        json_body: Optional[Dict[str, Any]] = None,
        expect_json: bool = True,
        allow_empty: bool = False,
    ) -> Any:
        url = get_api_base_url() + path.lstrip("/")
        logger.debug("PUT %s params=%s", url, params)
        try:
            resp = self._session.put(
                url,
                params=params,
                json=json_body,
                timeout=15,
                allow_redirects=False,
            )
        except requests.RequestException as exc:
            raise EdAPIError(0, "Failed to reach the Ed API: %s" % exc) from exc

        code, message = _extract_error_details(resp)
        if resp.status_code in (400, 401, 403):
            if code == "bad_token" or resp.status_code == 401:
                raise EdAPIError(
                    resp.status_code,
                    "Authentication failed (HTTP %d). Check your Ed API token."
                    % resp.status_code,
                )
            raise EdAPIError(resp.status_code, _format_api_error(resp.status_code, message))
        if 300 <= resp.status_code < 400:
            location = resp.headers.get("location") or "an unknown location"
            raise EdAPIError(
                resp.status_code,
                "Ed API base URL redirected to %s. "
                "Set ED_API_BASE_URL to a valid JSON API endpoint." % location,
            )
        if resp.status_code == 404:
            raise EdAPIError(
                404,
                message or "Not found: %s" % path,
            )
        if not resp.ok:
            raise EdAPIError(resp.status_code, _format_api_error(resp.status_code, message))
        if allow_empty and not getattr(resp, "content", b""):
            return None
        if not expect_json:
            return None
        try:
            return resp.json()
        except ValueError as exc:
            if allow_empty:
                return None
            raise EdAPIError(
                resp.status_code,
                "Ed API returned a non-JSON response. "
                "Set ED_API_BASE_URL to a valid JSON API endpoint.",
            ) from exc

    def _post(
        self,
        path: str,
        params: Optional[Dict[str, Any]] = None,
        json_body: Optional[Any] = None,
        expect_json: bool = True,
        allow_empty: bool = False,
    ) -> Any:
        url = get_api_base_url() + path.lstrip("/")
        logger.debug("POST %s params=%s", url, params)
        try:
            resp = self._session.post(
                url,
                params=params,
                json=json_body,
                timeout=15,
                allow_redirects=False,
            )
        except requests.RequestException as exc:
            raise EdAPIError(0, "Failed to reach the Ed API: %s" % exc) from exc

        code, message = _extract_error_details(resp)
        if resp.status_code in (400, 401, 403):
            if code == "bad_token" or resp.status_code == 401:
                raise EdAPIError(
                    resp.status_code,
                    "Authentication failed (HTTP %d). Check your Ed API token."
                    % resp.status_code,
                )
            raise EdAPIError(resp.status_code, _format_api_error(resp.status_code, message))
        if 300 <= resp.status_code < 400:
            location = resp.headers.get("location") or "an unknown location"
            raise EdAPIError(
                resp.status_code,
                "Ed API base URL redirected to %s. "
                "Set ED_API_BASE_URL to a valid JSON API endpoint." % location,
            )
        if resp.status_code == 404:
            raise EdAPIError(
                404,
                message or "Not found: %s" % path,
            )
        if not resp.ok:
            raise EdAPIError(resp.status_code, _format_api_error(resp.status_code, message))
        if allow_empty and not getattr(resp, "content", b""):
            return None
        if not expect_json:
            return None
        try:
            return resp.json()
        except ValueError as exc:
            if allow_empty:
                return None
            raise EdAPIError(
                resp.status_code,
                "Ed API returned a non-JSON response. "
                "Set ED_API_BASE_URL to a valid JSON API endpoint.",
            ) from exc

    def fetch_user(self) -> Tuple[User, List[Course]]:
        """Fetch current user info and enrolled courses."""
        data = self._get("user")
        user_data = data.get("user") or {}
        user = _parse_user(user_data)
        courses = []
        for enrollment in data.get("courses") or []:
            course_data = enrollment.get("course") or {}
            role_data = enrollment.get("role") or {}
            courses.append(_parse_course(course_data, role_data.get("role", "")))
        return user, courses

    def fetch_threads(
        self,
        course_id: int,
        limit: int = 30,
        offset: int = 0,
        sort: str = "new",
    ) -> List[Thread]:
        """Fetch threads for a course."""
        params = {"limit": min(limit, 100), "offset": offset, "sort": sort}
        data = self._get("courses/%d/threads" % course_id, params)
        threads_data = data.get("threads") or (data if isinstance(data, list) else [])
        return [_parse_thread(t) for t in threads_data]

    def fetch_lessons(self, course_id: int) -> Tuple[List[LessonModule], List[Lesson]]:
        """Fetch lesson modules and lessons for a course."""
        data = self._get("courses/%d/lessons" % course_id)
        modules_data = data.get("modules") or []
        lessons_data = data.get("lessons") or []
        modules = [_parse_lesson_module(module) for module in modules_data]
        module_names = {module.id: module.name for module in modules}
        lessons = [_parse_lesson(lesson, module_names) for lesson in lessons_data]
        return modules, lessons

    def fetch_lesson(self, lesson_id: int, view: bool = False) -> Lesson:
        """Fetch a single lesson with slides."""
        params = {"view": "1"} if view else None
        data = self._get("lessons/%d" % lesson_id, params=params)
        lesson_data = data.get("lesson") or data
        return _parse_lesson(lesson_data)

    def fetch_slide(self, slide_id: int, view: bool = False) -> LessonSlide:
        """Fetch a single slide, optionally recording a view."""
        params = {"view": "1"} if view else None
        data = self._get("lessons/slides/%d" % slide_id, params=params)
        slide_data = data.get("slide") or data
        return _parse_lesson_slide(slide_data)

    def complete_slide(self, slide_id: int) -> None:
        """Mark a slide as completed for the current user."""
        self._put("lessons/slides/%d/complete" % slide_id, expect_json=False, allow_empty=True)

    def fetch_slide_questions(self, slide_id: int) -> List[LessonQuestion]:
        """Fetch all questions for a quiz slide."""
        data = self._get("lessons/slides/%d/questions" % slide_id)
        questions_data = data.get("questions") or []
        return [_parse_lesson_question(question) for question in questions_data]

    def submit_slide_question_response(
        self,
        question_id: int,
        response: Any,
        amend: bool = False,
    ) -> Dict[str, Any]:
        """Submit a response for a slide question."""
        params = {"amend": "1"} if amend else None
        data = self._post(
            "lessons/slides/questions/%d/responses" % question_id,
            params=params,
            json_body=response,
        )
        return {
            "slideCompleted": bool(data.get("slide_completed")),
            "solution": data.get("solution"),
            "explanation": data.get("explanation"),
            "correct": data.get("correct"),
        }

    def fetch_slide_question_responses(self, slide_id: int) -> List[LessonQuestionResponse]:
        """Fetch all saved responses for a quiz slide."""
        data = self._get("lessons/slides/%d/questions/responses" % slide_id)
        responses_data = data.get("responses") or []
        return [_parse_lesson_question_response(response) for response in responses_data]

    def submit_all_slide_questions(self, slide_id: int) -> bool:
        """Submit all saved question responses for a quiz slide."""
        data = self._post(
            "lessons/slides/%d/questions/submit_all" % slide_id,
            json_body={},
            allow_empty=True,
        )
        if data is None:
            return True
        return bool(data.get("submitted"))

    def fetch_thread(self, thread_id: int) -> Thread:
        """Fetch a single thread with comments."""
        data = self._get("threads/%d" % thread_id)
        thread_data = data.get("thread") or data
        users_data = data.get("users") or []
        users_map = {u["id"]: _parse_user(u) for u in users_data if "id" in u}
        return _parse_thread(thread_data, users_map)

    def fetch_course_thread(self, course_id: int, number: int) -> Thread:
        """Fetch a thread by course-relative number."""
        data = self._get("courses/%d/threads/%d" % (course_id, number))
        thread_data = data.get("thread") or data
        users_data = data.get("users") or []
        users_map = {u["id"]: _parse_user(u) for u in users_data if "id" in u}
        return _parse_thread(thread_data, users_map)

    def fetch_user_activity(
        self,
        user_id: int,
        course_id: Optional[int] = None,
        limit: int = 30,
        offset: int = 0,
        filter_type: str = "all",
    ) -> List[Dict[str, Any]]:
        """Fetch user activity items."""
        params = {
            "limit": min(limit, 50),
            "offset": offset,
            "filter": filter_type or "all",
        }  # type: Dict[str, Any]
        if course_id:
            params["course_id"] = course_id
        data = self._get("users/%d/profile/activity" % user_id, params)
        return data.get("items") or []


def _extract_error_details(resp: requests.Response) -> tuple[str, str]:
    """Extract structured API error details when available."""
    try:
        payload = resp.json()
    except ValueError:
        return "", ""
    if not isinstance(payload, dict):
        return "", ""
    return str(payload.get("code") or ""), str(payload.get("message") or "")


def _format_api_error(status_code: int, message: str) -> str:
    """Build a user-facing API error message."""
    if message:
        return "Ed API error (HTTP %d): %s" % (status_code, message)
    return "Ed API error (HTTP %d)" % status_code


def _parse_user(data: Dict[str, Any]) -> User:
    return User(
        id=int(data.get("id") or 0),
        name=str(data.get("name") or ""),
        email=str(data.get("email") or ""),
        role=str(data.get("role") or ""),
        course_role=str(data.get("course_role") or ""),
        avatar=str(data.get("avatar") or ""),
    )


def _parse_course(data: Dict[str, Any], role: str = "") -> Course:
    return Course(
        id=int(data.get("id") or 0),
        code=str(data.get("code") or ""),
        name=str(data.get("name") or ""),
        year=str(data.get("year") or ""),
        session=str(data.get("session") or ""),
        status=str(data.get("status") or ""),
        role=role,
    )


def _parse_lesson_module(data: Dict[str, Any]) -> LessonModule:
    return LessonModule(
        id=int(data.get("id") or 0),
        course_id=int(data.get("course_id") or 0),
        name=str(data.get("name") or ""),
        user_id=int(data.get("user_id") or 0),
        created_at=str(data.get("created_at") or ""),
        updated_at=str(data.get("updated_at") or ""),
    )


def _parse_lesson_slide(data: Dict[str, Any]) -> LessonSlide:
    return LessonSlide(
        id=int(data.get("id") or 0),
        lesson_id=int(data.get("lesson_id") or 0),
        course_id=int(data.get("course_id") or 0),
        title=str(data.get("title") or ""),
        type=str(data.get("type") or ""),
        content=str(data.get("content") or ""),
        index=int(data.get("index") or 0),
        status=str(data.get("status") or ""),
        is_hidden=bool(data.get("is_hidden")),
    )


def _parse_lesson_question(data: Dict[str, Any]) -> LessonQuestion:
    question_data = data.get("data") or {}
    return LessonQuestion(
        id=int(data.get("id") or 0),
        slide_id=int(data.get("lesson_slide_id") or 0),
        index=int(data.get("index") or 0),
        type=str(question_data.get("type") or ""),
        content=str(question_data.get("content") or ""),
        explanation=str(question_data.get("explanation") or ""),
        answers=[str(answer or "") for answer in (question_data.get("answers") or [])],
        solution=[int(value) for value in (question_data.get("solution") or [])],
        multiple_selection=bool(question_data.get("multiple_selection")),
        is_assessed=bool(question_data.get("assessed")),
        is_formatted=bool(question_data.get("formatted")),
        lesson_markable_id=int(data.get("lesson_markable_id") or 0),
    )


def _parse_lesson_question_response(data: Dict[str, Any]) -> LessonQuestionResponse:
    return LessonQuestionResponse(
        question_id=int(data.get("question_id") or 0),
        user_id=int(data.get("user_id") or 0),
        created_at=str(data.get("created_at") or ""),
        correct=data.get("correct"),
        data=data.get("data"),
    )


def _parse_lesson(
    data: Dict[str, Any],
    module_names: Optional[Dict[int, str]] = None,
) -> Lesson:
    if module_names is None:
        module_names = {}
    module_id = int(data.get("module_id") or 0)
    return Lesson(
        id=int(data.get("id") or 0),
        course_id=int(data.get("course_id") or 0),
        module_id=module_id,
        module_name=str(data.get("module_name") or module_names.get(module_id) or ""),
        number=int(data.get("number") or 0),
        title=str(data.get("title") or ""),
        type=str(data.get("type") or ""),
        kind=str(data.get("kind") or ""),
        state=str(data.get("state") or ""),
        status=str(data.get("status") or ""),
        outline=str(data.get("outline") or ""),
        slide_count=int(data.get("slide_count") or 0),
        slides=[_parse_lesson_slide(slide) for slide in (data.get("slides") or [])],
        openable=bool(data.get("openable")),
        openable_without_attempt=bool(data.get("openable_without_attempt")),
        is_hidden=bool(data.get("is_hidden")),
        is_unlisted=bool(data.get("is_unlisted")),
        is_timed=bool(data.get("is_timed")),
        available_at=str(data.get("effective_available_at") or data.get("available_at") or ""),
        due_at=str(data.get("effective_due_at") or data.get("due_at") or ""),
        locked_at=str(data.get("effective_locked_at") or data.get("locked_at") or ""),
        solutions_at=str(data.get("effective_solutions_at") or data.get("solutions_at") or ""),
        created_at=str(data.get("created_at") or ""),
        updated_at=str(data.get("updated_at") or ""),
    )


def _parse_thread(
    data: Dict[str, Any],
    users_map: Optional[Dict[int, User]] = None,
) -> Thread:
    if users_map is None:
        users_map = {}
    user_id = int(data.get("user_id") or 0)
    return Thread(
        id=int(data.get("id") or 0),
        number=int(data.get("number") or 0),
        title=str(data.get("title") or ""),
        content=str(data.get("content") or ""),
        document=str(data.get("document") or ""),
        type=str(data.get("type") or ""),
        category=str(data.get("category") or ""),
        subcategory=str(data.get("subcategory") or ""),
        subsubcategory=str(data.get("subsubcategory") or ""),
        metrics=ThreadMetrics(
            vote_count=int(data.get("vote_count") or 0),
            view_count=int(data.get("view_count") or 0),
            unique_view_count=int(data.get("unique_view_count") or 0),
            reply_count=int(data.get("reply_count") or 0),
            unresolved_count=int(data.get("unresolved_count") or 0),
            star_count=int(data.get("star_count") or 0),
            flag_count=int(data.get("flag_count") or 0),
        ),
        answers=[_parse_comment(c, users_map) for c in (data.get("answers") or [])],
        comments=[_parse_comment(c, users_map) for c in (data.get("comments") or [])],
        user_id=user_id,
        course_id=int(data.get("course_id") or 0),
        is_pinned=bool(data.get("is_pinned")),
        is_private=bool(data.get("is_private")),
        is_endorsed=bool(data.get("is_endorsed")),
        is_answered=bool(data.get("is_answered")),
        is_anonymous=bool(data.get("is_anonymous")),
        is_locked=bool(data.get("is_locked")),
        created_at=str(data.get("created_at") or ""),
        updated_at=str(data.get("updated_at") or ""),
        author=users_map.get(user_id),
    )


def _parse_comment(
    data: Dict[str, Any],
    users_map: Optional[Dict[int, User]] = None,
) -> Comment:
    if users_map is None:
        users_map = {}
    user_id = int(data.get("user_id") or 0)
    return Comment(
        id=int(data.get("id") or 0),
        content=str(data.get("content") or ""),
        document=str(data.get("document") or ""),
        type=str(data.get("type") or ""),
        user_id=user_id,
        vote_count=int(data.get("vote_count") or 0),
        is_endorsed=bool(data.get("is_endorsed")),
        is_anonymous=bool(data.get("is_anonymous")),
        is_resolved=bool(data.get("is_resolved")),
        created_at=str(data.get("created_at") or ""),
        comments=[_parse_comment(c, users_map) for c in (data.get("comments") or [])],
        author=users_map.get(user_id),
    )
