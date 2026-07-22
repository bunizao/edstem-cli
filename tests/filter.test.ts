import { describe, expect, it } from "vitest";

import { filterThreads } from "../src/ed/filter.js";
import type { Thread } from "../src/ed/models.js";

function makeThread(overrides: Partial<Thread>): Thread {
  return {
    id: 1,
    number: 1,
    title: "Thread",
    content: "",
    document: "",
    type: "question",
    category: "General",
    subcategory: "",
    subsubcategory: "",
    metrics: {
      voteCount: 0,
      viewCount: 0,
      uniqueViewCount: 0,
      replyCount: 0,
      unresolvedCount: 0,
      starCount: 0,
      flagCount: 0
    },
    answers: [],
    comments: [],
    userId: 0,
    courseId: 1,
    isPinned: false,
    isPrivate: false,
    isEndorsed: false,
    isAnswered: false,
    isAnonymous: false,
    isLocked: false,
    createdAt: "",
    updatedAt: "",
    author: null,
    ...overrides
  };
}

describe("filterThreads", () => {
  it("filters by category, type, and answered status", () => {
    const threads = [
      makeThread({ id: 1, category: "General", type: "question", isAnswered: false }),
      makeThread({ id: 2, category: "HW1", type: "post", isAnswered: true }),
      makeThread({ id: 3, category: "General", type: "question", isAnswered: true })
    ];

    const result = filterThreads(threads, {
      answered: true,
      category: "general",
      threadType: "question"
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(3);
  });
});
