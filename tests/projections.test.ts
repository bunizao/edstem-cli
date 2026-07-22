import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { EdClient, type FetchLike } from "../src/ed/client.js";
import { projectThreadDetail, projectThreadSummary } from "../src/ed/projections.js";

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
