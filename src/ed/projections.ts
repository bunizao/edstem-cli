import type {
  Comment,
  Course,
  Lesson,
  LessonQuestion,
  LessonQuestionResponse,
  Thread,
  ThreadMetrics,
  User,
  UserWithCourses,
} from "./models.js";

const STAFF_COURSE_ROLES = new Set(["admin", "ta", "tutor"]);
const TIMESTAMP_FRACTION = /\.\d+(?=Z|[+-]\d{2}:\d{2}|$)/;

export type JsonObject = Record<string, unknown>;

export function projectIdentity(identity: UserWithCourses): JsonObject {
  return {
    user: projectUser(identity.user, true),
    courses: identity.courses.map(projectCourse),
  };
}

export function projectUser(user: User, includePrivate = false): JsonObject {
  const result: JsonObject = { id: user.id, name: user.name };
  setNonEmpty(result, "courseRole", user.courseRole);
  setNonEmpty(result, "role", user.role);
  setNonEmpty(result, "avatar", user.avatar);
  if (includePrivate) {
    setNonEmpty(result, "email", user.email);
  }
  return result;
}

export function projectCourse(course: Course): JsonObject {
  const result: JsonObject = {
    id: course.id,
    code: course.code,
    name: course.name,
  };
  setNonEmpty(result, "year", course.year);
  setNonEmpty(result, "session", course.session);
  setNonEmpty(result, "status", course.status);
  setNonEmpty(result, "role", course.role);
  return result;
}

export function projectLessonSummary(lesson: Lesson): JsonObject {
  const result: JsonObject = {
    id: lesson.id,
    courseId: lesson.courseId,
    moduleId: lesson.moduleId,
    title: lesson.title,
  };
  setPositive(result, "number", lesson.number);
  setNonEmpty(result, "moduleName", lesson.moduleName);
  setNonEmpty(result, "type", lesson.type);
  setNonEmpty(result, "kind", lesson.kind);
  setNonEmpty(result, "state", lesson.state);
  setNonEmpty(result, "status", lesson.status);
  setPositive(result, "slideCount", lesson.slideCount);
  setTrue(result, "openable", lesson.openable);
  setTrue(result, "openableWithoutAttempt", lesson.openableWithoutAttempt);
  setTrue(result, "hidden", lesson.isHidden);
  setTrue(result, "unlisted", lesson.isUnlisted);
  setNonEmpty(result, "availableAt", normalizeTimestamp(lesson.availableAt));
  setNonEmpty(result, "dueAt", normalizeTimestamp(lesson.dueAt));
  return result;
}

export function projectLessonDetail(lesson: Lesson): JsonObject {
  const result = projectLessonSummary(lesson);
  setNonEmpty(result, "outline", lesson.outline);
  setNonEmpty(result, "lockedAt", normalizeTimestamp(lesson.lockedAt));
  setNonEmpty(result, "solutionsAt", normalizeTimestamp(lesson.solutionsAt));
  setNonEmpty(result, "createdAt", normalizeTimestamp(lesson.createdAt));
  setNonEmpty(result, "updatedAt", normalizeTimestamp(lesson.updatedAt));
  if (lesson.slides.length > 0) {
    result.slides = lesson.slides.map((slide) => {
      const projected: JsonObject = { id: slide.id, index: slide.index };
      setNonEmpty(projected, "title", slide.title);
      setNonEmpty(projected, "type", slide.type);
      setNonEmpty(projected, "status", slide.status);
      setNonEmpty(projected, "content", slide.content);
      setNonEmpty(projected, "fileUrl", slide.fileUrl);
      setTrue(projected, "hidden", slide.isHidden);
      return projected;
    });
  }
  return result;
}

export function projectQuestion(question: LessonQuestion): JsonObject {
  const result: JsonObject = {
    id: question.id,
    slideId: question.slideId,
    index: question.index,
    type: question.type,
    content: question.content,
    answers: question.answers,
  };
  setNonEmpty(result, "explanation", question.explanation);
  setNonEmpty(result, "solution", question.solution);
  setTrue(result, "multipleSelection", question.multipleSelection);
  setTrue(result, "assessed", question.isAssessed);
  setTrue(result, "formatted", question.isFormatted);
  setPositive(result, "lessonMarkableId", question.lessonMarkableId);
  return result;
}

export function projectQuestionResponse(response: LessonQuestionResponse): JsonObject {
  const result: JsonObject = {
    questionId: response.questionId,
    userId: response.userId,
  };
  setNonEmpty(result, "createdAt", normalizeTimestamp(response.createdAt));
  if (response.correct !== null) {
    result.correct = response.correct;
  }
  if (response.data !== null && response.data !== undefined) {
    result.data = response.data;
  }
  return result;
}

export function projectThreadSummary(thread: Thread): JsonObject {
  const result: JsonObject = {
    id: thread.id,
    number: thread.number,
    title: thread.title,
    type: thread.type,
    category: thread.category,
    courseId: thread.courseId,
  };
  setNonEmpty(result, "subcategory", thread.subcategory);
  setNonEmpty(result, "createdAt", normalizeTimestamp(thread.createdAt));
  setNonEmpty(result, "updatedAt", normalizeTimestamp(thread.updatedAt));
  setNonEmpty(result, "metrics", projectMetrics(thread.metrics));
  setNonEmpty(result, "flags", threadFlags(thread));
  return result;
}

