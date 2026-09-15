import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { EdClient, type FetchLike } from "../src/ed/client.js";
import {
  projectActivity,
  projectLessonDetail,
  projectSlide,
  projectThreadDetail,
  projectThreadSummary,
} from "../src/ed/projections.js";

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`fixtures/${name}.json`, import.meta.url), "utf8"));
}

describe("agent projections", () => {
  it("keeps thread lists compact", async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(
      new Response(JSON.stringify(fixture("course_threads")), { status: 200 })
    );
    const [thread] = await new EdClient({ fetch, token: "secret" }).fetchThreads(100);

    const result = projectThreadSummary(thread!);

    expect(result).toMatchObject({ id: 5001, flags: ["pinned", "answered"] });
    expect(result).not.toHaveProperty("content");
    expect(result).not.toHaveProperty("document");
    expect(result).not.toHaveProperty("answers");
  });

  it("hoists users and omits HTML from thread detail by default", async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(
      new Response(JSON.stringify(fixture("thread_detail")), { status: 200 })
    );
    const thread = await new EdClient({ fetch, token: "secret" }).fetchThread(5001);

    const result = projectThreadDetail(thread);

    expect(result).not.toHaveProperty("content");
    expect(result).toHaveProperty("users.67890.name", "Bob TA");
    expect(result).toHaveProperty("answers.0.byStaff", true);
    expect(result).toHaveProperty("endorsement.staffReplyCount", 1);
    expect(JSON.stringify(result)).not.toContain("<document");
  });

  it("projects a slide with its parent IDs and drops Ed's raw flag names", async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(new Response(JSON.stringify({
      slide: {
        content: "<document><paragraph>Recap</paragraph></document>",
        course_id: 100,
        id: 10,
        index: 2,
        is_hidden: true,
        lesson_id: 7001,
        status: "completed",
        title: "Recap",
        type: "document",
      },
    }), { status: 200 }));
    const slide = await new EdClient({ fetch, token: "secret" }).fetchSlide(10);

    expect(projectSlide(slide)).toEqual({
      content: "<document><paragraph>Recap</paragraph></document>",
      courseId: 100,
      hidden: true,
      id: 10,
      index: 2,
      lessonId: 7001,
      status: "completed",
      title: "Recap",
      type: "document",
    });
  });

  it("omits the redundant parent IDs from slides nested in lesson detail", async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(new Response(JSON.stringify({
      lesson: {
        course_id: 100,
        id: 7001,
        module_id: 1,
        slides: [{
          content: "Recap",
          course_id: 100,
          id: 10,
          index: 1,
          lesson_id: 7001,
          title: "Recap",
          type: "document",
        }],
        title: "Workshop",
      },
    }), { status: 200 }));
    const lesson = await new EdClient({ fetch, token: "secret" }).fetchLesson(7001);

    expect(projectLessonDetail(lesson).slides).toEqual([
      { content: "Recap", id: 10, index: 1, title: "Recap", type: "document" },
    ]);
  });

  it("includes source HTML only when requested", async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(
      new Response(JSON.stringify(fixture("thread_detail")), { status: 200 })
    );
    const thread = await new EdClient({ fetch, token: "secret" }).fetchThread(5001);

    expect(projectThreadDetail(thread, { includeHtml: true })).toHaveProperty(
      "content",
      expect.stringContaining("<document")
    );
  });
});

describe("projectActivity", () => {
  it("renames the upstream payload into the CLI's own keys", () => {
    const [comment, thread] = projectActivity([
      {
        type: "comment",
        value: {
          id: 1, type: "comment", course_id: 7, course_code: "CS101", course_name: "Systems",
          thread_id: 42, thread_title: "Week 1", thread_category: "Admin", thread_subcategory: "Setup",
          created_at: "2026-09-15T17:36:34.123+10:00", document: "hi",
        },
      },
      {
        type: "thread",
        value: { id: 2, type: "question", course_id: 7, title: "Why?", category: "Q&A", is_private: true, created_at: "" },
      },
    ]);

    expect(comment).toEqual({
      kind: "comment", id: 1, type: "comment", title: "Week 1", courseId: 7, courseCode: "CS101",
      courseName: "Systems", threadId: 42, category: "Admin", subcategory: "Setup",
      createdAt: "2026-09-15T17:36:34+10:00", document: "hi",
    });
    expect(thread).toEqual({ kind: "thread", id: 2, type: "question", title: "Why?", courseId: 7, category: "Q&A", private: true });
    for (const key of Object.keys({ ...comment, ...thread })) expect(key).not.toContain("_");
  });
});
