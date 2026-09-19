import { readFileSync } from "node:fs";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EdClient, type FetchLike } from "../src/ed/client.js";
import { createStdioEdMcpServer } from "../src/mcp.js";
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

  it("searches threads client-side across the title and body", async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(
      new Response(JSON.stringify(fixture("course_threads")), { status: 200 })
    );
    const client = await connect(new EdClient({ fetch, token: "test-token" }));

    const result = await client.callTool({
      arguments: { courseId: 100, query: "python MACOS" },
      name: "search_threads",
    });

    expect(parseToolResult(result)).toEqual([
      expect.objectContaining({ id: 5001, title: "How do I install Python?" }),
    ]);
  });

  it("forwards offset from search_threads to Ed", async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(
      new Response(JSON.stringify(fixture("course_threads")), { status: 200 })
    );
    const client = await connect(new EdClient({ fetch, token: "test-token" }));

    await client.callTool({
      arguments: { courseId: 100, offset: 30, query: "python" },
      name: "search_threads",
    });

    expect(new URL(String(fetch.mock.calls[0]?.[0])).searchParams.get("offset")).toBe("30");
  });

  it("applies offset and since to list_threads", async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(
      new Response(JSON.stringify(fixture("course_threads")), { status: 200 })
    );
    const client = await connect(new EdClient({ fetch, token: "test-token" }));

    const result = await client.callTool({
      arguments: { courseId: 100, offset: 5, since: "2026-01-16" },
      name: "list_threads",
    });

    expect(parseToolResult(result)).toEqual([expect.objectContaining({ id: 5002 })]);
    expect(new URL(String(fetch.mock.calls[0]?.[0])).searchParams.get("offset")).toBe("5");
  });

  it("reports an unparsable since value as an invalid argument", async () => {
    const client = await connect(new EdClient({ fetch: vi.fn<FetchLike>(), token: "test-token" }));

    const result = await client.callTool({
      arguments: { courseId: 100, since: "last tuesday" },
      name: "list_threads",
    });

    expect(result.isError).toBe(true);
    expect(parseToolResult(result)).toMatchObject({
      error: { message: expect.stringContaining("Invalid time value"), type: "INVALID_ARGUMENT" },
    });
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

  it("gives every tool a title and every input field a description", async () => {
    const client = await connect(new EdClient({ fetch: vi.fn<FetchLike>(), token: "test-token" }));

    const { tools } = await client.listTools();

    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      expect(tool.title, `${tool.name} is missing a title`).toBeTruthy();
      for (const [field, path] of describableFields(tool.inputSchema)) {
        expect(field.description, `${tool.name}.${path} is missing a description`).toBeTruthy();
      }
    }
  });

  it("annotates every tool as closed-world and marks write idempotency", async () => {
    const client = await connect(new EdClient({ fetch: vi.fn<FetchLike>(), token: "test-token" }));

    const { tools } = await client.listTools();
    const annotations = new Map(tools.map((tool) => [tool.name, tool.annotations]));

    for (const tool of tools) {
      expect(tool.annotations?.openWorldHint, `${tool.name} is not closed-world`).toBe(false);
    }
    expect(annotations.get("list_threads")).toMatchObject({
      idempotentHint: true,
      readOnlyHint: true,
    });
    expect(annotations.get("mark_lessons_read")).toMatchObject({
      destructiveHint: false,
      idempotentHint: true,
      readOnlyHint: false,
    });
    expect(annotations.get("submit_slide")).toMatchObject({ idempotentHint: false });
    expect(annotations.get("submit_slide_answer")).toMatchObject({ idempotentHint: false });
  });

  it("lists course modules with their lesson counts", async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(new Response(JSON.stringify({
      lessons: [
        { id: 1, module_id: 7 },
        { id: 2, module_id: 7 },
        { id: 3, module_id: 8 },
      ],
      modules: [{ id: 7, name: "Week 1" }, { id: 8, name: "Week 2" }, { id: 9, name: "Extras" }],
    }), { status: 200 }));
    const client = await connect(new EdClient({ fetch, token: "test-token" }));

    const result = await client.callTool({ arguments: { courseId: 100 }, name: "list_modules" });

    expect(parseToolResult(result)).toEqual([
      { id: 7, name: "Week 1", lessonCount: 2 },
      { id: 8, name: "Week 2", lessonCount: 1 },
      { id: 9, name: "Extras", lessonCount: 0 },
    ]);
    expect(fetch.mock.calls.map(([input]) => new URL(String(input)).pathname)).toEqual([
      "/api/courses/100/lessons",
    ]);
  });

  it("offers a triage prompt for unanswered threads", async () => {
    const client = await connect(new EdClient({ fetch: vi.fn<FetchLike>(), token: "test-token" }));

    const { prompts } = await client.listPrompts();
    const result = await client.getPrompt({
      arguments: { courseId: "FIT2014", limit: "5" },
      name: "triage_unanswered",
    });
    const [message] = result.messages;

    expect(prompts.map((prompt) => prompt.name)).toContain("triage_unanswered");
    expect(message?.role).toBe("user");
    expect(message?.content).toMatchObject({ type: "text" });
    const text = (message?.content as { text: string }).text;
    expect(text).toContain("courseId=FIT2014");
    expect(text).toContain("answered=false");
    expect(text).toContain("limit=5");
    expect(text).toContain("get_thread");
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
    const client = await connectServer(
      createEdMcpServer({ canWrite: () => false, getClient: () => edClient })
    );

    const result = await client.callTool({
      arguments: { choices: [1], questionId: 2 },
      name: "submit_slide_answer",
    });

    expect(result.isError).toBe(true);
    expect(parseToolResult(result)).toHaveProperty("error.type", "INSUFFICIENT_SCOPE");
  });

  it("creates a thread from Markdown and reports it back", async () => {
    const fetch = vi.fn<FetchLike>().mockImplementation(async () => new Response(
      JSON.stringify({ thread: { course_id: 100, id: 5100, number: 44, title: "Install" } }),
      { status: 200 }
    ));
    const client = await connect(new EdClient({ fetch, token: "test-token" }));

    const result = await client.callTool({
      arguments: { body: "Help **me**", courseId: 100, title: "Install", type: "question" },
      name: "create_thread",
    });

    expect(result.isError).not.toBe(true);
    expect(parseToolResult(result)).toMatchObject({ id: 5100, number: 44, title: "Install" });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(new URL(String(url)).pathname).toBe("/api/courses/100/threads");
    expect(JSON.parse(String(init?.body)).thread).toMatchObject({
      content: '<document version="2.0"><paragraph>Help <bold>me</bold></paragraph></document>',
      is_private: false,
      title: "Install",
      type: "question",
    });
  });

  it("refuses to reply under a comment from another thread", async () => {
    const fetch = vi.fn<FetchLike>().mockImplementation(async (_input, init) => {
      if (init?.method === "POST") throw new Error("Unexpected POST");
      return new Response(JSON.stringify(fixture("thread_detail")), { status: 200 });
    });
    const client = await connect(new EdClient({ fetch, token: "test-token" }));

    const result = await client.callTool({
      arguments: { body: "Same here.", threadId: 5001, toCommentId: 4242 },
      name: "reply_thread",
    });

    expect(result.isError).toBe(true);
    expect(parseToolResult(result)).toEqual({
      error: {
        message: "Comment 4242 does not belong to thread 5001.",
        type: "INVALID_ARGUMENT",
      },
    });
    expect(fetch.mock.calls.map(([, init]) => init?.method)).toEqual(["GET"]);
  });

  it("gates posting tools behind canPost even when writes are allowed", async () => {
    const fetch = vi.fn<FetchLike>();
    const edClient = new EdClient({ fetch, token: "test-token" });
    const client = await connectServer(createEdMcpServer({
      canPost: () => false,
      canWrite: () => true,
      getClient: () => edClient,
    }));

    const result = await client.callTool({
      arguments: { body: "Hi", threadId: 5001 },
      name: "reply_thread",
    });

    expect(result.isError).toBe(true);
    expect(parseToolResult(result)).toMatchObject({
      error: {
        message: "Posting is disabled; set EDSTEM_ALLOW_POSTING=1 for edstem-mcp.",
        type: "INSUFFICIENT_SCOPE",
      },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("disables posting on the stdio server until EDSTEM_ALLOW_POSTING is set", async () => {
    const fetch = vi.fn<FetchLike>();
    const edClient = new EdClient({ fetch, token: "test-token" });
    vi.stubEnv("EDSTEM_ALLOW_POSTING", "");
    cleanups.push(async () => {
      vi.unstubAllEnvs();
    });
    const client = await connectServer(createStdioEdMcpServer(edClient));

    const result = await client.callTool({
      arguments: { body: "Hi", courseId: 100, title: "Hi", type: "post" },
      name: "create_thread",
    });

    expect(result.isError).toBe(true);
    expect(parseToolResult(result)).toHaveProperty("error.type", "INSUFFICIENT_SCOPE");
    expect(fetch).not.toHaveBeenCalled();
  });

  async function connect(edClient: EdClient): Promise<Client> {
    return connectServer(createEdMcpServer({ canWrite: () => true, getClient: () => edClient }));
  }

  async function connectServer(server: McpServer): Promise<Client> {
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

type JsonSchema = {
  description?: string;
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
};

/** Walk a tool input schema and yield every field that should carry a description. */
function describableFields(schema: JsonSchema, path = ""): Array<[JsonSchema, string]> {
  return Object.entries(schema.properties ?? {}).flatMap(([name, field]) => {
    const fieldPath = path ? `${path}.${name}` : name;
    return [
      [field, fieldPath] as [JsonSchema, string],
      ...describableFields(field, fieldPath),
      ...(field.items ? describableFields(field.items, `${fieldPath}[]`) : []),
    ];
  });
}
