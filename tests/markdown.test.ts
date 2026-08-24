import { describe, expect, it } from "vitest";

import { lessonToMarkdown, threadToMarkdown } from "../src/markdown.js";
import type { Comment, Lesson, LessonSlide, Thread, User } from "../src/ed/models.js";

const staff: User = {
  avatar: "",
  courseRole: "admin",
  email: "",
  id: 7,
  name: "Jordan",
  role: "",
};

describe("Markdown export", () => {
  it("renders a thread post and nested replies", () => {
    const answer = comment({
      author: staff,
      createdAt: "2026-01-15T11:00:00Z",
      document: "Use brew install python3",
      id: 9001,
      isEndorsed: true,
      type: "answer",
      userId: staff.id,
      voteCount: 2,
    });
    const reply = comment({ document: "Thanks, that worked.", id: 9002, isAnonymous: true, userId: 5 });
    const discussion = comment({ comments: [reply], document: "Same issue here.", id: 9003, userId: 6 });
    const value = thread({
      answers: [answer],
      author: staff,
      comments: [discussion],
      document: "How do I install Python on macOS?",
      isAnswered: true,
      number: 9,
      title: "Install Python",
      userId: staff.id,
    });

    const output = threadToMarkdown(value);

    expect(output).toContain("# #9 Install Python");
    expect(output).toContain("- **Author:** Jordan");
    expect(output).toContain("- **Flags:** answered");
    expect(output).toContain("- **Jordan** [staff, endorsed, +2] - 2026-01-15T11:00:00Z");
    expect(output).toContain("  - **Anonymous** [anonymous]");
  });

  it("renders lesson structure, links, files, and lists", () => {
    const value = lesson({
      moduleName: "Module A",
      outline: "<document><paragraph>Read before class</paragraph><list style=\"bullet\"><list-item><paragraph>Bring laptop</paragraph></list-item></list></document>",
      slides: [slide({
        content: "<document><heading level=\"2\">Checklist</heading><paragraph>Read the <link href=\"https://example.com/spec\">spec</link></paragraph><file filename=\"starter.zip\" url=\"https://example.com/starter.zip\"/></document>",
        index: 2,
        title: "Structured slide",
      })],
    });

    const output = lessonToMarkdown(value);

    expect(output).toContain("- Bring laptop");
    expect(output).toContain("#### Checklist");
    expect(output).toContain("[spec](https://example.com/spec)");
    expect(output).toContain("File: [starter.zip](https://example.com/starter.zip)");
  });

  it("preserves literal angle brackets and malformed XML", () => {
    expect(lessonToMarkdown(lesson({ slides: [slide({ content: "Use x < y and Array<T>.", index: 2 })] })))
      .toContain("Use x < y and Array<T>.");
    const malformed = "<document><paragraph>Use x < y before fixing parser";
    expect(lessonToMarkdown(lesson({ slides: [slide({ content: malformed, index: 2 })] })))
      .toContain(malformed);
  });
});

function comment(overrides: Partial<Comment> = {}): Comment {
  return {
    author: null,
    comments: [],
    content: "",
    createdAt: "",
    document: "",
    id: 1,
    isAnonymous: false,
    isEndorsed: false,
    isResolved: false,
    type: "comment",
    userId: 0,
    voteCount: 0,
    ...overrides,
  };
}

function slide(overrides: Partial<LessonSlide> = {}): LessonSlide {
  return {
    content: "Hello lesson",
    courseId: 100,
    fileUrl: "",
    id: 10,
    index: 1,
    isHidden: false,
    lessonId: 7001,
    status: "completed",
    title: "Slide 1",
    type: "document",
    ...overrides,
  };
}

function lesson(overrides: Partial<Lesson> = {}): Lesson {
  return {
    availableAt: "",
    courseId: 100,
    createdAt: "",
    dueAt: "",
    id: 7001,
    isHidden: false,
    isTimed: false,
    isUnlisted: false,
    kind: "",
    lockedAt: "",
    moduleId: 1,
    moduleName: "",
    number: 1,
    openable: true,
    openableWithoutAttempt: false,
    outline: "",
    slideCount: 1,
    slides: [slide()],
    solutionsAt: "",
    state: "",
    status: "open",
    title: "Week 1",
    type: "lesson",
    updatedAt: "",
    ...overrides,
  };
}

function thread(overrides: Partial<Thread> = {}): Thread {
  return {
    answers: [],
    author: null,
    category: "General",
    comments: [],
    content: "",
    courseId: 100,
    createdAt: "",
    document: "",
    id: 5001,
    isAnonymous: false,
    isAnswered: false,
    isEndorsed: false,
    isLocked: false,
    isPinned: false,
    isPrivate: false,
    metrics: {
      flagCount: 0,
      replyCount: 0,
      starCount: 0,
      uniqueViewCount: 0,
      unresolvedCount: 0,
      viewCount: 0,
      voteCount: 0,
    },
    number: 1,
    subcategory: "",
    subsubcategory: "",
    title: "Thread",
    type: "question",
    updatedAt: "",
    userId: 0,
    ...overrides,
  };
}
