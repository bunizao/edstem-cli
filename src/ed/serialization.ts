import type {
  Comment,
  Course,
  Lesson,
  LessonModule,
  LessonQuestion,
  LessonQuestionResponse,
  LessonSlide,
  Thread,
  User
} from "./models.js";

function setIfNonEmpty(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value === "" || value === null || value === undefined) {
    return;
  }
  if (Array.isArray(value) && value.length === 0) {
    return;
  }
  target[key] = value;
}

function setIfTrue(target: Record<string, unknown>, key: string, value: boolean): void {
  if (value) {
    target[key] = true;
  }
}

export function serializeUser(user: User): Record<string, unknown> {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    courseRole: user.courseRole,
    avatar: user.avatar
  };
}

export function serializeCourse(course: Course): Record<string, unknown> {
  return {
    id: course.id,
    code: course.code,
    name: course.name,
    year: course.year,
    session: course.session,
    status: course.status,
    role: course.role
  };
}

export function serializeLessonModule(module: LessonModule): Record<string, unknown> {
  return {
    id: module.id,
    courseId: module.courseId,
    name: module.name,
    userId: module.userId,
    createdAt: module.createdAt,
    updatedAt: module.updatedAt
  };
}

export function serializeLessonSlide(slide: LessonSlide): Record<string, unknown> {
  return {
    id: slide.id,
    lessonId: slide.lessonId,
    courseId: slide.courseId,
    title: slide.title,
    type: slide.type,
    content: slide.content,
    index: slide.index,
    status: slide.status,
    isHidden: slide.isHidden
  };
}

export function serializeLesson(lesson: Lesson): Record<string, unknown> {
  const data: Record<string, unknown> = {
    id: lesson.id,
    courseId: lesson.courseId,
    moduleId: lesson.moduleId,
    title: lesson.title,
    type: lesson.type,
    kind: lesson.kind,
    state: lesson.state,
    status: lesson.status,
    slideCount: lesson.slideCount,
    openable: lesson.openable,
    createdAt: lesson.createdAt
  };

  if (lesson.number > 0) {
    data.number = lesson.number;
  }

  setIfNonEmpty(data, "moduleName", lesson.moduleName);
  setIfNonEmpty(data, "outline", lesson.outline);
  setIfNonEmpty(
    data,
    "slides",
    lesson.slides.map((slide) => serializeLessonSlide(slide))
  );
  setIfTrue(data, "openableWithoutAttempt", lesson.openableWithoutAttempt);
  setIfTrue(data, "isHidden", lesson.isHidden);
  setIfTrue(data, "isUnlisted", lesson.isUnlisted);
  setIfTrue(data, "isTimed", lesson.isTimed);
  setIfNonEmpty(data, "availableAt", lesson.availableAt);
  setIfNonEmpty(data, "dueAt", lesson.dueAt);
  setIfNonEmpty(data, "lockedAt", lesson.lockedAt);
  setIfNonEmpty(data, "solutionsAt", lesson.solutionsAt);
  setIfNonEmpty(data, "updatedAt", lesson.updatedAt);
  return data;
}

export function serializeLessonQuestion(question: LessonQuestion): Record<string, unknown> {
  const data: Record<string, unknown> = {
    id: question.id,
    slideId: question.slideId,
    index: question.index,
    type: question.type,
    content: question.content,
    answers: question.answers
  };
  setIfNonEmpty(data, "explanation", question.explanation);
  setIfNonEmpty(data, "solution", question.solution);
  setIfTrue(data, "multipleSelection", question.multipleSelection);
  setIfTrue(data, "isAssessed", question.isAssessed);
  setIfTrue(data, "isFormatted", question.isFormatted);
  if (question.lessonMarkableId > 0) {
    data.lessonMarkableId = question.lessonMarkableId;
  }
  return data;
}

export function serializeLessonQuestionResponse(
  response: LessonQuestionResponse
): Record<string, unknown> {
  const data: Record<string, unknown> = {
    questionId: response.questionId,
    userId: response.userId,
    data: response.data,
    createdAt: response.createdAt
  };
  if (response.correct !== null) {
    data.correct = response.correct;
  }
  return data;
}

export function serializeComment(comment: Comment): Record<string, unknown> {
  return {
    id: comment.id,
    type: comment.type,
    content: comment.content,
    document: comment.document,
    userId: comment.userId,
    voteCount: comment.voteCount,
    isEndorsed: comment.isEndorsed,
    isAnonymous: comment.isAnonymous,
    createdAt: comment.createdAt,
    comments: comment.comments.map((child) => serializeComment(child)),
    author: comment.author ? serializeUser(comment.author) : null
  };
}

export function serializeThread(thread: Thread): Record<string, unknown> {
  return {
    id: thread.id,
    number: thread.number,
    title: thread.title,
    type: thread.type,
    category: thread.category,
    subcategory: thread.subcategory,
    content: thread.content,
    document: thread.document,
    userId: thread.userId,
    courseId: thread.courseId,
    metrics: {
      voteCount: thread.metrics.voteCount,
      viewCount: thread.metrics.viewCount,
      replyCount: thread.metrics.replyCount,
      starCount: thread.metrics.starCount
    },
    isPinned: thread.isPinned,
    isPrivate: thread.isPrivate,
    isAnswered: thread.isAnswered,
    isEndorsed: thread.isEndorsed,
    isAnonymous: thread.isAnonymous,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    answers: thread.answers.map((comment) => serializeComment(comment)),
    comments: thread.comments.map((comment) => serializeComment(comment)),
    author: thread.author ? serializeUser(thread.author) : null
  };
}
