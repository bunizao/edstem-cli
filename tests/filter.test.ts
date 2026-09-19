import { describe, expect, it } from "vitest";

import { filterThreads, hasThreadFilters, parseSince } from "../src/ed/filter.js";
import { makeThread } from "./support/threads.js";

describe("filterThreads", () => {
  it("filters by category, subcategory, type, and answered status", () => {
    const threads = [
      makeThread({ id: 1, category: "General", subcategory: "News", type: "question", isAnswered: false }),
      makeThread({ id: 2, category: "HW1", subcategory: "MiniTests", type: "post", isAnswered: true }),
      makeThread({ id: 3, category: "General", subcategory: "MiniTests", type: "question", isAnswered: true })
    ];

    const result = filterThreads(threads, {
      answered: true,
      category: " general ",
      subcategory: " minitests ",
      threadType: " question "
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(3);
  });

  it("matches every query word across the title and the plain-text body", () => {
    const threads = [
      makeThread({ id: 1, title: "Assignment 2 deadline", document: "Is the deadline extended?" }),
      makeThread({ id: 2, title: "Deadline", document: "Assignment 2 hand-in is on Friday." }),
      makeThread({ id: 3, title: "Assignment 2", document: "Which compiler should I use?" })
    ];

    const result = filterThreads(threads, { query: "  Assignment   DEADLINE " });

    expect(result.map((thread) => thread.id)).toEqual([1, 2]);
  });

  it("keeps threads created at or after the since cutoff", () => {
    const threads = [
      makeThread({ id: 1, createdAt: "2026-09-10T00:00:00Z" }),
      makeThread({ id: 2, createdAt: "2026-09-01T00:00:00Z" }),
      makeThread({ id: 3, createdAt: "2026-08-20T00:00:00Z" }),
      makeThread({ id: 4, createdAt: "" })
    ];

    const result = filterThreads(threads, { since: new Date("2026-09-01T00:00:00Z") });

    expect(result.map((thread) => thread.id)).toEqual([1, 2]);
  });
});

describe("hasThreadFilters", () => {
  it("ignores blank filter values", () => {
    expect(hasThreadFilters({ category: "  ", query: "  " })).toBe(false);
    expect(hasThreadFilters({ answered: false })).toBe(true);
    expect(hasThreadFilters({ since: new Date() })).toBe(true);
  });
});

describe("parseSince", () => {
  const now = new Date("2026-09-19T12:00:00Z");

  it("parses ISO dates and datetimes", () => {
    expect(parseSince("2026-09-01", now).toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(parseSince("2026-09-01T10:00:00Z", now).toISOString()).toBe("2026-09-01T10:00:00.000Z");
  });

  it("parses relative day, hour, and week offsets", () => {
    expect(parseSince("7d", now).toISOString()).toBe("2026-09-12T12:00:00.000Z");
    expect(parseSince("12h", now).toISOString()).toBe("2026-09-19T00:00:00.000Z");
    expect(parseSince("2W", now).toISOString()).toBe("2026-09-05T12:00:00.000Z");
  });

  it("rejects values that are neither a timestamp nor an offset", () => {
    expect(() => parseSince("last tuesday", now)).toThrow('Invalid time value "last tuesday"');
    expect(() => parseSince("7y", now)).toThrow("relative offset such as 7d");
  });
});
