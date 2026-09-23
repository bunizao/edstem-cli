import type { EdClient } from "../ed/client.js";
import type { Course, Lesson, Thread } from "../ed/models.js";
import { EdInputError, resolveCourse, type CourseReference } from "../ed/operations.js";

/**
 * Payloads for the MCP Apps widget. Each builder returns what the widget renders
 * (structuredContent) plus a short text for the model and for hosts without
 * MCP Apps. Interpretation stays with the model; these only shape Ed data.
 */

const DAY_MS = 86_400_000;
const EXCERPT_LENGTH = 180;
const PAGE_SIZE = 100;
/** Hard cap on Ed requests for one widget (1000 threads). */
const THREAD_PAGE_CAP = 10;

export interface WidgetResult {
  structuredContent: Record<string, unknown>;
  text: string;
}

export async function buildForumCatchup(
  client: EdClient,
  courseReference: CourseReference,
  days: number
): Promise<WidgetResult> {
  const course = await resolveCourse(client, courseReference);
  const since = Date.now() - days * DAY_MS;
  const inWindow = (await fetchThreadsSince(client, course.id, since))
    .filter((thread) => Date.parse(thread.createdAt) >= since);

  const announcements = inWindow
    .filter(isAnnouncement)
    .map((thread) => ({
      createdAt: thread.createdAt,
      id: thread.id,
      number: thread.number,
      seen: thread.isSeen,
      title: thread.title,
    }));
  const threads = inWindow
    .filter((thread) => !isAnnouncement(thread))
    .map((thread) => ({
      answered: thread.isAnswered,
      category: thread.category,
      createdAt: thread.createdAt,
      excerpt: excerpt(thread.document),
      id: thread.id,
      newReplies: thread.metrics.newReplyCount,
      number: thread.number,
      replies: thread.metrics.replyCount,
      seen: thread.isSeen,
      sub: thread.subcategory,
      title: thread.title,
      type: thread.type,
    }));

  const label = courseLabel(course);
  const unreadAnnouncements = announcements.filter((item) => !item.seen);
  const fresh = threads.filter((thread) => !thread.seen || thread.newReplies > 0);
  const lines = [
    `${label}: ${fresh.length} of ${threads.length} threads from the last ${days} days are new or have new replies; ` +
      `${unreadAnnouncements.length} unread announcements.`,
    ...unreadAnnouncements.map((item) => `- announcement #${item.number} ${item.title}`),
    ...fresh.map((thread) =>
      `- #${thread.number} ${thread.title} (${thread.seen ? `+${thread.newReplies} replies` : "new"}` +
      `${thread.type === "question" && !thread.answered ? ", unanswered" : ""})`
    ),
  ];
  return {
    structuredContent: { announcements, course: label, courseId: course.id, days, kind: "forum_catchup", threads },
    text: lines.join("\n"),
  };
}

export async function buildThreadActivity(
  client: EdClient,
  courseReference: CourseReference,
  weeks: number
): Promise<WidgetResult> {
  const course = await resolveCourse(client, courseReference);
  const since = Date.now() - weeks * 7 * DAY_MS;
  // Announcements and pinned threads are staff broadcasts, not what students ask about.
  const rows = (await fetchThreadsSince(client, course.id, since))
    .filter((thread) => Date.parse(thread.createdAt) >= since && !isAnnouncement(thread) && !thread.isPinned)
    .map((thread) => ({
      category: thread.category,
      createdAt: thread.createdAt,
      number: thread.number,
      replies: thread.metrics.replyCount,
      sub: thread.subcategory,
      title: thread.title,
    }));

  const label = courseLabel(course);
  // The widget buckets by the viewer's own week; the model gets UTC weeks, which is close enough to talk about.
  const byWeek = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const week = utcMonday(row.createdAt);
    const counts = byWeek.get(week) ?? new Map<string, number>();
    counts.set(row.category, (counts.get(row.category) ?? 0) + 1);
    byWeek.set(week, counts);
  }
  const lines = [
    `${label}: ${rows.length} threads in the last ${weeks} weeks, announcements and pinned threads excluded.`,
    ...[...byWeek.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([week, counts]) =>
        `- week of ${week}: ` +
        [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => `${name || "Uncategorised"} ${count}`).join(", ")
      ),
  ];
  return {
    structuredContent: { course: label, courseId: course.id, kind: "thread_activity", threads: rows, weeks },
    text: lines.join("\n"),
  };
}

