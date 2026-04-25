"""Serialization helpers for Thread, Course, Lesson, Comment, and User models."""

from __future__ import annotations

import json
import re
from typing import Any, Dict, Iterable, List, Optional

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


def _set_if_nonempty(target: Dict[str, Any], key: str, value: Any) -> None:
    """Set a dict key when the value is not an empty string, list, or None."""
    if value in ("", None):
        return
    if isinstance(value, list) and not value:
        return
    target[key] = value


def _set_if_true(target: Dict[str, Any], key: str, value: bool) -> None:
    """Set a dict key when the boolean value is true."""
    if value:
        target[key] = value


def _set_if_nonzero(target: Dict[str, Any], key: str, value: int) -> None:
    """Set a dict key when the integer value is non-zero."""
    if value != 0:
        target[key] = value


_TIMESTAMP_FRACTION_RE = re.compile(r"\.\d+(?=(Z|[+-]\d{2}:\d{2}|$))")


def _normalize_timestamp(value: str) -> str:
    """Trim sub-second precision from timestamp strings."""
    if not value:
        return ""
    return _TIMESTAMP_FRACTION_RE.sub("", value)


def _json_dumps(data: Any, pretty: bool = False) -> str:
    """Serialize data with compact separators unless pretty output is requested."""
    if pretty:
        return json.dumps(data, ensure_ascii=False, indent=2)
    return json.dumps(data, ensure_ascii=False, separators=(",", ":"))


def thread_to_dict(thread: Thread) -> Dict[str, Any]:
    """Convert a Thread dataclass into the legacy JSON-safe dict."""
    return {
        "id": thread.id,
        "number": thread.number,
        "title": thread.title,
        "type": thread.type,
        "category": thread.category,
        "subcategory": thread.subcategory,
        "content": thread.content,
        "document": thread.document,
        "userId": thread.user_id,
        "courseId": thread.course_id,
        "metrics": {
            "voteCount": thread.metrics.vote_count,
            "viewCount": thread.metrics.view_count,
            "replyCount": thread.metrics.reply_count,
            "starCount": thread.metrics.star_count,
        },
        "isPinned": thread.is_pinned,
        "isPrivate": thread.is_private,
        "isAnswered": thread.is_answered,
        "isEndorsed": thread.is_endorsed,
        "isAnonymous": thread.is_anonymous,
        "createdAt": thread.created_at,
        "updatedAt": thread.updated_at,
        "answers": [comment_to_dict(c) for c in thread.answers],
        "comments": [comment_to_dict(c) for c in thread.comments],
        "author": user_to_dict(thread.author) if thread.author else None,
    }


def _clone_user(author: Optional[User], user_id: int) -> User:
    """Clone a user so compaction can merge metadata without mutating models."""
    if author is None:
        return User(id=user_id, name="")
    return User(
        id=user_id,
        name=author.name,
        email=author.email,
        role=author.role,
        course_role=author.course_role,
        avatar=author.avatar,
    )


def _remember_user(users: Dict[int, User], user_id: int, author: Optional[User]) -> None:
    """Add or merge a user reference into the hoisted compact user map."""
    if user_id <= 0:
        return
    current = users.get(user_id)
    if current is None:
        users[user_id] = _clone_user(author, user_id)
        return
    if author is None:
        return
    for attr in ("name", "email", "role", "course_role", "avatar"):
        value = getattr(author, attr)
        if value and not getattr(current, attr):
            setattr(current, attr, value)


def _collect_comment_users(users: Dict[int, User], comments: Iterable[Comment]) -> None:
    """Collect users referenced by a comment tree."""
    for comment in comments:
        _remember_user(users, comment.user_id, comment.author)
        _collect_comment_users(users, comment.comments)


def _collect_users(thread: Thread) -> Dict[int, User]:
    """Collect every distinct user referenced by a thread."""
    users: Dict[int, User] = {}
    _remember_user(users, thread.user_id, thread.author)
    _collect_comment_users(users, thread.answers)
    _collect_comment_users(users, thread.comments)
    return users


