import { CliError } from "../errors.js";
import type { EdClient } from "./client.js";
import { filterThreads } from "./filter.js";
import type { Lesson, Thread } from "./models.js";

export interface ThreadListOptions {
  answered?: boolean;
  category?: string;
  courseId: number;
  limit: number;
  sort: string;
  threadType?: string;
}

export async function listThreads(client: EdClient, options: ThreadListOptions): Promise<Thread[]> {
  assertPositive(options.courseId, "course ID");
  assertPositive(options.limit, "--max");
  const threads = await client.fetchThreads(options.courseId, {
    limit: Math.min(options.limit, 100),
    sort: options.sort,
  });
  return filterThreads(threads, options);
}

export async function resolveThread(client: EdClient, reference: string): Promise<Thread> {
  const match = /^(\d+)(?:#(\d+))?$/.exec(reference.trim());
  if (!match) {
    throw new CliError("usage", "Thread reference must be a thread ID or course_id#number");
  }
  const id = Number(match[1]);
  const number = match[2] ? Number(match[2]) : undefined;
  return number === undefined
    ? client.fetchThread(id)
    : client.fetchCourseThread(id, number);
}

export interface LessonListOptions {
  lessonType?: string;
  module?: string;
  state?: string;
  status?: string;
}

export async function listLessons(
  client: EdClient,
  courseId: number,
  options: LessonListOptions = {}
): Promise<Lesson[]> {
  assertPositive(courseId, "course ID");
  const { lessons } = await client.fetchLessons(courseId);
  const moduleQuery = options.module?.toLowerCase();
  return lessons.filter((lesson) => {
    if (moduleQuery && String(lesson.moduleId) !== moduleQuery && lesson.moduleName.toLowerCase() !== moduleQuery) {
      return false;
    }
    if (options.lessonType && lesson.type.toLowerCase() !== options.lessonType.toLowerCase()) {
      return false;
    }
    if (options.state && lesson.state.toLowerCase() !== options.state.toLowerCase()) {
      return false;
    }
    return !options.status || lesson.status.toLowerCase() === options.status.toLowerCase();
  });
}

export async function listCurrentActivity(
  client: EdClient,
  options: { courseId?: number; filterType?: string; limit: number }
): Promise<unknown[]> {
  assertPositive(options.limit, "--max");
  const { user } = await client.fetchUser();
  return client.fetchUserActivity(user.id, options);
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
  courseId: number,
  queries: string[],
  delaySeconds = 0
): Promise<LessonReadResult[]> {
  if (delaySeconds < 0) {
    throw new CliError("usage", "--delay must be greater than or equal to 0");
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
    throw new CliError("usage", `${label} must be greater than 0`);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
