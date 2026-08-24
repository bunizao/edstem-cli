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
  const content = result.content as Array<{ text?: string; type: string }>;
  return JSON.parse(content[0]?.text ?? "null") as unknown;
}
