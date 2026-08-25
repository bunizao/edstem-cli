import { describe, expect, it, vi } from "vitest";

import type { EdClient } from "../src/ed/client.js";
import type { Lesson } from "../src/ed/models.js";
import { listLessons, resolveCourseId } from "../src/ed/operations.js";

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

describe("resolveCourseId", () => {
  function makeCourseClient(): EdClient {
    return {
      fetchUser: vi.fn().mockResolvedValue({
        courses: [
          { id: 100, code: "CS101", session: "Semester 1", status: "active", year: "2026" },
          { id: 200, code: "MATH201", session: "Semester 2", status: "archived", year: "2025" },
        ],
        user: {},
      }),
    } as unknown as EdClient;
  }

  it("resolves course codes case-insensitively", async () => {
    await expect(resolveCourseId(makeCourseClient(), "cs101")).resolves.toBe(100);
  });

  it("reports the available codes when resolution fails", async () => {
    await expect(resolveCourseId(makeCourseClient(), "FIT2014")).rejects.toThrow(
      'Unknown course code "FIT2014". Available course codes: CS101, MATH201.'
    );
  });

  it("rejects ambiguous course codes with identifying details", async () => {
    const client = makeCourseClient();
    vi.mocked(client.fetchUser).mockResolvedValue({
      courses: [
        { id: 100, code: "CS101", session: "Semester 1", status: "active", year: "2026" },
        { id: 101, code: "CS101", session: "Semester 1", status: "archived", year: "2025" },
      ],
      user: {},
    } as never);

    await expect(resolveCourseId(client, "CS101")).rejects.toThrow(
      'Course code "CS101" is ambiguous. Matching courses: ' +
      "100 (2026, Semester 1, active), 101 (2025, Semester 1, archived). " +
      "Use a numeric course ID."
    );
  });
});
