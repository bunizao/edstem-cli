import { EdApiError, EdAuthExpiredError, type EdClient } from "./client.js";
import {
  filterThreads,
  hasThreadFilters,
  isThreadOlderThan,
  parseSince,
  type ThreadFilterOptions,
} from "./filter.js";
import type { Comment, Course, Grade, Lesson, Thread } from "./models.js";

/** Hard cap on Ed requests per filtered thread listing. */
const THREAD_PAGE_CAP = 10;

export type CourseReference = number | string;

export interface ThreadListOptions extends ThreadFilterOptions {
  courseId: CourseReference;
  limit: number;
  offset?: number;
  sort: string;
  onIncomplete?: () => void;
}

export class EdInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EdInputError";
  }
}

export class EdCourseNotFoundError extends EdInputError {
  constructor(message: string) {
    super(message);
    this.name = "EdCourseNotFoundError";
  }
}

export async function listThreads(client: EdClient, options: ThreadListOptions): Promise<Thread[]> {
  assertPositive(options.limit, "--limit");
  const offset = options.offset ?? 0;
  assertNonNegative(offset, "--offset");
  const courseId = await resolveCourseId(client, options.courseId);
  if (!hasThreadFilters(options)) {
    return client.fetchThreads(courseId, {
      limit: Math.min(options.limit, 100),
      offset,
      sort: options.sort,
    });
  }

  // Ed applies none of these filters, so page until enough threads match.
  const pageSize = Math.min(100, Math.max(options.limit, 30));
  const matches: Thread[] = [];
  for (let page = 0; page < THREAD_PAGE_CAP; page += 1) {
    const threads = await client.fetchThreads(courseId, {
      limit: pageSize,
      offset: offset + page * pageSize,
      sort: options.sort,
    });
    matches.push(...filterThreads(threads, options));
    if (matches.length >= options.limit || threads.length < pageSize) {
      return matches.slice(0, options.limit);
    }
    if (options.sort === "new" && passedSince(threads, options.since)) {
      return matches.slice(0, options.limit);
    }
  }
  options.onIncomplete?.();
  return matches.slice(0, options.limit);
}

/** Parse a --since / since value into a cutoff, reporting failures as usage errors. */
export function parseSinceValue(value: string): Date {
  try {
    return parseSince(value);
  } catch (error) {
    throw new EdInputError(error instanceof Error ? error.message : String(error));
  }
}

/**
 * On a newest-first page, an older last thread means every later page is older too.
 * Ed keeps pinned threads first whatever their date, so they never end the walk.
 */
export function passedSince(threads: Thread[], since: Date | undefined): boolean {
  const oldest = threads.filter((thread) => !thread.isPinned).at(-1);
  return Boolean(since && oldest && isThreadOlderThan(oldest, since));
}

export async function resolveThread(client: EdClient, reference: string): Promise<Thread> {
  const normalized = reference.trim();
  if (/^\d+$/.test(normalized)) {
    return client.fetchThread(Number(normalized));
  }

  const match = /^(.+)#(\d+)$/.exec(normalized);
  if (match) {
    const courseId = await resolveCourseId(client, match[1] ?? "");
    return client.fetchCourseThread(courseId, Number(match[2]));
  }

  throw new EdInputError(
    "Thread reference must be a thread ID or course ID/code followed by #number"
  );
}

/** Ed replies to a question thread default to an answer; other threads take comments. */
export function defaultReplyType(threadType: string): "answer" | "comment" {
  return threadType.trim().toLowerCase() === "question" ? "answer" : "comment";
}

/**
 * Ed accepts a reply under any comment ID, so a mismatched ID would post to another
 * thread while we report the requested one.
 */
export function assertCommentInThread(thread: Thread, commentId: number): Comment {
  const comment = findComment([...thread.answers, ...thread.comments], commentId);
  if (!comment) {
    throw new EdInputError(`Comment ${commentId} does not belong to thread ${thread.id}.`);
  }
  return comment;
}

function findComment(comments: Comment[], commentId: number): Comment | undefined {
  for (const comment of comments) {
    if (comment.id === commentId) return comment;
    const nested = findComment(comment.comments, commentId);
    if (nested) return nested;
  }
  return undefined;
}

export interface LessonListOptions {
  lessonType?: string;
  module?: string;
  state?: string;
  status?: string;
}

