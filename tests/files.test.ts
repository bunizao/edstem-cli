import { describe, expect, it } from "vitest";

import { listLessonFiles } from "../src/ed/files.js";
import type { Lesson, LessonSlide } from "../src/ed/models.js";

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