export async function buildLessonProgress(
  client: EdClient,
  courseReference: CourseReference
): Promise<WidgetResult> {
  const course = await resolveCourse(client, courseReference);
  const { lessons, modules } = await client.fetchLessons(course.id);
  const now = Date.now();

  const rows = modules
    .map((module) => {
      const inModule = lessons.filter((lesson) => lesson.moduleId === module.id && !lesson.isHidden);
      return {
        completed: inModule.filter(isCompleted).length,
        name: module.name,
        // Ed lessons have no due dates; a module counts as released once its first lesson opens.
        openedAt: earliestOpening(inModule, now),
        total: inModule.length,
        unfinished: inModule
          .filter((lesson) => !isCompleted(lesson))
          .map((lesson) => ({ id: lesson.id, status: lesson.status, title: lesson.title })),
      };
    })
    .filter((row) => row.total > 0);
  const released = rows
    .filter((row) => row.openedAt)
    .sort((left, right) => String(left.openedAt).localeCompare(String(right.openedAt)));
  const ordered = [...released, ...rows.filter((row) => !row.openedAt)];

  const label = courseLabel(course);
  const behind = released.slice(0, -1).reduce((sum, row) => sum + row.total - row.completed, 0);
  const text = ordered.length === 0
    ? `${label} has no Ed lessons; its material is probably in another system.`
    : [
      `${label}: ${behind} unfinished lessons in released modules before the latest one. ` +
        `${rows.length - released.length} modules are not released yet.`,
      ...released.map((row) =>
        `- ${row.name}: ${row.completed}/${row.total} completed` +
        (row.unfinished.length ? `; left: ${row.unfinished.map((lesson) => lesson.title).join("; ")}` : "")
      ),
    ].join("\n");
  return {
    structuredContent: { course: label, courseId: course.id, kind: "lesson_progress", modules: ordered },
    text,
  };
}

export interface GuideInput {
  lessonId: number;
  quiz: { answer: number; options: string[]; question: string; section: number; why: string }[];
  sections: { points: string[]; title: string }[];
}

/**
 * The model writes the guide and its practice questions from the lesson it read.
 * Ed's own quiz questions are never answered here: Ed marks them, so they stay the
 * student's to do, and the widget only says how many there are.
 */
export async function buildLessonGuide(client: EdClient, input: GuideInput): Promise<WidgetResult> {
  for (const [index, item] of input.quiz.entries()) {
    if (item.answer >= item.options.length) {
      throw new EdInputError(`quiz[${index}].answer must index one of its ${item.options.length} options.`);
    }
    if (item.section >= input.sections.length) {
      throw new EdInputError(`quiz[${index}].section must index one of the ${input.sections.length} sections.`);
    }
  }
  const lesson = await client.fetchLesson(input.lessonId);
  const edQuizSlides = lesson.slides.filter((slide) => slide.type.toLowerCase() === "quiz").length;
  return {
    structuredContent: {
      edQuizSlides,
      kind: "lesson_guide",
      lesson: { id: lesson.id, module: lesson.moduleName, title: lesson.title },
      quiz: input.quiz,
      sections: input.sections,
    },
    text: `Showing a ${input.sections.length}-section guide to "${lesson.title}" with ` +
      `${input.quiz.length} practice questions. The student steps through it and answers in the widget; ` +
      `wait for them to ask before explaining further.`,
  };
}

/** Pages newest-first until a page ends before the cutoff; pinned threads never end the walk. */
async function fetchThreadsSince(
  client: EdClient,
  courseId: number,
  since: number
): Promise<Thread[]> {
  const threads: Thread[] = [];
  for (let page = 0; page < THREAD_PAGE_CAP; page += 1) {
    const batch = await client.fetchThreads(courseId, { limit: PAGE_SIZE, offset: page * PAGE_SIZE, sort: "new" });
    threads.push(...batch);
    const oldest = batch.filter((thread) => !thread.isPinned).at(-1);
    if (batch.length < PAGE_SIZE || (oldest && Date.parse(oldest.createdAt) < since)) {
      break;
    }
  }
  return threads;
}

function isAnnouncement(thread: Thread): boolean {
  return thread.type.toLowerCase() === "announcement";
}

function isCompleted(lesson: Lesson): boolean {
  return lesson.status.toLowerCase() === "completed";
}

function earliestOpening(lessons: Lesson[], now: number): string | null {
  const opened = lessons
    .map((lesson) => Date.parse(lesson.availableAt))
    .filter((time) => Number.isFinite(time) && time <= now);
  return opened.length ? new Date(Math.min(...opened)).toISOString() : null;
}

function excerpt(document: string): string {
  const text = document.replace(/\s+/g, " ").trim();
  return text.length > EXCERPT_LENGTH ? `${text.slice(0, EXCERPT_LENGTH - 1).trimEnd()}…` : text;
}

/** Ed's code often carries the teaching period ("CODE 2026 S2"); the leading token is what people say. */
function courseLabel(course: Course): string {
  return course.code.trim().split(/\s+/u)[0] || course.name || String(course.id);
}

function utcMonday(iso: string): string {
  const date = new Date(iso);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}