export async function listLessons(
  client: EdClient,
  courseReference: CourseReference,
  options: LessonListOptions = {}
): Promise<Lesson[]> {
  const courseId = await resolveCourseId(client, courseReference);
  const { lessons } = await client.fetchLessons(courseId);
  if (lessons.length === 0) {
    return [];
  }

  const moduleQuery = normalizeFilter(options.module);
  const lessonTypeQuery = normalizeFilter(options.lessonType);
  const stateQuery = normalizeFilter(options.state);
  const statusQuery = normalizeFilter(options.status);

  assertKnownModule(lessons, moduleQuery, options.module);
  assertKnownLessonValue(lessons, "type", lessonTypeQuery, options.lessonType);
  assertKnownLessonValue(lessons, "state", stateQuery, options.state);
  assertKnownLessonValue(lessons, "status", statusQuery, options.status);

  return lessons.filter((lesson) =>
    matchesModule(lesson, moduleQuery) &&
    matchesLessonValue(lesson, "type", lessonTypeQuery) &&
    matchesLessonValue(lesson, "state", stateQuery) &&
    matchesLessonValue(lesson, "status", statusQuery)
  );
}

function normalizeFilter(value?: string): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && normalized !== "all" ? normalized : undefined;
}

function assertKnownModule(
  lessons: Lesson[],
  query: string | undefined,
  input: string | undefined
): void {
  if (
    !query ||
    lessons.some((lesson) => matchesModule(lesson, query))
  ) {
    return;
  }

  const modules = new Map<number, string>();
  for (const lesson of lessons) {
    modules.set(lesson.moduleId, lesson.moduleName);
  }
  const available = [...modules]
    .map(([id, name]) => `${id} (${name})`)
    .join(", ");
  throw unknownLessonFilter("module", input, available);
}

function assertKnownLessonValue(
  lessons: Lesson[],
  field: "type" | "state" | "status",
  query: string | undefined,
  input: string | undefined
): void {
  if (!query || lessons.some((lesson) => matchesLessonValue(lesson, field, query))) {
    return;
  }

  const available = [...new Set(lessons.map((lesson) => lesson[field]).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right))
    .join(", ");
  throw unknownLessonFilter(field, input, available);
}

function matchesModule(lesson: Lesson, query: string | undefined): boolean {
  return !query ||
    String(lesson.moduleId) === query ||
    lesson.moduleName.toLowerCase().includes(query);
}

function matchesLessonValue(
  lesson: Lesson,
  field: "type" | "state" | "status",
  query: string | undefined
): boolean {
  return !query || lesson[field].toLowerCase() === query;
}

function unknownLessonFilter(field: string, input: string | undefined, available: string): EdInputError {
  return new EdInputError(
    `Unknown lesson ${field} ${JSON.stringify(input?.trim())}. Available values: ${available}. ` +
    'Use "all" or omit the filter to include every value.'
  );
}

export async function listCurrentActivity(
  client: EdClient,
  options: { courseId?: CourseReference; filterType?: string; limit: number }
): Promise<unknown[]> {
  assertPositive(options.limit, "--limit");
  const { courses, user } = await client.fetchUser();
  const courseId = options.courseId === undefined
    ? undefined
    : resolveCourseIdFromCourses(options.courseId, courses);
  return client.fetchUserActivity(user.id, { ...options, courseId });
}

export async function resolveCourseId(
  client: EdClient,
  reference: CourseReference
): Promise<number> {
  const id = directCourseId(reference);
  if (id !== undefined) {
    return id;
  }
  const { courses } = await client.fetchUser();
  return resolveCourseIdFromCourses(reference, courses);
}

export async function resolveCourse(
  client: EdClient,
  reference: CourseReference
): Promise<Course> {
  const { courses } = await client.fetchUser();
  const id = directCourseId(reference);
  if (id !== undefined) {
    const course = courses.find((candidate) => candidate.id === id);
    if (course) return course;
    throw new EdCourseNotFoundError(`Unknown course ID ${id}.`);
  }
  return resolveCourseCode(reference, courses);
}

function resolveCourseIdFromCourses(reference: CourseReference, courses: Course[]): number {
  const id = directCourseId(reference);
  if (id !== undefined) {
    return id;
  }

  return resolveCourseCode(reference, courses).id;
}