def _compact_user_to_dict(user: User) -> Dict[str, Any]:
    """Convert a User dataclass into the compact user shape."""
    data: Dict[str, Any] = {}
    _set_if_nonempty(data, "name", user.name)
    _set_if_nonempty(data, "courseRole", user.course_role)
    _set_if_nonempty(data, "email", user.email)
    _set_if_nonempty(data, "role", user.role)
    _set_if_nonempty(data, "avatar", user.avatar)
    return data


def _compact_metrics_dict(metrics: ThreadMetrics) -> Dict[str, Any]:
    """Serialize non-zero metrics for compact thread JSON."""
    data: Dict[str, Any] = {}
    _set_if_nonzero(data, "voteCount", metrics.vote_count)
    _set_if_nonzero(data, "viewCount", metrics.view_count)
    _set_if_nonzero(data, "replyCount", metrics.reply_count)
    _set_if_nonzero(data, "starCount", metrics.star_count)
    return data


def _comment_is_staff(comment: Comment) -> bool:
    """Report whether a comment author is marked as staff in source data."""
    return bool(comment.author and comment.author.is_staff)


def _collect_endorsement(comment: Comment, endorsed_ids: List[int], staff_reply_count: List[int]) -> None:
    """Walk a comment tree and accumulate endorsement and staff signals."""
    if comment.is_endorsed:
        endorsed_ids.append(comment.id)
    if _comment_is_staff(comment):
        staff_reply_count[0] += 1
    for child in comment.comments:
        _collect_endorsement(child, endorsed_ids, staff_reply_count)


def _compute_endorsement(thread: Thread) -> Dict[str, Any]:
    """Compute thread-level endorsement and staff reply signals."""
    endorsed_ids: List[int] = []
    staff_reply_count = [0]
    for comment in thread.answers:
        _collect_endorsement(comment, endorsed_ids, staff_reply_count)
    for comment in thread.comments:
        _collect_endorsement(comment, endorsed_ids, staff_reply_count)

    data: Dict[str, Any] = {}
    _set_if_nonempty(data, "endorsedAnswerIds", endorsed_ids)
    _set_if_nonzero(data, "staffReplyCount", staff_reply_count[0])
    _set_if_true(data, "hasStaffAnswer", staff_reply_count[0] > 0)
    return data


def _compact_comment_to_dict(comment: Comment, include_html: bool = False) -> Dict[str, Any]:
    """Convert a Comment dataclass into the compact JSON-safe dict."""
    data: Dict[str, Any] = {
        "id": comment.id,
        "userId": comment.user_id,
        "document": comment.document,
        "createdAt": _normalize_timestamp(comment.created_at),
    }
    if include_html:
        _set_if_nonempty(data, "content", comment.content)
    _set_if_nonzero(data, "voteCount", comment.vote_count)
    _set_if_true(data, "endorsed", comment.is_endorsed)
    _set_if_true(data, "anonymous", comment.is_anonymous)
    _set_if_true(data, "resolved", comment.is_resolved)
    _set_if_true(data, "byStaff", _comment_is_staff(comment))
    _set_if_nonempty(
        data,
        "comments",
        [_compact_comment_to_dict(child, include_html=include_html) for child in comment.comments],
    )
    return data


def _thread_flags(thread: Thread) -> List[str]:
    """Serialize true thread booleans into a compact flags list."""
    flags: List[str] = []
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


def thread_to_compact_dict(thread: Thread, include_html: bool = False) -> Dict[str, Any]:
    """Convert a Thread dataclass into the compact agent-friendly JSON shape."""
    users = _collect_users(thread)
    data: Dict[str, Any] = {
        "id": thread.id,
        "number": thread.number,
        "title": thread.title,
        "type": thread.type,
        "category": thread.category,
        "userId": thread.user_id,
        "courseId": thread.course_id,
        "createdAt": _normalize_timestamp(thread.created_at),
        "updatedAt": _normalize_timestamp(thread.updated_at),
        "document": thread.document,
    }
    _set_if_nonempty(data, "subcategory", thread.subcategory)
    if include_html:
        _set_if_nonempty(data, "content", thread.content)
    _set_if_nonempty(data, "metrics", _compact_metrics_dict(thread.metrics))
    _set_if_nonempty(data, "flags", _thread_flags(thread))
    _set_if_nonempty(data, "endorsement", _compute_endorsement(thread))
    _set_if_nonempty(
        data,
        "users",
        {str(user_id): _compact_user_to_dict(users[user_id]) for user_id in sorted(users)},
    )
    _set_if_nonempty(
        data,
        "answers",
        [_compact_comment_to_dict(comment, include_html=include_html) for comment in thread.answers],
    )
    _set_if_nonempty(
        data,
        "comments",
        [_compact_comment_to_dict(comment, include_html=include_html) for comment in thread.comments],
    )
    return data


