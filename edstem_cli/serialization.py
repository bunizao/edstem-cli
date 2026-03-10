"""Serialization helpers for Thread, Course, Comment, and User models."""

from __future__ import annotations

import json
from typing import Any, Dict, Iterable, List

from .models import Comment, Course, Thread, ThreadMetrics, User


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
