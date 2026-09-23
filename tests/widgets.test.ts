import { readFileSync } from "node:fs";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EdClient, type FetchLike } from "../src/ed/client.js";
import { createEdMcpServer } from "../src/mcp/server.js";
import {
  buildForumCatchup,
  buildLessonGuide,
  buildLessonProgress,
  buildThreadActivity,
} from "../src/mcp/widgets.js";
// @ts-expect-error The build script is plain JavaScript without types.
import { renderWidgetModule } from "../scripts/build-widget.mjs";

const NOW = new Date("2026-09-24T04:00:00Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

const USER = JSON.parse(readFileSync(new URL("fixtures/user_info.json", import.meta.url), "utf8"));
const THREADS = [
  { id: 1, number: 11, title: "Spec updated", type: "announcement", is_pinned: true, is_seen: false, created_at: daysAgo(1) },
  { id: 2, number: 12, title: "Autograder error", type: "question", category: "Assignments", subcategory: "A2", is_seen: false, document: "Query four  fails.", created_at: daysAgo(2) },
  { id: 3, number: 13, title: "Room for the test", type: "question", category: "Tests", is_seen: true, new_reply_count: 3, reply_count: 5, is_answered: true, created_at: daysAgo(5) },
  { id: 4, number: 14, title: "Old and read", type: "post", category: "General", is_seen: true, created_at: daysAgo(9) },
  { id: 5, number: 15, title: "Last month", type: "question", category: "General", is_seen: false, created_at: daysAgo(30) },
];
const LESSONS = {
  lessons: [
    { id: 71, module_id: 1, title: "Intro reading", status: "completed", available_at: daysAgo(40) },
    { id: 72, module_id: 1, title: "Intro quiz", status: "attempted", available_at: daysAgo(40) },
    { id: 73, module_id: 2, title: "Week two reading", status: "unattempted", available_at: daysAgo(20) },
    { id: 74, module_id: 3, title: "Scheduled", status: "unattempted", available_at: daysAgo(-7) },
    { id: 75, module_id: 3, title: "Hidden", status: "unattempted", is_hidden: true },
  ],
  modules: [{ id: 1, name: "Week 1" }, { id: 2, name: "Week 2" }, { id: 3, name: "Week 3" }, { id: 4, name: "Empty" }],
};

function edFetch(): ReturnType<typeof vi.fn<FetchLike>> {
  return vi.fn<FetchLike>().mockImplementation(async (input) => {
    const path = new URL(String(input)).pathname;
    const body = path === "/api/user" ? USER
      : path === "/api/courses/100/threads" ? { threads: THREADS, users: [] }
      : path === "/api/courses/100/lessons" ? LESSONS
      : path === "/api/lessons/72" ? { lesson: { id: 72, title: "Intro quiz", module_id: 1, module_name: "Week 1", slides: [{ id: 1, type: "document" }, { id: 2, type: "quiz" }] } }
      : undefined;
    return body ? new Response(JSON.stringify(body), { status: 200 }) : new Response("{}", { status: 404 });
  });
}

describe("widget payloads", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("catches up on the window with read state, keeping announcements apart", async () => {
    const client = new EdClient({ fetch: edFetch(), token: "secret" });

    const { structuredContent, text } = await buildForumCatchup(client, "CS101", 14);

    expect(structuredContent).toMatchObject({ course: "CS101", courseId: 100, days: 14, kind: "forum_catchup" });
    expect(structuredContent.announcements).toEqual([expect.objectContaining({ number: 11, seen: false })]);
    expect((structuredContent.threads as { number: number }[]).map((thread) => thread.number)).toEqual([12, 13, 14]);
    expect(structuredContent.threads).toContainEqual(expect.objectContaining({ excerpt: "Query four fails.", number: 12, seen: false }));
    expect(text).toContain("2 of 3 threads");
    expect(text).toContain("#13 Room for the test (+3 replies)");
    expect(text).toContain("#12 Autograder error (new, unanswered)");
  });

  it("charts only student threads inside the window", async () => {
    const client = new EdClient({ fetch: edFetch(), token: "secret" });

    const { structuredContent, text } = await buildThreadActivity(client, 100, 2);

    expect((structuredContent.threads as { number: number }[]).map((thread) => thread.number)).toEqual([12, 13, 14]);
    expect(structuredContent.threads).toContainEqual(expect.objectContaining({ category: "Assignments", sub: "A2" }));
    expect(text).toContain("3 threads in the last 2 weeks");
  });

  it("orders released modules by opening and leaves unreleased ones last", async () => {
    const client = new EdClient({ fetch: edFetch(), token: "secret" });

    const { structuredContent, text } = await buildLessonProgress(client, 100);
    const modules = structuredContent.modules as { name: string; openedAt: string | null; total: number; completed: number; unfinished: unknown[] }[];

    expect(modules.map((module) => [module.name, module.completed, module.total, Boolean(module.openedAt)])).toEqual([
      ["Week 1", 1, 2, true],
      ["Week 2", 0, 1, true],
      ["Week 3", 0, 1, false],
    ]);
    expect(modules[0]?.unfinished).toEqual([{ id: 72, status: "attempted", title: "Intro quiz" }]);
    expect(text).toContain("1 unfinished lessons in released modules before the latest one");
  });

  it("checks the guide's indexes and counts the lesson's own quiz without reading it", async () => {
    const fetch = edFetch();
    const client = new EdClient({ fetch, token: "secret" });
    const sections = [{ points: ["A point."], title: "One" }];
    const question = { answer: 1, options: ["a", "b"], question: "Q?", section: 0, why: "Because." };

    const { structuredContent } = await buildLessonGuide(client, { lessonId: 72, quiz: [question], sections });

    expect(structuredContent).toMatchObject({ edQuizSlides: 1, lesson: { module: "Week 1", title: "Intro quiz" } });
    expect(fetch.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual(["/api/lessons/72"]);
    await expect(buildLessonGuide(client, { lessonId: 72, quiz: [{ ...question, answer: 2 }], sections }))
      .rejects.toThrow("quiz[0].answer");
    await expect(buildLessonGuide(client, { lessonId: 72, quiz: [{ ...question, section: 1 }], sections }))
      .rejects.toThrow("quiz[0].section");
  });
});

describe("widget tools over MCP", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length > 0) await cleanups.pop()?.();
  });

  async function connect(widgets?: boolean): Promise<Client> {
    const edClient = new EdClient({ fetch: edFetch(), token: "secret" });
    const server: McpServer = createEdMcpServer({ canWrite: () => true, getClient: () => edClient, widgets });
    const client = new Client({ name: "test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    cleanups.push(async () => client.close(), async () => server.close());
    return client;
  }

  it("links every show tool to the widget and serves it as an MCP App", async () => {
    const client = await connect();

    const { tools } = await client.listTools();
    const shown = tools.filter((tool) => tool.name.startsWith("show_"));
    const { contents } = await client.readResource({ uri: "ui://edstem/widget.html" });

    expect(shown.map((tool) => tool.name).sort()).toEqual([
      "show_forum_catchup", "show_lesson_guide", "show_lesson_progress", "show_thread_activity",
    ]);
    for (const tool of shown) {
      expect(tool._meta).toMatchObject({ ui: { resourceUri: "ui://edstem/widget.html" } });
    }
    expect(contents[0]).toMatchObject({ mimeType: "text/html;profile=mcp-app" });
    expect(String((contents[0] as { text?: string }).text)).toContain('<main id="root"');
    expect(client.getInstructions()).toContain("show_forum_catchup");
  });

  it("returns text for the model and structured content for the widget", async () => {
    const client = await connect();

    const result = await client.callTool({ arguments: { courseId: 100 }, name: "show_lesson_progress" });

    expect(result.structuredContent).toMatchObject({ kind: "lesson_progress" });
    expect((result.content as { text: string }[])[0]?.text).toContain("CS101:");
  });

  it("drops the show tools when widgets are off", async () => {
    const client = await connect(false);

    const { tools } = await client.listTools();

    expect(tools.some((tool) => tool.name.startsWith("show_"))).toBe(false);
    expect(client.getInstructions()).toBeUndefined();
  });
});

it("keeps the generated widget module in sync with its sources", async () => {
  const generated = readFileSync(new URL("../src/mcp/widget-html.generated.ts", import.meta.url), "utf8");

  expect(generated === await renderWidgetModule(), "run npm run build:widget").toBe(true);
});