def thread_to_json(
    thread: Thread,
    include_html: bool = False,
    legacy: bool = False,
    pretty: bool = False,
) -> str:
    """Serialize a thread using either the compact or legacy JSON shape."""
    if legacy:
        return _json_dumps(thread_to_dict(thread), pretty=pretty)
    return _json_dumps(thread_to_compact_dict(thread, include_html=include_html), pretty=pretty)


def thread_from_dict(data: Dict[str, Any]) -> Thread:
    """Convert either compact or legacy JSON into a Thread dataclass."""
    metrics_data = data.get("metrics") or {}
    users_map = _parse_users_lookup(data.get("users"))
    author_data = data.get("author")
    user_id = int(data.get("userId") or 0)
    return Thread(
        id=int(data.get("id") or 0),
        number=int(data.get("number") or 0),
        title=str(data.get("title") or ""),
        type=str(data.get("type") or ""),
        category=str(data.get("category") or ""),
        subcategory=str(data.get("subcategory") or ""),
        content=str(data.get("content") or ""),
        document=str(data.get("document") or ""),
        user_id=user_id,
        course_id=int(data.get("courseId") or 0),
        metrics=ThreadMetrics(
            vote_count=int(metrics_data.get("voteCount") or 0),
            view_count=int(metrics_data.get("viewCount") or 0),
            reply_count=int(metrics_data.get("replyCount") or 0),
            star_count=int(metrics_data.get("starCount") or 0),
        ),
        is_pinned=_flag_enabled(data, "pinned", "isPinned"),
        is_private=_flag_enabled(data, "private", "isPrivate"),
        is_answered=_flag_enabled(data, "answered", "isAnswered"),
        is_endorsed=_flag_enabled(data, "endorsed", "isEndorsed"),
        is_anonymous=_flag_enabled(data, "anonymous", "isAnonymous"),
        is_locked=_flag_enabled(data, "locked", "isLocked"),
        created_at=str(data.get("createdAt") or ""),
        updated_at=str(data.get("updatedAt") or ""),
        answers=[
            comment_from_dict(c, users_map=users_map, default_type="answer")
            for c in (data.get("answers") or [])
            if isinstance(c, dict)
        ],
        comments=[
            comment_from_dict(c, users_map=users_map, default_type="comment")
            for c in (data.get("comments") or [])
            if isinstance(c, dict)
        ],
        author=(
            users_map.get(user_id)
            or (user_from_dict(author_data) if isinstance(author_data, dict) else None)
        ),
    )


def comment_to_dict(comment: Comment) -> Dict[str, Any]:
    """Convert a Comment dataclass into the legacy JSON-safe dict."""
    return {
        "id": comment.id,
        "type": comment.type,
        "content": comment.content,
        "document": comment.document,
        "userId": comment.user_id,
        "voteCount": comment.vote_count,
        "isEndorsed": comment.is_endorsed,
        "isAnonymous": comment.is_anonymous,
        "createdAt": comment.created_at,
        "comments": [comment_to_dict(c) for c in comment.comments],
        "author": user_to_dict(comment.author) if comment.author else None,
    }


