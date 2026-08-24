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
