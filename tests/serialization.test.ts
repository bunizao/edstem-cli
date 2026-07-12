import { describe, expect, it } from "vitest";

import { serializeLesson, serializeThread } from "../src/ed/serialization.js";
import type { Lesson, Thread } from "../src/ed/models.js";

describe("serialization", () => {
  it("omits empty optional lesson fields", () => {
    const lesson: Lesson = {
      id: 1,
      courseId: 2,
      moduleId: 3,
      moduleName: "",
      number: 0,
      title: "Week 1",
      type: "lesson",
      kind: "",
      state: "",
      status: "open",
      outline: "",
      slideCount: 0,
      slides: [],
      openable: true,
      openableWithoutAttempt: false,
      isHidden: false,
      isUnlisted: false,
      isTimed: false,
      availableAt: "",
      dueAt: "",
      lockedAt: "",
      solutionsAt: "",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: ""
    };

    expect(serializeLesson(lesson)).toEqual({
      id: 1,
      courseId: 2,
      moduleId: 3,
      title: "Week 1",
      type: "lesson",
      kind: "",
      state: "",
      status: "open",
      slideCount: 0,
      openable: true,
      createdAt: "2026-01-01T00:00:00Z"
    });
  });

  it("serializes thread metrics and author", () => {
    const thread: Thread = {
      id: 1,
      number: 10,
      title: "Need help",
      content: "content",
      document: "",
      type: "question",
      category: "HW1",
      subcategory: "",
      subsubcategory: "",
      metrics: {
        voteCount: 4,
        viewCount: 20,
        uniqueViewCount: 18,
        replyCount: 3,
        unresolvedCount: 0,
        starCount: 2,
        flagCount: 0
      },
      answers: [],
      comments: [],
      userId: 9,
      courseId: 7,
      isPinned: false,
      isPrivate: false,
      isEndorsed: false,
      isAnswered: true,
      isAnonymous: false,
      isLocked: false,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-02T00:00:00Z",
      author: {
        id: 9,
        name: "Ada",
        email: "ada@example.com",
        role: "student",
        courseRole: "student",
        avatar: "https://example.com/avatar.png"
      }
    };

    expect(serializeThread(thread)).toMatchObject({
      id: 1,
      metrics: {
        voteCount: 4,
        viewCount: 20,
        replyCount: 3,
        starCount: 2
      },
      author: {
        id: 9,
        name: "Ada"
      }
    });
  });
});