def _parse_users_lookup(data: Any) -> Dict[int, User]:
    """Parse hoisted compact users maps and legacy user lists."""
    users: Dict[int, User] = {}
    if isinstance(data, dict):
        items = data.items()
    elif isinstance(data, list):
        items = []
        for item in data:
            if not isinstance(item, dict):
                continue
            items.append((item.get("id"), item))
    else:
        return users

    for raw_user_id, raw_user in items:
        if not isinstance(raw_user, dict):
            continue
        user_id = int(raw_user_id or raw_user.get("id") or 0)
        if user_id <= 0:
            continue
        users[user_id] = User(
            id=user_id,
            name=str(raw_user.get("name") or ""),
            email=str(raw_user.get("email") or ""),
            role=str(raw_user.get("role") or ""),
            course_role=str(raw_user.get("courseRole") or raw_user.get("course_role") or ""),
            avatar=str(raw_user.get("avatar") or ""),
        )
    return users


def _flag_enabled(data: Dict[str, Any], flag: str, legacy_key: str) -> bool:
    """Check compact flags arrays first, then fall back to legacy booleans."""
    flags = data.get("flags")
    if isinstance(flags, list) and flag in flags:
        return True
    return bool(data.get(legacy_key))


def comment_from_dict(
    data: Dict[str, Any],
    users_map: Optional[Dict[int, User]] = None,
    default_type: str = "comment",
) -> Comment:
    """Convert either compact or legacy comment JSON into a Comment dataclass."""
    author_data = data.get("author")
    if users_map is None:
        users_map = {}
    user_id = int(data.get("userId") or 0)
    return Comment(
        id=int(data.get("id") or 0),
        type=str(data.get("type") or default_type),
        content=str(data.get("content") or ""),
        document=str(data.get("document") or ""),
        user_id=user_id,
        vote_count=int(data.get("voteCount") or 0),
        is_endorsed=bool(data.get("isEndorsed") or data.get("endorsed")),
        is_anonymous=bool(data.get("isAnonymous") or data.get("anonymous")),
        is_resolved=bool(data.get("isResolved") or data.get("resolved")),
        created_at=str(data.get("createdAt") or ""),
        comments=[
            comment_from_dict(c, users_map=users_map, default_type="comment")
            for c in (data.get("comments") or [])
            if isinstance(c, dict)
        ],
        author=(
            users_map.get(user_id)
            or (user_from_dict(author_data) if isinstance(author_data, dict) else None)
        ),
    )


def course_to_dict(course: Course) -> Dict[str, Any]:
    """Convert a Course dataclass into a JSON-safe dict."""
    return {
        "id": course.id,
        "code": course.code,
        "name": course.name,
        "year": course.year,
        "session": course.session,
        "status": course.status,
        "role": course.role,
    }


def lesson_module_to_dict(module: LessonModule) -> Dict[str, Any]:
    """Convert a LessonModule dataclass into a JSON-safe dict."""
    return {
        "id": module.id,
        "courseId": module.course_id,
        "name": module.name,
        "userId": module.user_id,
        "createdAt": module.created_at,
        "updatedAt": module.updated_at,
    }


def lesson_slide_to_dict(slide: LessonSlide) -> Dict[str, Any]:
    """Convert a LessonSlide dataclass into a JSON-safe dict."""
    return {
        "id": slide.id,
        "lessonId": slide.lesson_id,
        "courseId": slide.course_id,
        "title": slide.title,
        "type": slide.type,
        "content": slide.content,
        "index": slide.index,
        "status": slide.status,
        "isHidden": slide.is_hidden,
    }


def lesson_to_dict(lesson: Lesson) -> Dict[str, Any]:
    """Convert a Lesson dataclass into a JSON-safe dict."""
    data = {
        "id": lesson.id,
        "moduleId": lesson.module_id,
        "title": lesson.title,
        "type": lesson.type,
        "kind": lesson.kind,
        "state": lesson.state,
        "status": lesson.status,
        "slideCount": lesson.slide_count,
        "openable": lesson.openable,
        "createdAt": lesson.created_at,
    }
    if lesson.number > 0:
        data["number"] = lesson.number
    _set_if_nonempty(data, "moduleName", lesson.module_name)
    _set_if_nonempty(data, "outline", lesson.outline)
    _set_if_nonempty(data, "slides", [lesson_slide_to_dict(slide) for slide in lesson.slides])
    _set_if_true(data, "openableWithoutAttempt", lesson.openable_without_attempt)
    _set_if_true(data, "isHidden", lesson.is_hidden)
    _set_if_true(data, "isUnlisted", lesson.is_unlisted)
    _set_if_true(data, "isTimed", lesson.is_timed)
    _set_if_nonempty(data, "availableAt", lesson.available_at)
    _set_if_nonempty(data, "dueAt", lesson.due_at)
    _set_if_nonempty(data, "lockedAt", lesson.locked_at)
    _set_if_nonempty(data, "solutionsAt", lesson.solutions_at)
    _set_if_nonempty(data, "updatedAt", lesson.updated_at)
    return data


