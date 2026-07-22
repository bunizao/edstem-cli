import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import type { CliRuntime } from "../src/cli.js";
import { createProgram, run } from "../src/cli.js";
import { EdClient, type FetchLike } from "../src/ed/client.js";

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`fixtures/${name}.json`, import.meta.url), "utf8"));
}

function makeRuntime(status = 200, isTTY = false): {
  fetch: ReturnType<typeof vi.fn<FetchLike>>;
  runtime: CliRuntime;
  stderr: string[];
  stdout: string[];
} {
  const responses: Record<string, unknown> = {
    "/api/user": fixture("user_info"),
    "/api/courses/100/threads": fixture("course_threads"),
    "/api/threads/5001": fixture("thread_detail"),
  };
  const fetch = vi.fn<FetchLike>().mockImplementation(async (input) => {
    const path = new URL(String(input)).pathname;
    return new Response(JSON.stringify(status === 200 ? responses[path] : { code: "bad_token" }), { status });
  });
  const client = new EdClient({ fetch, token: "test-token" });
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    fetch,
    runtime: {
      createClient: async () => client,
      defaultFetchCount: async () => 30,
      isTTY,
      writeStderr: (text) => stderr.push(text),
      writeStdout: (text) => stdout.push(text),
    },
    stderr,
    stdout,
  };
}

describe("CLI", () => {
  it("uses the edstem command name", () => {
    expect(createProgram(makeRuntime().runtime).name()).toBe("edstem");
  });

  it("fetches user data without a separate verification request", async () => {
    const { fetch, runtime, stdout } = makeRuntime();

    expect(await run(["node", "edstem", "user", "--json"], runtime)).toBe(0);

    expect(fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      id: 12345,
      courses: expect.arrayContaining([expect.objectContaining({ id: 100, code: "CS101" })]),
    });
  });

  it("emits compact thread summaries and field selection", async () => {
    const { runtime, stdout } = makeRuntime();

    await run(["node", "edstem", "threads", "100", "--fields", "id,title"], runtime);

    expect(JSON.parse(stdout.join(""))).toEqual([
      { id: 5001, title: "How do I install Python?" },
      { id: 5002, title: "Helpful resources for HW1" },
    ]);
  });

  it("keeps human-readable tables for TTY output", async () => {
    const { runtime, stdout } = makeRuntime(200, true);

    await run(["node", "edstem", "courses"], runtime);

    expect(stdout.join("")).toContain("ID");
    expect(stdout.join("")).toContain("CS101");
    expect(stdout.join("")).not.toMatch(/^\[/);
  });

  it("omits Ed XML from thread detail by default", async () => {
    const { runtime, stdout } = makeRuntime();

    await run(["node", "edstem", "thread", "5001"], runtime);

    expect(stdout.join("")).not.toContain("<document");
    expect(JSON.parse(stdout.join(""))).toHaveProperty("users.67890.name", "Bob TA");
  });

  it("exports thread Markdown without JSON quoting", async () => {
    const { runtime, stdout } = makeRuntime();

    await run(["node", "edstem", "thread", "5001", "--md"], runtime);

    expect(stdout.join("")).toContain("# #1 How do I install Python?");
    expect(stdout.join("")).not.toMatch(/^"/);
  });

  it("writes stable machine-readable auth errors", async () => {
    const { runtime, stderr } = makeRuntime(401);

    expect(await run(["node", "edstem", "user"], runtime)).toBe(3);

    expect(JSON.parse(stderr.join(""))).toEqual({
      error: {
        code: "auth",
        message: "Authentication failed (HTTP 401). Check your Ed API token.",
      },
    });
  });
});
