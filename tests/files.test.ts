import { describe, expect, it } from "vitest";

import { listLessonFiles, listThreadFiles } from "../src/ed/files.js";
import type { Comment, Lesson, LessonSlide, Thread } from "../src/ed/models.js";

describe("lesson files", () => {
  it("collects PDF slides and embedded files without duplicate URLs", () => {
    const lesson = makeLesson({
      outline: '<document><file filename="outline.zip" url="https://static.au.edusercontent.com/files/outline"/></document>',
      slides: [makeSlide({
        content: '<document><file filename="starter.zip" url="https://static.edusercontent.com/files/starter"/><file filename="duplicate.pdf" url="https://static.edusercontent.com/files/slides"/></document>',
        fileUrl: "https://static.edusercontent.com/files/slides",
        title: "Workshop Slides",
        type: "pdf",
      })],
    });

    expect(listLessonFiles(lesson)).toEqual([
      expect.objectContaining({ filename: "outline.zip", source: "content" }),
      expect.objectContaining({
        filename: "Workshop Slides.pdf",
        mediaType: "application/pdf",
        slideId: 10,
        source: "slide",
      }),
      expect.objectContaining({ filename: "starter.zip", slideId: 10, source: "content" }),
    ]);
  });

  it("preserves slide associations when files share a URL", () => {
    const url = "https://static.edusercontent.com/files/shared";
    const lesson = makeLesson({
      outline: `<document><file filename="outline.pdf" url="${url}"/></document>`,
      slides: [
        makeSlide({ fileUrl: url, id: 10 }),
        makeSlide({ fileUrl: url, id: 11, index: 2 }),
      ],
    });

    expect(listLessonFiles(lesson).map((file) => ({
      slideId: file.slideId,
      source: file.source,
    }))).toEqual([
      { slideId: undefined, source: "content" },
      { slideId: 10, source: "slide" },
      { slideId: 11, source: "slide" },
    ]);
  });

  it("ignores invalid, insecure, and external file URLs", () => {
    const lesson = makeLesson({
      slides: [makeSlide({
        content: [
          '<file filename="bad" url="javascript:alert(1)"/>',
          '<file filename="insecure" url="http://static.edusercontent.com/files/insecure"/>',
          '<file filename="external" url="https://example.com/external"/>',
        ].join(""),
      })],
    });

    expect(listLessonFiles(lesson)).toEqual([]);
  });
});

describe("thread files", () => {
  it("collects files from the body, answers, and nested comments without duplicate URLs", () => {
    const thread = makeThread({
      answers: [makeComment({
        comments: [makeComment({
          comments: [makeComment({
            content: '<file filename="nested.txt" url="https://static.edusercontent.com/files/nested"/>',
            id: 9020,
          })],
          content: '<file filename="reply.zip" url="https://static.edusercontent.com/files/reply"/>',
          id: 9010,
        })],
        content: '<file filename="solution.pdf" url="https://static.edusercontent.com/files/solution"/>',
        id: 9001,
      })],
      comments: [makeComment({
        content: '<file filename="duplicate.zip" url="https://static.edusercontent.com/files/starter"/>',
        id: 9100,
      })],
      content: '<document><file filename="starter.zip" url="https://static.edusercontent.com/files/starter"/></document>',
    });

    expect(listThreadFiles(thread)).toEqual([
      { filename: "starter.zip", threadId: 5001, source: "thread", url: "https://static.edusercontent.com/files/starter" },
      expect.objectContaining({ filename: "solution.pdf", commentId: 9001, source: "comment" }),
      expect.objectContaining({ filename: "reply.zip", commentId: 9010 }),
      expect.objectContaining({ filename: "nested.txt", commentId: 9020 }),
    ]);
  });

  it("ignores external and insecure thread file URLs", () => {
    const thread = makeThread({
      content: [
        '<file filename="external" url="https://example.com/external.pdf"/>',
        '<file filename="insecure" url="http://static.edusercontent.com/files/insecure"/>',
      ].join(""),
    });

    expect(listThreadFiles(thread)).toEqual([]);
  });
});

function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    author: null,
    comments: [],
    content: "",
    createdAt: "",
    document: "",
    id: 9001,
    isAnonymous: false,
    isEndorsed: false,
    isResolved: false,
    type: "comment",
    userId: 12345,
    voteCount: 0,
    ...overrides,
  };
}

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    answers: [],
    author: null,
    category: "",
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
    isSeen: true,
    metrics: {
      flagCount: 0,
      newReplyCount: 0,
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
    type: "post",
    updatedAt: "",
    userId: 12345,
    ...overrides,
  };
}

function makeSlide(overrides: Partial<LessonSlide> = {}): LessonSlide {
  return {
    content: "",
    courseId: 100,
    fileUrl: "",
    id: 10,
    index: 1,
    isHidden: false,
    lessonId: 7001,
    status: "open",
    title: "Slide",
    type: "document",
    ...overrides,
  };
}

function makeLesson(overrides: Partial<Lesson> = {}): Lesson {
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
    moduleName: "Week 1",
    number: 1,
    openable: true,
    openableWithoutAttempt: false,
    outline: "",
    slideCount: 0,
    slides: [],
    solutionsAt: "",
    state: "",
    status: "open",
    title: "Lesson",
    type: "lesson",
    updatedAt: "",
    ...overrides,
  };
}
