import { describe, expect, it, vi } from "vitest";

import { EdApiError, EdAuthExpiredError, type EdClient } from "../src/ed/client.js";
import type { Lesson, Thread } from "../src/ed/models.js";
import { GRADE_CONCURRENCY, listGrades, listLessons, listThreads, resolveCourseId } from "../src/ed/operations.js";
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
    submittedAt: "",
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

describe("listGrades", () => {
  const attempt = { id: 32, lessonId: 7001, markOverride: null, submittedAt: "2026-03-02T10:00:00+11:00", userId: 12345 };
  const submittedAt = "2026-03-02T10:00:00+11:00";
  const assignment = makeLesson({ id: 7001, kind: "attempt", moduleName: "Assessments", submittedAt, title: "Assignment 1" });

  function makeGradeClient(
    overrides: Partial<Record<keyof EdClient, unknown>> = {},
    lessons: Lesson[] = [assignment]
  ): EdClient {
    return {
      fetchUser: vi.fn().mockResolvedValue({
        courses: [{ id: 100, code: "CS101", name: "Systems", session: "Semester 1", status: "active", year: "2026" }],
        user: { id: 12345 },
      }),
      fetchLessons: vi.fn().mockResolvedValue({ lessons, modules: [] }),
      fetchLessonAttempts: vi.fn().mockResolvedValue({ attempts: [attempt], finalId: 32 }),
      fetchLessonMarkingStatus: vi.fn().mockResolvedValue({
        mark: 7.5,
        slideTotals: [4, 6],
        unmarkedUserIds: [999],
        userId: 12345,
      }),
      ...overrides,
    } as unknown as EdClient;
  }

  it("reports a released grade against the lesson's total", async () => {
    const client = makeGradeClient();

    await expect(listGrades(client, "CS101", [])).resolves.toEqual([{
      grade: 7.5,
      lessonId: 7001,
      max: 10,
      status: "graded",
      submittedAt: "2026-03-02T10:00:00+11:00",
      title: "Assignment 1",
    }]);
    expect(client.fetchLessons).toHaveBeenCalledWith(100);
    expect(client.fetchLessonAttempts).toHaveBeenCalledWith(7001, 12345);
    expect(client.fetchLessonMarkingStatus).toHaveBeenCalledWith(7001, 32);
  });

  it("only asks Ed about submission lessons that match every query", async () => {
    const client = makeGradeClient({}, [
      assignment,
      makeLesson({ id: 7002, kind: "attempt", moduleName: "Assessments", submittedAt, title: "Assignment 2" }),
      makeLesson({ id: 7003, kind: "content", moduleName: "Week 1", title: "Assignment 1 walkthrough" }),
    ]);

    const grades = await listGrades(client, 100, ["assessments", "1"]);

    expect(grades.map((grade) => grade.lessonId)).toEqual([7001]);
    expect(client.fetchLessonAttempts).toHaveBeenCalledOnce();
  });

  it("stops at a lesson without a final submission", async () => {
    const client = makeGradeClient({
      fetchLessonAttempts: vi.fn().mockResolvedValue({ attempts: [], finalId: null }),
    });

    await expect(listGrades(client, 100, [])).resolves.toEqual([{
      grade: null,
      lessonId: 7001,
      max: null,
      status: "not_submitted",
      submittedAt: "",
      title: "Assignment 1",
    }]);
    expect(client.fetchLessonMarkingStatus).not.toHaveBeenCalled();
  });

  it("reports results Ed has not released", async () => {
    const client = makeGradeClient({
      fetchLessonMarkingStatus: vi.fn().mockRejectedValue(
        new EdApiError("api", 403, "Results are not released", "results_unreleased")
      ),
    });

    await expect(listGrades(client, 100, [])).resolves.toEqual([
      expect.objectContaining({ grade: null, status: "unreleased", submittedAt: attempt.submittedAt }),
    ]);
  });

  it("withholds a grade while the user is still ungraded", async () => {
    const client = makeGradeClient({
      fetchLessonMarkingStatus: vi.fn().mockResolvedValue({
        mark: 0,
        slideTotals: [4, 6],
        unmarkedUserIds: [12345],
        userId: 12345,
      }),
    });

    await expect(listGrades(client, 100, [])).resolves.toEqual([
      expect.objectContaining({ grade: null, max: null, status: "ungraded" }),
    ]);
  });

  it("treats a missing mark as ungraded", async () => {
    const client = makeGradeClient({
      fetchLessonMarkingStatus: vi.fn().mockResolvedValue({
        mark: null,
        slideTotals: [10],
        unmarkedUserIds: [],
        userId: 12345,
      }),
    });

    await expect(listGrades(client, 100, [])).resolves.toEqual([
      expect.objectContaining({ grade: null, status: "ungraded" }),
    ]);
  });

  it("omits the maximum when Ed's totals are unknown", async () => {
    const client = makeGradeClient({
      fetchLessonMarkingStatus: vi.fn().mockResolvedValue({
        mark: 7.5,
        slideTotals: [],
        unmarkedUserIds: [],
        userId: 12345,
      }),
    });

    await expect(listGrades(client, 100, [])).resolves.toEqual([
      expect.objectContaining({ grade: 7.5, max: null, status: "graded" }),
    ]);
  });

  it("reports a staff override, including zero, in place of the calculated mark", async () => {
    for (const markOverride of [9, 0]) {
      const client = makeGradeClient({
        fetchLessonAttempts: vi.fn().mockResolvedValue({ attempts: [{ ...attempt, markOverride }], finalId: 32 }),
      });

      await expect(listGrades(client, 100, [])).resolves.toEqual([
        expect.objectContaining({ grade: markOverride, max: 10, status: "graded" }),
      ]);
    }
  });

  it("reports an override even when Ed has no calculated mark", async () => {
    const client = makeGradeClient({
      fetchLessonAttempts: vi.fn().mockResolvedValue({ attempts: [{ ...attempt, markOverride: 9 }], finalId: 32 }),
      fetchLessonMarkingStatus: vi.fn().mockResolvedValue({
        mark: null,
        slideTotals: [10],
        unmarkedUserIds: [12345],
        userId: 12345,
      }),
    });

    await expect(listGrades(client, 100, [])).resolves.toEqual([
      expect.objectContaining({ grade: 9, status: "graded" }),
    ]);
  });

  it("keeps an override hidden until results are released", async () => {
    const client = makeGradeClient({
      fetchLessonAttempts: vi.fn().mockResolvedValue({ attempts: [{ ...attempt, markOverride: 9 }], finalId: 32 }),
      fetchLessonMarkingStatus: vi.fn().mockRejectedValue(
        new EdApiError("api", 403, "Results are not released", "results_unreleased")
      ),
    });

    await expect(listGrades(client, 100, [])).resolves.toEqual([
      expect.objectContaining({ grade: null, status: "unreleased" }),
    ]);
  });

  it("reports one failing lesson as unavailable and keeps going", async () => {
    const client = makeGradeClient({
      fetchLessonAttempts: vi.fn()
        .mockRejectedValueOnce(new EdApiError("api", 403, "Ed API error (HTTP 403): Forbidden", "forbidden"))
        .mockResolvedValueOnce({ attempts: [{ ...attempt, id: 33, lessonId: 7002 }], finalId: 33 }),
    }, [assignment, makeLesson({ id: 7002, kind: "attempt", submittedAt, title: "Assignment 2" })]);

    await expect(listGrades(client, 100, [])).resolves.toEqual([
      {
        error: "Ed API error (HTTP 403): Forbidden",
        grade: null,
        lessonId: 7001,
        max: null,
        status: "unavailable",
        submittedAt: "",
        title: "Assignment 1",
      },
      expect.objectContaining({ lessonId: 7002, status: "graded" }),
    ]);
  });

  it("fails the whole listing when the token is rejected", async () => {
    const client = makeGradeClient({
      fetchLessonAttempts: vi.fn().mockRejectedValue(new EdAuthExpiredError(401, "Authentication failed")),
    });

    await expect(listGrades(client, 100, [])).rejects.toBeInstanceOf(EdAuthExpiredError);
  });

  it("fails the whole listing when Ed cannot be reached", async () => {
    const client = makeGradeClient({
      fetchLessonAttempts: vi.fn().mockRejectedValue(new EdApiError("network", 0, "Could not reach Ed")),
    });

    await expect(listGrades(client, 100, [])).rejects.toThrow("Could not reach Ed");
  });

  it("goes straight to not_submitted for a lesson the lesson list says you never submitted", async () => {
    const client = makeGradeClient({}, [
      makeLesson({ id: 7002, kind: "attempt", moduleName: "Assessments", title: "Quiz 1" }),
    ]);

    await expect(listGrades(client, 100, [])).resolves.toEqual([{
      grade: null,
      lessonId: 7002,
      max: null,
      status: "not_submitted",
      submittedAt: "",
      title: "Quiz 1",
    }]);
    expect(client.fetchLessonAttempts).not.toHaveBeenCalled();
    expect(client.fetchLessonMarkingStatus).not.toHaveBeenCalled();
  });

  it("asks Ed about a few lessons at once and keeps the unit's order", async () => {
    const lessons = [1, 2, 3, 4, 5, 6].map((n) =>
      makeLesson({ id: 7000 + n, kind: "attempt", moduleName: "Assessments", submittedAt, title: `Quiz ${n}` })
    );
    let inFlight = 0;
    let most = 0;
    const fetchLessonAttempts = vi.fn(async (lessonId: number) => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      // Later lessons answer first, so order can only come from the lesson list.
      await new Promise((resolve) => setTimeout(resolve, (7010 - lessonId) * 2));
      inFlight -= 1;
      return { attempts: [{ ...attempt, id: lessonId, lessonId }], finalId: lessonId };
    });
    const client = makeGradeClient({ fetchLessonAttempts }, lessons);

    const grades = await listGrades(client, 100, []);

    expect(grades.map((grade) => grade.lessonId)).toEqual([7001, 7002, 7003, 7004, 7005, 7006]);
    expect(most).toBeGreaterThan(1);
    expect(most).toBeLessThanOrEqual(GRADE_CONCURRENCY);
  });

  it("never reports a submission or result that belongs to someone else", async () => {
    const foreignAttempt = makeGradeClient({
      fetchLessonAttempts: vi.fn().mockResolvedValue({ attempts: [{ ...attempt, userId: 999 }], finalId: 32 }),
    });
    const foreignResult = makeGradeClient({
      fetchLessonMarkingStatus: vi.fn().mockResolvedValue({
        mark: 7.5,
        slideTotals: [10],
        unmarkedUserIds: [],
        userId: 999,
      }),
    });

    for (const client of [foreignAttempt, foreignResult]) {
      const [grade] = await listGrades(client, 100, []);
      expect(grade).toMatchObject({ grade: null, status: "unavailable" });
      expect(grade?.error).toMatch(/does not belong to you/);
    }
  });
});
