import { describe, expect, it, vi } from "vitest";

import type { EdClient } from "../src/ed/client.js";
import type { Lesson, Thread } from "../src/ed/models.js";
import { listLessons, listThreads, resolveCourseId } from "../src/ed/operations.js";
import { makeThread } from "./support/threads.js";

function makeLesson(overrides: Partial<Lesson>): Lesson {
  return {
    id: 1,
    courseId: 100,
    moduleId: 7,
    moduleName: "Week 1: Introduction",
    number: 1,
    title: "Lesson",
    type: "general",
    kind: "lesson",
    state: "active",
    status: "unattempted",
    outline: "",
    slideCount: 0,
    slides: [],
    openable: true,
    openableWithoutAttempt: true,
    isHidden: false,
    isUnlisted: false,
    isTimed: false,
    availableAt: "",
    dueAt: "",
    lockedAt: "",
    solutionsAt: "",
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

function makeClient(lessons: Lesson[]): EdClient {
  return {
    fetchLessons: vi.fn().mockResolvedValue({ lessons, modules: [] }),
  } as unknown as EdClient;
}

describe("listLessons", () => {
  const lessons = [
    makeLesson({ id: 1 }),
    makeLesson({
      id: 2,
      moduleId: 8,
      moduleName: "Week 5: Assessment",
      state: "scheduled",
      status: "completed",
    }),
  ];

  it("accepts module name text and all as the unfiltered value", async () => {
    const result = await listLessons(makeClient(lessons), 100, {
      lessonType: "all",
      module: "week 5",
      state: "scheduled",
      status: "all",
    });

    expect(result.map((lesson) => lesson.id)).toEqual([2]);
  });

  it("reports the available values for an unknown filter", async () => {
    await expect(listLessons(makeClient(lessons), 100, { status: "pending" }))
      .rejects.toThrow(
        'Unknown lesson status "pending". Available values: completed, unattempted. '
        + 'Use "all" or omit the filter to include every value.'
      );
  });

  it("returns an empty list for a course without Ed Lessons", async () => {
    await expect(listLessons(makeClient([]), 100, { status: "pending" })).resolves.toEqual([]);
  });
});

describe("listThreads", () => {
  function makeThreadClient(page: (index: number) => Thread[]): EdClient {
    let index = 0;
    return {
      fetchThreads: vi.fn(async () => page(index++)),
    } as unknown as EdClient;
  }

  function makePage(
    size: number,
    unanswered: number,
    createdAt = "2026-09-18T00:00:00Z",
    isPinned = false
  ): Thread[] {
    return Array.from({ length: size }, (_, position) =>
      makeThread({ id: position + 1, createdAt, isAnswered: position >= unanswered, isPinned })
    );
  }

  function offsets(client: EdClient): Array<number | undefined> {
    return vi.mocked(client.fetchThreads).mock.calls.map(([, options]) => options?.offset);
  }

  it("keeps paging until the requested number of threads match", async () => {
    const client = makeThreadClient(() => makePage(30, 1));

    const result = await listThreads(client, {
      answered: false,
      courseId: 100,
      limit: 3,
      sort: "new",
    });

    expect(result).toHaveLength(3);
    expect(client.fetchThreads).toHaveBeenCalledTimes(3);
    expect(offsets(client)).toEqual([0, 30, 60]);
  });

  it("starts the page walk at the requested offset", async () => {
    const client = makeThreadClient(() => makePage(30, 1));

    await listThreads(client, { answered: false, courseId: 100, limit: 2, offset: 10, sort: "new" });

    expect(offsets(client)).toEqual([10, 40]);
  });

  it("stops when Ed returns a page shorter than the page size", async () => {
    const client = makeThreadClient((index) => (index === 0 ? makePage(30, 0) : makePage(5, 0)));

    const result = await listThreads(client, {
      answered: false,
      courseId: 100,
      limit: 10,
      sort: "new",
    });

    expect(result).toEqual([]);
    expect(client.fetchThreads).toHaveBeenCalledTimes(2);
  });

  it("stops at the ten-page cap", async () => {
    const client = makeThreadClient(() => makePage(30, 0));

    const result = await listThreads(client, {
      courseId: 100,
      limit: 30,
      query: "nothing matches this",
      sort: "new",
    });

    expect(result).toEqual([]);
    expect(client.fetchThreads).toHaveBeenCalledTimes(10);
  });

  it("stops early when a newest-first page ends before the since cutoff", async () => {
    const client = makeThreadClient(() => makePage(30, 30, "2026-01-01T00:00:00Z"));

    const result = await listThreads(client, {
      courseId: 100,
      limit: 30,
      since: new Date("2026-09-01T00:00:00Z"),
      sort: "new",
    });

    expect(result).toEqual([]);
    expect(client.fetchThreads).toHaveBeenCalledOnce();
  });

  it("keeps paging past a page of old pinned threads", async () => {
    const client = makeThreadClient((index) => (index === 0
      ? makePage(30, 30, "2026-01-01T00:00:00Z", true)
      : makePage(30, 30, "2026-09-18T00:00:00Z")));

    const result = await listThreads(client, {
      courseId: 100,
      limit: 30,
      since: new Date("2026-09-01T00:00:00Z"),
      sort: "new",
    });

    expect(result).toHaveLength(30);
    expect(client.fetchThreads).toHaveBeenCalledTimes(2);
  });

  it("keeps paging for other sort orders because they are not time ordered", async () => {
    const client = makeThreadClient(() => makePage(30, 30, "2026-01-01T00:00:00Z"));

    await listThreads(client, {
      courseId: 100,
      limit: 30,
      since: new Date("2026-09-01T00:00:00Z"),
      sort: "top",
    });

    expect(client.fetchThreads).toHaveBeenCalledTimes(10);
  });

  it("fetches a single page when no filter is active", async () => {
    const client = makeThreadClient(() => makePage(30, 30));

    const result = await listThreads(client, { courseId: 100, limit: 5, sort: "new" });

    expect(result).toHaveLength(30);
    expect(client.fetchThreads).toHaveBeenCalledOnce();
    expect(vi.mocked(client.fetchThreads).mock.calls[0]?.[1]).toEqual({
      limit: 5,
      offset: 0,
      sort: "new",
    });
  });

  it("rejects a negative offset", async () => {
    const client = makeThreadClient(() => makePage(30, 30));

    await expect(listThreads(client, { courseId: 100, limit: 5, offset: -1, sort: "new" }))
      .rejects.toThrow("--offset must be greater than or equal to 0");
  });
});

describe("resolveCourseId", () => {
  function makeCourseClient(): EdClient {
    return {
      fetchUser: vi.fn().mockResolvedValue({
        courses: [
          { id: 100, code: "CS101", name: "Systems", session: "Semester 1", status: "active", year: "2026" },
          { id: 200, code: "MATH201", name: "Discrete structures", session: "Semester 2", status: "archived", year: "2025" },
        ],
        user: {},
      }),
    } as unknown as EdClient;
  }

  it("resolves course codes case-insensitively", async () => {
    await expect(resolveCourseId(makeCourseClient(), "cs101")).resolves.toBe(100);
  });

  it("resolves a code that the site suffixes with a teaching period", async () => {
    const client = makeCourseClient();
    vi.mocked(client.fetchUser).mockResolvedValue({
      courses: [{ id: 100, code: "CS101 2026 S1", name: "Systems", session: "Semester 1", status: "active", year: "2026" }],
      user: {},
    } as never);

    await expect(resolveCourseId(client, "CS101")).resolves.toBe(100);
  });

  it("resolves a unit by part of its name", async () => {
    await expect(resolveCourseId(makeCourseClient(), "discrete")).resolves.toBe(200);
  });

  it("reports the site's own units when nothing matches", async () => {
    await expect(resolveCourseId(makeCourseClient(), "nope")).rejects.toThrow(
      'No unit matches "nope". Your units: CS101, MATH201.'
    );
  });

  it("rejects ambiguous course codes with identifying details", async () => {
    const client = makeCourseClient();
    vi.mocked(client.fetchUser).mockResolvedValue({
      courses: [
        { id: 100, code: "CS101", name: "Systems", session: "Semester 1", status: "active", year: "2026" },
        { id: 101, code: "CS101", name: "Systems", session: "Semester 1", status: "archived", year: "2025" },
      ],
      user: {},
    } as never);

    await expect(resolveCourseId(client, "CS101")).rejects.toThrow(
      'Unit "CS101" is ambiguous. Matching units: ' +
      "100 (CS101, 2026, Semester 1, active), 101 (CS101, 2025, Semester 1, archived). " +
      "Use a unit ID."
    );
  });
});