/**
 * A reference is matched against the site's own list, never against an assumed code
 * format. Ed's code often carries the teaching period ("CODE 2026 S2"), so the code a
 * student actually types is its leading token; the unit name is matched too, because
 * that is the other name the unit is known by. Tiers are tried in order so an exact
 * code always beats a substring.
 */
function resolveCourseCode(reference: CourseReference, courses: Course[]): Course {
  const query = String(reference).trim().toLowerCase();
  const tiers: ((course: Course) => boolean)[] = [
    (course) => lower(course.code) === query,
    (course) => firstToken(course.code) === query,
    (course) => lower(course.name) === query,
    (course) => lower(course.code).includes(query) || lower(course.name).includes(query),
  ];

  for (const matches of tiers.map((tier) => courses.filter(tier))) {
    if (matches.length === 0) continue;
    const sorted = [...matches].sort((left, right) => left.id - right.id);
    if (sorted.length === 1 && sorted[0]) return sorted[0];
    throw new EdInputError(
      `Unit ${JSON.stringify(String(reference).trim())} is ambiguous. Matching units: ` +
      `${sorted.map(formatCourseChoice).join(", ")}. Use a unit ID.`
    );
  }

  const available = courses.map(formatCourseName).filter(Boolean).join(", ");
  throw new EdCourseNotFoundError(
    `No unit matches ${JSON.stringify(String(reference).trim())}. Your units: ${available || "none"}.`
  );
}

function lower(value: string | undefined): string {
  return (value ?? "").toLowerCase();
}

function firstToken(code: string | undefined): string {
  return lower(code).trim().split(/\s+/u)[0] ?? "";
}

function formatCourseName(course: Course): string {
  return course.code || course.name || String(course.id);
}

function formatCourseChoice(course: Course): string {
  const details = [course.code, course.year, course.session, course.status].filter(Boolean).join(", ");
  return details ? `${course.id} (${details})` : String(course.id);
}

function directCourseId(reference: CourseReference): number | undefined {
  if (typeof reference === "number") {
    assertPositive(reference, "course ID");
    return reference;
  }

  const value = reference.trim();
  if (!value) {
    throw new EdInputError("Course ID or code must not be empty");
  }
  if (!/^\d+$/.test(value)) {
    return undefined;
  }

  const id = Number(value);
  assertPositive(id, "course ID");
  return id;
}

export interface LessonReadResult {
  completedSlides: number;
  error?: string;
  id: number;
  partial?: boolean;
  slideCount: number;
  status: string;
  success: boolean;
  title: string;
  viewedSlides: number;
}

export async function readLessons(
  client: EdClient,
  courseId: CourseReference,
  queries: string[],
  options: { all?: boolean; delaySeconds?: number } = {}
): Promise<LessonReadResult[]> {
  const delaySeconds = options.delaySeconds ?? 0;
  if (delaySeconds < 0) {
    throw new EdInputError("--delay must be greater than or equal to 0");
  }
  const normalizedQueries = queries.map((query) => query.trim().toLowerCase()).filter(Boolean);
  if (normalizedQueries.length === 0 && !options.all) {
    throw new EdInputError(
      "Give at least one query, or ask for all lessons, to mark lessons as read."
    );
  }
  const lessons = (await listLessons(client, courseId))
    .filter((lesson) => matchesLessonQueries(lesson, normalizedQueries));

  const results: LessonReadResult[] = [];
  for (const lesson of lessons) {
    results.push(await readLesson(client, lesson, delaySeconds));
  }
  return results;
}

async function readLesson(client: EdClient, lesson: Lesson, delaySeconds: number): Promise<LessonReadResult> {
  let current = lesson;
  let completedSlides = 0;
  let viewedSlides = 0;
  try {
    current = await client.fetchLesson(lesson.id, { view: true });
    for (const slide of current.slides) {
      if (slide.type.toLowerCase() === "quiz") {
        await client.fetchSlide(slide.id, { view: true });
        viewedSlides += 1;
      } else {
        await client.completeSlide(slide.id);
        completedSlides += 1;
      }
      if (delaySeconds > 0) {
        await delay(delaySeconds * 1000);
      }
    }
    current = await client.fetchLesson(lesson.id);
    return lessonReadResult(current, completedSlides, viewedSlides, true);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...lessonReadResult(current, completedSlides, viewedSlides, false),
      error: message,
      ...(completedSlides > 0 || viewedSlides > 0 ? { partial: true } : {}),
    };
  }
}