export function projectThreadDetail(
  thread: Thread,
  options: { includeHtml?: boolean } = {}
): JsonObject {
  const users = collectUsers(thread);
  const result: JsonObject = {
    ...projectThreadSummary(thread),
    userId: thread.userId,
    document: thread.document,
  };
  if (options.includeHtml) {
    setNonEmpty(result, "content", thread.content);
  }
  const endorsement = projectEndorsement(thread);
  setNonEmpty(result, "endorsement", endorsement);
  if (users.size > 0) {
    result.users = Object.fromEntries(
      [...users.entries()]
        .sort(([left], [right]) => left - right)
        .map(([id, user]) => [String(id), projectUser(user)])
    );
  }
  if (thread.answers.length > 0) {
    result.answers = thread.answers.map((comment) => projectComment(comment, options));
  }
  if (thread.comments.length > 0) {
    result.comments = thread.comments.map((comment) => projectComment(comment, options));
  }
  return result;
}

export function compactActivity(items: unknown[]): unknown[] {
  return items.map(compactValue) as unknown[];
}

function projectComment(comment: Comment, options: { includeHtml?: boolean }): JsonObject {
  const result: JsonObject = {
    id: comment.id,
    userId: comment.userId,
    document: comment.document,
  };
  setNonEmpty(result, "createdAt", normalizeTimestamp(comment.createdAt));
  if (options.includeHtml) {
    setNonEmpty(result, "content", comment.content);
  }
  setNonZero(result, "voteCount", comment.voteCount);
  setTrue(result, "endorsed", comment.isEndorsed);
  setTrue(result, "anonymous", comment.isAnonymous);
  setTrue(result, "resolved", comment.isResolved);
  setTrue(result, "byStaff", isStaff(comment.author));
  if (comment.comments.length > 0) {
    result.comments = comment.comments.map((child) => projectComment(child, options));
  }
  return result;
}

function collectUsers(thread: Thread): Map<number, User> {
  const users = new Map<number, User>();
  rememberUser(users, thread.userId, thread.author);
  collectCommentUsers(users, thread.answers);
  collectCommentUsers(users, thread.comments);
  return users;
}

function collectCommentUsers(users: Map<number, User>, comments: Comment[]): void {
  for (const comment of comments) {
    rememberUser(users, comment.userId, comment.author);
    collectCommentUsers(users, comment.comments);
  }
}

function rememberUser(users: Map<number, User>, id: number, user: User | null): void {
  if (id <= 0 || users.has(id)) {
    return;
  }
  users.set(
    id,
    user ?? { id, name: "", email: "", role: "", courseRole: "", avatar: "" }
  );
}

function projectMetrics(metrics: ThreadMetrics): JsonObject {
  const result: JsonObject = {};
  setNonZero(result, "voteCount", metrics.voteCount);
  setNonZero(result, "viewCount", metrics.viewCount);
  setNonZero(result, "replyCount", metrics.replyCount);
  setNonZero(result, "starCount", metrics.starCount);
  return result;
}

function threadFlags(thread: Thread): string[] {
  return [
    thread.isPinned ? "pinned" : "",
    thread.isPrivate ? "private" : "",
    thread.isAnswered ? "answered" : "",
    thread.isEndorsed ? "endorsed" : "",
    thread.isAnonymous ? "anonymous" : "",
    thread.isLocked ? "locked" : "",
  ].filter(Boolean);
}

function projectEndorsement(thread: Thread): JsonObject {
  const endorsedAnswerIds: number[] = [];
  let staffReplyCount = 0;
  const visit = (comment: Comment): void => {
    if (comment.isEndorsed) {
      endorsedAnswerIds.push(comment.id);
    }
    if (isStaff(comment.author)) {
      staffReplyCount += 1;
    }
    comment.comments.forEach(visit);
  };
  thread.answers.forEach(visit);
  thread.comments.forEach(visit);

  const result: JsonObject = {};
  setNonEmpty(result, "endorsedAnswerIds", endorsedAnswerIds);
  setNonZero(result, "staffReplyCount", staffReplyCount);
  setTrue(result, "hasStaffAnswer", staffReplyCount > 0);
  return result;
}

function isStaff(user: User | null): boolean {
  return Boolean(user && STAFF_COURSE_ROLES.has(user.courseRole));
}

function normalizeTimestamp(value: string): string {
  return value.replace(TIMESTAMP_FRACTION, "");
}

function compactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(compactValue);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => [key, compactValue(item)] as const)
      .filter(([, item]) => item !== "" && item !== null && item !== false)
  );
}

function setNonEmpty(target: JsonObject, key: string, value: unknown): void {
  if (value === "" || value === null || value === undefined) {
    return;
  }
  if (Array.isArray(value) && value.length === 0) {
    return;
  }
  if (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) {
    return;
  }
  target[key] = value;
}

function setTrue(target: JsonObject, key: string, value: boolean): void {
  if (value) {
    target[key] = true;
  }
}

function setPositive(target: JsonObject, key: string, value: number): void {
  if (value > 0) {
    target[key] = value;
  }
}

function setNonZero(target: JsonObject, key: string, value: number): void {
  if (value !== 0) {
    target[key] = value;
  }
}
