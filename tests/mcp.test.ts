import { readFileSync } from "node:fs";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EdClient, type FetchLike } from "../src/ed/client.js";
import { createEdMcpServer } from "../src/mcp/server.js";

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`fixtures/${name}.json`, import.meta.url), "utf8"));
}

describe("stdio MCP adapter", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()?.();
    }
  });

  it("exposes compact thread lists through the shared Ed modules", async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(
      new Response(JSON.stringify(fixture("course_threads")), { status: 200 })
    );
    const client = await connect(new EdClient({ fetch, token: "test-token" }));

    const result = await client.callTool({
      arguments: { courseId: 100, limit: 2 },
      name: "list_threads",
    });
    const payload = parseToolResult(result) as Array<Record<string, unknown>>;

    expect(payload[0]).not.toHaveProperty("content");
    expect(payload[0]).not.toHaveProperty("document");
    expect(JSON.stringify(result)).not.toContain("\n  ");
  });

  it("describes dynamic lesson filters and thread category levels", async () => {
    const client = await connect(new EdClient({ fetch: vi.fn<FetchLike>(), token: "test-token" }));

    const { tools } = await client.listTools();
    const lessons = tools.find((tool) => tool.name === "list_lessons");
    const threads = tools.find((tool) => tool.name === "list_threads");
    const lessonProperties = lessons?.inputSchema.properties as
      | Record<string, { description?: string }>
      | undefined;
    const threadProperties = threads?.inputSchema.properties as
      | Record<string, { description?: string }>
      | undefined;

    expect(lessons?.description).toContain("numeric ID or course code");
    expect(lessonProperties?.courseId?.description).toContain('38435 or "FIT2014"');
    expect(lessonProperties?.module?.description).toContain('"Week 5"');
    expect(lessonProperties?.state?.description).toContain('"active" or "scheduled"');
    expect(lessonProperties?.status?.description).toContain('"unattempted", "attempted", or "completed"');
    expect(threads?.description).toContain("category is top-level");
    expect(threadProperties?.subcategory?.description).toContain("second-level");
    expect(threadProperties?.sort?.description).toContain("pinned threads");
  });

  it("resolves a course code inside one MCP tool call", async () => {
    const fetch = vi.fn<FetchLike>().mockImplementation(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === "/api/user") {
        return new Response(JSON.stringify(fixture("user_info")), { status: 200 });
      }
      if (path === "/api/courses/100/lessons") {
        return new Response(JSON.stringify({ lessons: [], modules: [] }), { status: 200 });
      }
      return new Response(null, { status: 404 });
    });
    const client = await connect(new EdClient({ fetch, token: "test-token" }));

    const result = await client.callTool({
      arguments: { courseId: "cs101" },
      name: "list_lessons",
    });

    expect(result.isError).not.toBe(true);
    expect(parseToolResult(result)).toEqual([]);
    expect(fetch.mock.calls.map(([input]) => new URL(String(input)).pathname)).toEqual([
      "/api/user",
      "/api/courses/100/lessons",
    ]);
  });

  it("rejects ambiguous course codes before requesting course data", async () => {
    const identity = fixture("user_info") as {
      courses: Array<{ course: Record<string, unknown>; role: Record<string, unknown> }>;
    };
    const enrollment = identity.courses[0];
    if (!enrollment) throw new Error("Expected a course fixture");
    identity.courses.push({
      course: { ...enrollment.course, id: 101, status: "archived", year: "2025" },
      role: { ...enrollment.role, course_id: 101 },
    });
    const fetch = vi.fn<FetchLike>().mockResolvedValue(
      new Response(JSON.stringify(identity), { status: 200 })
    );
    const client = await connect(new EdClient({ fetch, token: "test-token" }));

    const result = await client.callTool({
      arguments: { courseId: "CS101" },
      name: "list_lessons",
    });

    expect(result.isError).toBe(true);
    expect(parseToolResult(result)).toMatchObject({
      error: { message: expect.stringContaining("is ambiguous"), type: "INVALID_ARGUMENT" },
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("returns available lesson values for an invalid filter", async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(new Response(JSON.stringify({
      lessons: [
        { id: 1, module_id: 7, state: "active", status: "unattempted", type: "general" },
        { id: 2, module_id: 7, state: "scheduled", status: "completed", type: "general" },
      ],
      modules: [{ id: 7, name: "Week 1" }],
    }), { status: 200 }));
    const client = await connect(new EdClient({ fetch, token: "test-token" }));

    const result = await client.callTool({
      arguments: { courseId: 100, status: "pending" },
      name: "list_lessons",
    });

    expect(result.isError).toBe(true);
    expect(parseToolResult(result)).toEqual({
      error: {
        message: 'Unknown lesson status "pending". Available values: completed, unattempted. '
          + 'Use "all" or omit the filter to include every value.',
        type: "INVALID_ARGUMENT",
      },
    });
  });

  it("does not duplicate payloads in structuredContent", async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(
      new Response(JSON.stringify(fixture("thread_detail")), { status: 200 })
    );
    const client = await connect(new EdClient({ fetch, token: "test-token" }));

    const result = await client.callTool({ arguments: { threadId: 5001 }, name: "get_thread" });

    expect(result).not.toHaveProperty("structuredContent");
    expect(parseToolResult(result)).toHaveProperty("users.67890.name", "Bob TA");
  });

  it("exposes lesson files as structured metadata and resource links", async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(new Response(JSON.stringify({
      lesson: {
        id: 7001,
        outline: '<file filename="external.pdf" url="https://example.com/external.pdf"/>',
        slides: [{
          id: 10,
          index: 1,
          title: "Workshop Slides",
          type: "pdf",
          file_url: "https://static.edusercontent.com/files/slides",
        }],
      },
    }), { status: 200 }));
    const client = await connect(new EdClient({ fetch, token: "test-token" }));

    const result = await client.callTool({
      arguments: { lessonId: 7001 },
      name: "list_lesson_files",
    });

    expect(parseToolResult(result)).toEqual([
      expect.objectContaining({ filename: "Workshop Slides.pdf", slideId: 10 }),
    ]);
    expect(result.content).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "Workshop Slides.pdf",
        type: "resource_link",
        uri: "https://static.edusercontent.com/files/slides",
      }),
    ]));
    expect(JSON.stringify(result)).not.toContain("example.com");
  });

  it("refuses to mark every lesson as read without queries or all", async () => {
    const fetch = vi.fn<FetchLike>();
    const client = await connect(new EdClient({ fetch, token: "test-token" }));

    const result = await client.callTool({
      arguments: { courseId: 100 },
      name: "mark_lessons_read",
    });

    expect(result.isError).toBe(true);
    expect(parseToolResult(result)).toMatchObject({
      error: { message: expect.stringContaining("all"), type: "INVALID_ARGUMENT" },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("marks lessons as read when all is set", async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(
      new Response(JSON.stringify({ lessons: [], modules: [] }), { status: 200 })
    );
    const client = await connect(new EdClient({ fetch, token: "test-token" }));

    const result = await client.callTool({
      arguments: { all: true, courseId: 100 },
      name: "mark_lessons_read",
    });

    expect(result.isError).not.toBe(true);
    expect(parseToolResult(result)).toEqual([]);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("requires at least one choice to submit an answer", async () => {
    const fetch = vi.fn<FetchLike>();
    const client = await connect(new EdClient({ fetch, token: "test-token" }));

    const result = await client.callTool({
      arguments: { choices: [], questionId: 2 },
      name: "submit_slide_answer",
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("choices");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("projects a single slide instead of returning Ed's raw slide", async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(new Response(JSON.stringify({
      slide: {
        content: "<document><paragraph>Recap</paragraph></document>",
        course_id: 100,
        id: 10,
        index: 1,
        is_hidden: false,
        lesson_id: 7001,
        title: "Recap",
        type: "document",
      },
    }), { status: 200 }));
    const client = await connect(new EdClient({ fetch, token: "test-token" }));

    const result = await client.callTool({ arguments: { slideId: 10 }, name: "get_slide" });

    expect(parseToolResult(result)).toEqual({
      content: "<document><paragraph>Recap</paragraph></document>",
      courseId: 100,
      id: 10,
      index: 1,
      lessonId: 7001,
      title: "Recap",
      type: "document",
    });
  });

  it("returns thread Markdown for both read_thread lookup forms", async () => {
    const byId = await connect(new EdClient({ fetch: threadFetch(), token: "test-token" }));

    const direct = await byId.callTool({ arguments: { threadId: 5001 }, name: "read_thread" });

    expect(direct.isError).not.toBe(true);
    expect(toolText(direct)).toContain("# #1 How do I install Python?");

    const fetch = threadFetch();
    const byNumber = await connect(new EdClient({ fetch, token: "test-token" }));

    const resolved = await byNumber.callTool({
      arguments: { courseId: "CS101", number: 1 },
      name: "read_thread",
    });

    expect(toolText(resolved)).toContain("# #1 How do I install Python?");
    expect(fetch.mock.calls.map(([input]) => new URL(String(input)).pathname)).toEqual([
      "/api/user",
      "/api/courses/100/threads/1",
    ]);
  });

  it("rejects read_thread arguments that mix both lookup forms", async () => {
    const fetch = threadFetch();
    const client = await connect(new EdClient({ fetch, token: "test-token" }));

    const mixed = await client.callTool({
      arguments: { courseId: 100, number: 1, threadId: 5001 },
      name: "read_thread",
    });
    const incomplete = await client.callTool({
      arguments: { courseId: 100 },
      name: "read_thread",
    });

    expect(mixed.isError).toBe(true);
    expect(toolText(mixed)).toContain("Provide either threadId, or both courseId and number.");
    expect(incomplete.isError).toBe(true);
    expect(toolText(incomplete)).toContain("Provide either threadId, or both courseId and number.");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns lesson and slide Markdown as plain text", async () => {
    const fetch = vi.fn<FetchLike>().mockImplementation(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === "/api/lessons/7001") {
        return new Response(JSON.stringify({
          lesson: {
            id: 7001,
            slides: [{ id: 10, index: 1, title: "Workshop Slides", type: "pdf" }],
            title: "Workshop",
          },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        slide: {
          file_url: "https://static.edusercontent.com/files/slides",
          id: 10,
          index: 1,
          lesson_id: 7001,
          title: "Workshop Slides",
          type: "pdf",
        },
      }), { status: 200 });
    });
    const client = await connect(new EdClient({ fetch, token: "test-token" }));

    const lesson = await client.callTool({ arguments: { lessonId: 7001 }, name: "read_lesson" });
    const slide = await client.callTool({ arguments: { slideId: 10 }, name: "read_slide" });

    expect(toolText(lesson)).toContain("# Workshop");
    expect(toolText(lesson)).toContain("### 1. Workshop Slides");
    expect(toolText(slide)).toContain("# Workshop Slides");
    expect(toolText(slide)).toContain(
      "File: [Workshop Slides](https://static.edusercontent.com/files/slides)"
    );
  });

  it("exposes thread files as structured metadata and resource links", async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(
      new Response(JSON.stringify(fixture("thread_files")), { status: 200 })
    );
    const client = await connect(new EdClient({ fetch, token: "test-token" }));

    const result = await client.callTool({
      arguments: { threadId: 5001 },
      name: "list_thread_files",
    });

    expect(parseToolResult(result)).toEqual([
      expect.objectContaining({ filename: "starter.zip", source: "thread", threadId: 5001 }),
      expect.objectContaining({ filename: "solution.pdf", commentId: 9001 }),
      expect.objectContaining({ filename: "notes.txt", commentId: 9010 }),
    ]);
    expect(result.content).toEqual(expect.arrayContaining([
      expect.objectContaining({
        description: "Thread 5001 file",
        name: "starter.zip",
        type: "resource_link",
        uri: "https://static.edusercontent.com/files/starter",
      }),
    ]));
  });

  it("enforces write scope at the MCP seam", async () => {
    const edClient = new EdClient({ fetch: vi.fn<FetchLike>(), token: "test-token" });
    const server = createEdMcpServer({ canWrite: () => false, getClient: () => edClient });
    const client = new Client({ name: "test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    cleanups.push(async () => client.close(), async () => server.close());

    const result = await client.callTool({
      arguments: { choices: [1], questionId: 2 },
      name: "submit_slide_answer",
    });

    expect(result.isError).toBe(true);
    expect(parseToolResult(result)).toHaveProperty("error.type", "INSUFFICIENT_SCOPE");
  });

  async function connect(edClient: EdClient): Promise<Client> {
    const server = createEdMcpServer({ canWrite: () => true, getClient: () => edClient });
    const client = new Client({ name: "test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    cleanups.push(async () => client.close(), async () => server.close());
    return client;
  }
});

function parseToolResult(result: Awaited<ReturnType<Client["callTool"]>>): unknown {
  return JSON.parse(toolText(result)) as unknown;
}

function toolText(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = result.content as Array<{ text?: string; type: string }>;
  return content[0]?.text ?? "null";
}

function threadFetch(): ReturnType<typeof vi.fn<FetchLike>> {
  return vi.fn<FetchLike>().mockImplementation(async (input) => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/user") {
      return new Response(JSON.stringify(fixture("user_info")), { status: 200 });
    }
    return new Response(JSON.stringify(fixture("thread_detail")), { status: 200 });
  });
}
