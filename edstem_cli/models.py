"""Data models for edstem-cli.

Defines User, Course, Thread, Comment, and ThreadMetrics as simple dataclasses.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, List, Optional


STAFF_COURSE_ROLES = frozenset({"admin", "ta", "tutor"})


@dataclass
class User:
    id: int
    name: str
    email: str = ""
    role: str = ""
    course_role: str = ""
    avatar: str = ""

    @property
    def is_staff(self) -> bool:
        return self.course_role in STAFF_COURSE_ROLES


@dataclass
class Course:
    id: int
    code: str
    name: str
    year: str = ""
    session: str = ""
    status: str = ""
    role: str = ""


@dataclass
class LessonModule:
    id: int
    course_id: int = 0
    name: str = ""
    user_id: int = 0
    created_at: str = ""
    updated_at: str = ""


@dataclass
class LessonSlide:
    id: int
    lesson_id: int = 0
    course_id: int = 0
    title: str = ""
    type: str = ""
    content: str = ""
    index: int = 0
    status: str = ""
    is_hidden: bool = False


@dataclass
class LessonQuestion:
    id: int
    slide_id: int = 0
    index: int = 0
    type: str = ""
    content: str = ""
    explanation: str = ""
    answers: List[str] = field(default_factory=list)
    solution: List[int] = field(default_factory=list)
    multiple_selection: bool = False
    is_assessed: bool = False
    is_formatted: bool = False
    lesson_markable_id: int = 0


@dataclass
class LessonQuestionResponse:
    question_id: int
    user_id: int = 0
    created_at: str = ""
    correct: Optional[bool] = None
    data: Any = None


@dataclass
class Lesson:
    id: int
    course_id: int = 0
    module_id: int = 0
    module_name: str = ""
    number: int = 0
    title: str = ""
    type: str = ""
    kind: str = ""
    state: str = ""
    status: str = ""
    outline: str = ""
    slide_count: int = 0
    slides: List[LessonSlide] = field(default_factory=list)
    openable: bool = False
    openable_without_attempt: bool = False
    is_hidden: bool = False
    is_unlisted: bool = False
    is_timed: bool = False
    available_at: str = ""
    due_at: str = ""
    locked_at: str = ""
    solutions_at: str = ""
    created_at: str = ""
    updated_at: str = ""


@dataclass
class ThreadMetrics:
    vote_count: int = 0
    view_count: int = 0
    unique_view_count: int = 0
    reply_count: int = 0
    unresolved_count: int = 0
    star_count: int = 0
    flag_count: int = 0


@dataclass
class Comment:
    id: int
    content: str = ""
    document: str = ""
    type: str = ""  # "comment" or "answer"
    user_id: int = 0
    vote_count: int = 0
    is_endorsed: bool = False
    is_anonymous: bool = False
    is_resolved: bool = False
    created_at: str = ""
    comments: List[Comment] = field(default_factory=list)
    author: Optional[User] = None


@dataclass
class Thread:
    id: int
    number: int = 0
    title: str = ""
    content: str = ""
    document: str = ""
    type: str = ""  # "post", "question", "announcement"
    category: str = ""
    subcategory: str = ""
    subsubcategory: str = ""
    metrics: ThreadMetrics = field(default_factory=ThreadMetrics)
    answers: List[Comment] = field(default_factory=list)
    comments: List[Comment] = field(default_factory=list)
    user_id: int = 0
    course_id: int = 0
    is_pinned: bool = False
    is_private: bool = False
    is_endorsed: bool = False
    is_answered: bool = False
    is_anonymous: bool = False
    is_locked: bool = False
    created_at: str = ""
    updated_at: str = ""
    author: Optional[User] = None
