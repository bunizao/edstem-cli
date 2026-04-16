"""Serialization helpers for Thread, Course, Lesson, Comment, and User models."""

from __future__ import annotations

import json
from typing import Any, Dict, Iterable, List

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


def thread_to_dict(thread: Thread) -> Dict[str, Any]:
    """Convert a Thread dataclass into a JSON-safe dict."""
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


def thread_from_dict(data: Dict[str, Any]) -> Thread:
    """Convert a dict into a Thread dataclass."""
    metrics_data = data.get("metrics") or {}
    author_data = data.get("author")
    return Thread(
        id=int(data.get("id") or 0),
        number=int(data.get("number") or 0),
        title=str(data.get("title") or ""),
        type=str(data.get("type") or ""),
        category=str(data.get("category") or ""),
        subcategory=str(data.get("subcategory") or ""),
        content=str(data.get("content") or ""),
        document=str(data.get("document") or ""),
        user_id=int(data.get("userId") or 0),
        course_id=int(data.get("courseId") or 0),
        metrics=ThreadMetrics(
            vote_count=int(metrics_data.get("voteCount") or 0),
            view_count=int(metrics_data.get("viewCount") or 0),
            reply_count=int(metrics_data.get("replyCount") or 0),
            star_count=int(metrics_data.get("starCount") or 0),
        ),
        is_pinned=bool(data.get("isPinned")),
        is_private=bool(data.get("isPrivate")),
        is_answered=bool(data.get("isAnswered")),
        is_endorsed=bool(data.get("isEndorsed")),
        is_anonymous=bool(data.get("isAnonymous")),
        created_at=str(data.get("createdAt") or ""),
        updated_at=str(data.get("updatedAt") or ""),
        answers=[comment_from_dict(c) for c in (data.get("answers") or []) if isinstance(c, dict)],
        comments=[
            comment_from_dict(c) for c in (data.get("comments") or []) if isinstance(c, dict)
        ],
        author=user_from_dict(author_data) if isinstance(author_data, dict) else None,
    )


def comment_to_dict(comment: Comment) -> Dict[str, Any]:
    """Convert a Comment dataclass into a JSON-safe dict."""
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


def comment_from_dict(data: Dict[str, Any]) -> Comment:
    """Convert a dict into a Comment dataclass."""
    author_data = data.get("author")
    return Comment(
        id=int(data.get("id") or 0),
        type=str(data.get("type") or ""),
        content=str(data.get("content") or ""),
        document=str(data.get("document") or ""),
        user_id=int(data.get("userId") or 0),
        vote_count=int(data.get("voteCount") or 0),
        is_endorsed=bool(data.get("isEndorsed")),
        is_anonymous=bool(data.get("isAnonymous")),
        created_at=str(data.get("createdAt") or ""),
        comments=[
            comment_from_dict(c) for c in (data.get("comments") or []) if isinstance(c, dict)
        ],
        author=user_from_dict(author_data) if isinstance(author_data, dict) else None,
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
        course_role=str(data.get("courseRole") or ""),
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
