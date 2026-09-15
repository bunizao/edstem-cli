import type { EdClient } from "./client.js";
import { filterThreads } from "./filter.js";
import type { Course, Lesson, Thread } from "./models.js";

export type CourseReference = number | string;

export interface ThreadListOptions {
  answered?: boolean;
  category?: string;
  courseId: CourseReference;
  limit: number;
  sort: string;
  subcategory?: string;
  threadType?: string;
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
  const courseId = await resolveCourseId(client, options.courseId);
  const threads = await client.fetchThreads(courseId, {
    limit: Math.min(options.limit, 100),
    sort: options.sort,
  });
  return filterThreads(threads, options);
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
  delaySeconds = 0
): Promise<LessonReadResult[]> {
  if (delaySeconds < 0) {
    throw new EdInputError("--delay must be greater than or equal to 0");
  }
  const normalizedQueries = queries.map((query) => query.trim().toLowerCase()).filter(Boolean);
  const lessons = (await listLessons(client, courseId)).filter((lesson) => {
    const haystack = `${lesson.title} ${lesson.moduleName}`.toLowerCase();
    return normalizedQueries.every((query) => haystack.includes(query));
  });

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

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
