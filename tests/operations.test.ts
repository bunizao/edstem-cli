import { describe, expect, it, vi } from "vitest";

import type { EdClient } from "../src/ed/client.js";
import type { Lesson } from "../src/ed/models.js";
import { listLessons } from "../src/ed/operations.js";

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