function lessonReadResult(
  lesson: Lesson,
  completedSlides: number,
  viewedSlides: number,
  success: boolean
): LessonReadResult {
  return {
    completedSlides,
    id: lesson.id,
    slideCount: lesson.slideCount || lesson.slides.length,
    status: lesson.status,
    success,
    title: lesson.title,
    viewedSlides,
  };
}

function assertPositive(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new EdInputError(`${label} must be greater than 0`);
  }
}

function assertNonNegative(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new EdInputError(`${label} must be greater than or equal to 0`);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function matchesLessonQueries(lesson: Lesson, normalizedQueries: string[]): boolean {
  const haystack = `${lesson.title} ${lesson.moduleName}`.toLowerCase();
  return normalizedQueries.every((query) => haystack.includes(query));
}

/**
 * List the signed-in user's own grades for a unit's submission lessons that match every
 * query. Read-only: it never starts, saves, or submits an attempt.
 */
export async function listGrades(
  client: EdClient,
  courseId: CourseReference,
  queries: string[]
): Promise<Grade[]> {
  const normalizedQueries = queries.map((query) => query.trim().toLowerCase()).filter(Boolean);
  // Only "attempt" lessons take submissions; content lessons would cost two empty requests each.
  const lessons = (await listLessons(client, courseId))
    .filter((lesson) => lesson.kind === "attempt" && matchesLessonQueries(lesson, normalizedQueries));
  if (lessons.length === 0) return [];

  const { user } = await client.fetchUser();
  return mapInOrder(lessons, GRADE_CONCURRENCY, async (lesson): Promise<Grade> => {
    const empty = { grade: null, lessonId: lesson.id, max: null, submittedAt: "", title: lesson.title };
    // The lesson list already carries the user's own submission time, so a lesson they never
    // submitted needs no request. Submitted ones still do: only the attempts carry mark_override,
    // and the list's latest attempt may not be the final submission after a lesson is reopened.
    if (!lesson.submittedAt) return { ...empty, status: "not_submitted" };
    try {
      return { ...empty, ...await getGrade(client, lesson.id, user.id) };
    } catch (error) {
      // A rejected token or a lost connection fails every lesson, so stop instead.
      if (error instanceof EdAuthExpiredError || (error instanceof EdApiError && error.kind === "network")) {
        throw error;
      }
      return { ...empty, error: error instanceof Error ? error.message : String(error), status: "unavailable" };
    }
  });
}

/** How many lessons `listGrades` asks Ed about at once. */
export const GRADE_CONCURRENCY = 3;

/**
 * Map `items` with at most `limit` calls in flight, keeping the input order. The first rejection
 * rejects the whole map and no further items are started.
 */
async function mapInOrder<T, R>(items: T[], limit: number, map: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  let failed = false;
  const worker = async (): Promise<void> => {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        results[index] = await map(items[index] as T);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function getGrade(
  client: EdClient,
  lessonId: number,
  userId: number
): Promise<Pick<Grade, "status"> & Partial<Grade>> {
  const { attempts, finalId } = await client.fetchLessonAttempts(lessonId, userId);
  if (finalId === null) return { status: "not_submitted" };

  const final = attempts.find((attempt) => attempt.id === finalId);
  if (!final || final.userId !== userId) {
    throw new Error(`Ed returned a final submission for lesson ${lessonId} that does not belong to you.`);
  }
  const submittedAt = final.submittedAt;

  let marking;
  try {
    marking = await client.fetchLessonMarkingStatus(lessonId, finalId);
  } catch (error) {
    // Ed answers 403 results_unreleased until staff release marks for the lesson.
    if (error instanceof EdApiError && error.code === "results_unreleased") {
      return { status: "unreleased", submittedAt };
    }
    throw error;
  }
  if (marking.userId !== userId) {
    throw new Error(`Ed returned a result for lesson ${lessonId} that does not belong to you.`);
  }
  // Ed's web client shows the attempt's override in place of the calculated mark.
  const grade = final.markOverride ?? marking.mark;
  if (grade === null || (final.markOverride === null && marking.unmarkedUserIds.includes(userId))) {
    return { status: "ungraded", submittedAt };
  }
  const max = marking.slideTotals.reduce((sum, total) => sum + total, 0);
  return { grade, max: max > 0 ? max : null, status: "graded", submittedAt };
}