def lesson_question_to_dict(question: LessonQuestion) -> Dict[str, Any]:
    """Convert a LessonQuestion dataclass into a JSON-safe dict."""
    data = {
        "id": question.id,
        "slideId": question.slide_id,
        "index": question.index,
        "type": question.type,
        "content": question.content,
        "answers": question.answers,
    }
    _set_if_nonempty(data, "explanation", question.explanation)
    _set_if_nonempty(data, "solution", question.solution)
    _set_if_true(data, "multipleSelection", question.multiple_selection)
    _set_if_true(data, "isAssessed", question.is_assessed)
    _set_if_true(data, "isFormatted", question.is_formatted)
    if question.lesson_markable_id > 0:
        data["lessonMarkableId"] = question.lesson_markable_id
    return data


def lesson_question_response_to_dict(response: LessonQuestionResponse) -> Dict[str, Any]:
    """Convert a LessonQuestionResponse dataclass into a JSON-safe dict."""
    data = {
        "questionId": response.question_id,
        "userId": response.user_id,
        "data": response.data,
        "createdAt": response.created_at,
    }
    if response.correct is not None:
        data["correct"] = response.correct
    return data


def user_to_dict(user: User) -> Dict[str, Any]:
    """Convert a User dataclass into a JSON-safe dict."""
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "role": user.role,
        "courseRole": user.course_role,
        "avatar": user.avatar,
    }


def user_from_dict(data: Dict[str, Any]) -> User:
    """Convert a dict into a User dataclass."""
    return User(
        id=int(data.get("id") or 0),
        name=str(data.get("name") or ""),
        email=str(data.get("email") or ""),
        role=str(data.get("role") or ""),
        course_role=str(data.get("courseRole") or data.get("course_role") or ""),
        avatar=str(data.get("avatar") or ""),
    )


def threads_to_json(threads: Iterable[Thread]) -> str:
    """Serialize Thread objects to pretty JSON."""
    return json.dumps([thread_to_dict(t) for t in threads], ensure_ascii=False, indent=2)


def threads_from_json(raw: str) -> List[Thread]:
    """Parse a JSON string into Thread objects."""
    payload = json.loads(raw)
    if not isinstance(payload, list):
        raise ValueError("Thread JSON payload must be a list")
    return [thread_from_dict(item) for item in payload if isinstance(item, dict)]


def courses_to_json(courses: Iterable[Course]) -> str:
    """Serialize Course objects to pretty JSON."""
    return json.dumps([course_to_dict(c) for c in courses], ensure_ascii=False, indent=2)


def lessons_to_json(lessons: Iterable[Lesson]) -> str:
    """Serialize Lesson objects to pretty JSON."""
    return json.dumps([lesson_to_dict(lesson) for lesson in lessons], ensure_ascii=False, indent=2)


def lesson_questions_to_json(questions: Iterable[LessonQuestion]) -> str:
    """Serialize LessonQuestion objects to pretty JSON."""
    return json.dumps(
        [lesson_question_to_dict(question) for question in questions],
        ensure_ascii=False,
        indent=2,
    )


def lesson_question_responses_to_json(responses: Iterable[LessonQuestionResponse]) -> str:
    """Serialize LessonQuestionResponse objects to pretty JSON."""
    return json.dumps(
        [lesson_question_response_to_dict(response) for response in responses],
        ensure_ascii=False,
        indent=2,
    )
