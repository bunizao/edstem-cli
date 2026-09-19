import type { Thread } from "../../src/ed/models.js";

export function makeThread(overrides: Partial<Thread> = {}): Thread {
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
      flagCount: 0,
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
    ...overrides,
  };
}
