import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { CliRuntime } from "../src/cli.js";
import { createProgram, run } from "../src/cli.js";
import { EdClient, type FetchLike } from "../src/ed/client.js";

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`fixtures/${name}.json`, import.meta.url), "utf8"));
}

function makeRuntime(
  status = 200,
  isTTY = false,
  userInfo: unknown = fixture("user_info"),
  options: { stdinLine?: string; tokenFile?: string } = {}
): {
  fetch: ReturnType<typeof vi.fn<FetchLike>>;
  runtime: CliRuntime;
  stderr: string[];
  stdout: string[];
} {
  const responses: Record<string, unknown> = {
    "/api/user": userInfo,
    "/api/courses/100/threads": fixture("course_threads"),
    "/api/courses/100/threads/1": fixture("thread_detail"),
    "/api/courses/100/lessons": {
      lessons: [
        { course_id: 100, id: 7001, module_id: 1, title: "Workshop", type: "general" },
        { course_id: 100, id: 7002, module_id: 1, title: "Quiz", type: "quiz" },
      ],
      modules: [{ course_id: 100, id: 1, name: "Week 1" }],
    },
    "/api/threads/5001": fixture("thread_detail"),
    "/api/lessons/7001": {
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
    },
    "/api/lessons/slides/10": {
      slide: {
        content: "<document><paragraph>Bring the starter repository.</paragraph></document>",
        course_id: 100,
        id: 10,
        index: 1,
        lesson_id: 7001,
        title: "Workshop Slides",
        type: "pdf",
        file_url: "https://static.edusercontent.com/files/slides",
      },
    },
    "/api/lessons/7002": {
      lesson: {
        id: 7002,
        outline: '<file filename="outline.pdf" url="https://static.edusercontent.com/files/shared"/>',
        slides: [{
          id: 11,
          index: 1,
          title: "Shared Slides",
          type: "pdf",
          file_url: "https://static.edusercontent.com/files/shared",
        }],
      },
    },
  };
  const fetch = vi.fn<FetchLike>().mockImplementation(async (input) => {
    const url = new URL(String(input));
    const path = url.pathname;
    if (url.hostname.endsWith("edusercontent.com")) {
      return new Response("pdf-body", {
        headers: {
          "content-disposition": 'inline; filename="Workshop Slides.pdf"',
          "content-type": "application/pdf",
        },
        status,
      });
    }
    return new Response(JSON.stringify(status === 200 ? responses[path] : { code: "bad_token" }), { status });
  });
  const client = new EdClient({ fetch, token: "test-token" });
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    fetch,
    runtime: {
      createClient: async () => client,
      createClientForToken: async (token) => new EdClient({ fetch, token }),
      defaultFetchCount: async () => 30,
      interactive: false,
      isTTY,
      readStdinLine: async () => options.stdinLine ?? "",
      tokenFile: options.tokenFile ?? join(tmpdir(), "edstem-cli-absent-token"),
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
      units: expect.arrayContaining([expect.objectContaining({ id: 100, code: "CS101" })]),
    });
  });

  it("infers list and show verbs and resolves all unit aliases", async () => {
    for (const noun of ["units", "courses", "projects"]) {
      const list = makeRuntime();
      expect(await run(["node", "edstem", noun], list.runtime)).toBe(0);
      expect(JSON.parse(list.stdout.join(""))).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: 100, code: "CS101" })])
      );
    }

    const detail = makeRuntime();
    expect(await run(["node", "edstem", "threads", "show", "5001"], detail.runtime)).toBe(0);
    expect(JSON.parse(detail.stdout.join(""))).toHaveProperty("users.67890.name", "Bob TA");

    const interleaved = makeRuntime();
    expect(await run(["node", "edstem", "threads", "--max", "1", "100"], interleaved.runtime)).toBe(0);
  });

  it("emits compact thread summaries and field selection", async () => {
    const { runtime, stdout } = makeRuntime();

    await run(["node", "edstem", "threads", "100", "--fields", "id,title"], runtime);

    expect(JSON.parse(stdout.join(""))).toEqual([
      { id: 5001, title: "How do I install Python?" },
      { id: 5002, title: "Helpful resources for HW1" },
    ]);
  });

  it("trims CLI thread filter values", async () => {
    const { runtime, stdout } = makeRuntime();

    expect(await run([
      "node", "edstem", "threads", "100", "--category", " General ", "--json",
    ], runtime)).toBe(0);

    expect(JSON.parse(stdout.join(""))).toEqual([
      expect.objectContaining({ id: 5001, category: "General" }),
    ]);
  });

  it("accepts a course code without a separate lookup command", async () => {
    const { fetch, runtime, stdout } = makeRuntime();

    expect(await run(["node", "edstem", "threads", "CS101", "--max", "1"], runtime)).toBe(0);

    expect(JSON.parse(stdout.join(""))).toEqual([
      expect.objectContaining({ id: 5001, courseId: 100 }),
      expect.objectContaining({ id: 5002, courseId: 100 }),
    ]);
    expect(fetch.mock.calls.map(([input]) => new URL(String(input)).pathname)).toEqual([
      "/api/user",
      "/api/courses/100/threads",
    ]);
  });

  it("resolves course codes in course-local thread references", async () => {
    const { fetch, runtime, stdout } = makeRuntime();

    expect(await run(["node", "edstem", "threads", "show", "CS101#1"], runtime)).toBe(0);

    expect(JSON.parse(stdout.join(""))).toHaveProperty("id", 5001);
    expect(fetch.mock.calls.map(([input]) => new URL(String(input)).pathname)).toEqual([
      "/api/user",
      "/api/courses/100/threads/1",
    ]);
  });

  it("maps the CLI lesson type option to the core filter", async () => {
    const { runtime, stdout } = makeRuntime();

    expect(await run([
      "node", "edstem", "lessons", "100", "--type", "general", "--json",
    ], runtime)).toBe(0);

    expect(JSON.parse(stdout.join(""))).toEqual([
      expect.objectContaining({ id: 7001, type: "general" }),
    ]);
  });

  it("rejects ambiguous course codes before a progress mutation", async () => {
    const { fetch, runtime, stderr } = makeRuntime(200, false, duplicateCourseIdentity());

    expect(await run([
      "node", "edstem", "lessons", "mark-read", "CS101", "--all", "--yes", "--json",
    ], runtime)).toBe(2);

    expect(JSON.parse(stderr.join(""))).toMatchObject({
      error: { code: "usage", message: expect.stringContaining("is ambiguous") },
    });
    expect(fetch.mock.calls.map(([input]) => new URL(String(input)).pathname)).toEqual([
      "/api/user",
    ]);
  });

  it("reports an unknown unit ID as not found", async () => {
    const { runtime, stderr } = makeRuntime();

    expect(await run(["node", "edstem", "units", "show", "999", "--json"], runtime)).toBe(4);
    expect(JSON.parse(stderr.join(""))).toMatchObject({
      error: { code: "not_found", message: expect.stringContaining("999") },
    });
  });

  it("keeps human-readable tables for TTY output", async () => {
    const { runtime, stdout } = makeRuntime(200, true);

    await run(["node", "edstem", "units"], runtime);

    expect(stdout.join("")).toContain("id");
    expect(stdout.join("")).toContain("CS101");
    expect(stdout.join("")).not.toMatch(/^\[/);
  });

  it("exports thread Markdown only through the read verb", async () => {
    const { fetch, runtime, stdout } = makeRuntime();

    expect(await run(["node", "edstem", "threads", "read", "5001"], runtime)).toBe(0);

    expect(stdout.join("")).toContain("# #1 How do I install Python?");
    expect(stdout.join("")).not.toMatch(/^"/);
    expect(fetch.mock.calls.map((call) => call[1]?.method)).toEqual(["GET"]);
  });

  it("exports lesson and slide Markdown through the read verb", async () => {
    const lesson = makeRuntime();

    expect(await run(["node", "edstem", "lessons", "read", "7001"], lesson.runtime)).toBe(0);
    expect(lesson.stdout.join("")).toContain("## Slides");
    expect(lesson.stdout.join("")).toContain("### 1. Workshop Slides");

    const slide = makeRuntime();

    expect(await run(["node", "edstem", "slides", "read", "10"], slide.runtime)).toBe(0);
    expect(slide.stdout.join("")).toContain("# Workshop Slides");
    expect(slide.stdout.join("")).toContain("- **Lesson ID:** 7001");
    expect(slide.stdout.join("")).toContain(
      "File: [Workshop Slides](https://static.edusercontent.com/files/slides)"
    );
    expect(slide.stdout.join("")).toContain("Bring the starter repository.");
    expect(slide.fetch.mock.calls.map((call) => call[1]?.method)).toEqual(["GET"]);
  });

  it("projects slide details instead of returning Ed's raw slide", async () => {
    const { runtime, stdout } = makeRuntime();

    expect(await run(["node", "edstem", "slides", "show", "10", "--json"], runtime)).toBe(0);

    const payload = JSON.parse(stdout.join(""));
    expect(payload).toMatchObject({
      content: expect.stringContaining("<document"),
      courseId: 100,
      id: 10,
      lessonId: 7001,
      type: "pdf",
    });
    expect(payload).not.toHaveProperty("isHidden");
  });

  it("lists and downloads lesson files", async () => {
    const listing = makeRuntime();

    expect(await run(["node", "edstem", "files", "list", "7001", "--json"], listing.runtime)).toBe(0);
    expect(JSON.parse(listing.stdout.join(""))).toEqual([
      expect.objectContaining({ filename: "Workshop Slides.pdf", slideId: 10 }),
    ]);

    const directory = await mkdtemp(join(tmpdir(), "edstem-cli-download-"));
    try {
      const download = makeRuntime();
      expect(await run([
        "node", "edstem", "files", "get", "7001", "--dest", directory, "--json",
      ], download.runtime)).toBe(0);
      expect(await readFile(join(directory, "Workshop Slides.pdf"), "utf8")).toBe("pdf-body");
      expect(JSON.parse(download.stdout.join(""))).toMatchObject({
        lessonId: 7001,
        downloads: [{ filename: "Workshop Slides.pdf", slideId: 10 }],
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("reports a missing selected slide file", async () => {
    const { runtime, stderr } = makeRuntime();

    expect(await run([
      "node", "edstem", "files", "get", "7001", "--slide", "99", "--json",
    ], runtime)).toBe(4);
    expect(JSON.parse(stderr.join(""))).toMatchObject({
      error: { code: "not_found", message: expect.stringContaining("slide 99") },
    });
  });

  it("downloads a slide when the lesson outline shares its URL", async () => {
    const directory = await mkdtemp(join(tmpdir(), "edstem-cli-shared-download-"));
    try {
      const { runtime, stdout } = makeRuntime();

      expect(await run([
        "node", "edstem", "files", "get", "7002", "--slide", "11",
        "--dest", directory, "--json",
      ], runtime)).toBe(0);

      expect(JSON.parse(stdout.join(""))).toMatchObject({
        lessonId: 7002,
        downloads: [{ slideId: 11 }],
      });
      expect(await readFile(join(directory, "Workshop Slides.pdf"), "utf8")).toBe("pdf-body");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("renders structured auth errors with the shared contract", async () => {
    const { runtime, stderr } = makeRuntime(401);

    expect(await run(["node", "edstem", "user", "--json"], runtime)).toBe(3);

    expect(JSON.parse(stderr.join(""))).toEqual({
      error: {
        code: "auth",
        message: "Authentication failed (HTTP 401). Check your Ed API token.",
      },
      exit_code: 3,
      ok: false,
    });
  });

  it("returns usage exit 2 for unknown commands and writes one error", async () => {
    const { runtime, stderr, stdout } = makeRuntime();

    expect(await run(["node", "edstem", "bogus", "--json"], runtime)).toBe(2);

    expect(stdout).toEqual([]);
    expect(stderr).toHaveLength(1);
    expect(JSON.parse(stderr.join(""))).toMatchObject({ error: { code: "usage" }, exit_code: 2 });
  });

  it("treats help and version as successful control flow", async () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      expect(await run(["node", "edstem", "--help"], makeRuntime().runtime)).toBe(0);
      expect(await run(["node", "edstem", "-V"], makeRuntime().runtime)).toBe(0);
      expect(await run(["node", "edstem", "help", "threads"], makeRuntime().runtime)).toBe(0);
      expect(write).toHaveBeenCalled();
    } finally {
      write.mockRestore();
    }
  });

  it("describes the normalized command tree", async () => {
    const { runtime, stdout } = makeRuntime();

    expect(await run(["node", "edstem", "commands", "--json"], runtime)).toBe(0);

    const metadata = JSON.parse(stdout.join(""));
    const commands = metadata.commands.flatMap((command: { commands: unknown[] }) => command.commands);
    expect(commands).toEqual(expect.arrayContaining([
      expect.objectContaining({ verb: "mark-read", mutating: true }),
      expect.objectContaining({ verb: "submit", mutating: true }),
    ]));
    expect(commands.map((command: { verb?: string }) => command.verb).filter(Boolean)).not.toEqual(
      expect.arrayContaining(["questions", "responses", "quiz", "answer"])
    );
  });

  it("rejects non-interactive mutations unless confirmed", async () => {
    const { fetch, runtime, stderr } = makeRuntime();

    expect(await run(["node", "edstem", "lessons", "mark-read", "100", "--all"], runtime)).toBe(2);

    expect(fetch).not.toHaveBeenCalled();
    expect(stderr.join("")).toContain("--yes");
  });

  it("supports dry-run without issuing an upstream request", async () => {
    const { fetch, runtime } = makeRuntime();

    expect(await run([
      "node", "edstem", "slides", "submit", "12", "--question", "15", "--choice", "2", "--dry-run",
    ], runtime)).toBe(0);

    expect(fetch).not.toHaveBeenCalled();
  });

  it("validates mutation syntax before confirmation or authentication", async () => {
    const { fetch, runtime, stderr } = makeRuntime();

    expect(await run([
      "node", "edstem", "slides", "submit", "12", "--choice", "2", "--dry-run", "--json",
    ], runtime)).toBe(2);

    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.parse(stderr.join(""))).toMatchObject({ error: { code: "usage" } });
  });

  it("requires a choice when submitting an answer for a question", async () => {
    const { fetch, runtime, stderr } = makeRuntime();

    expect(await run([
      "node", "edstem", "slides", "submit", "12", "--question", "15", "--dry-run", "--json",
    ], runtime)).toBe(2);

    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.parse(stderr.join(""))).toMatchObject({
      error: { code: "usage", message: "--question requires at least one --choice." },
    });
  });

  it("refuses to mark every lesson as read without queries or --all", async () => {
    const { fetch, runtime, stderr } = makeRuntime();

    expect(await run([
      "node", "edstem", "lessons", "mark-read", "100", "--dry-run", "--json",
    ], runtime)).toBe(2);

    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.parse(stderr.join(""))).toMatchObject({
      error: { code: "usage", message: expect.stringContaining("--all") },
    });
  });

  it("marks every lesson as read with --all", async () => {
    const { runtime, stdout } = makeRuntime();

    expect(await run([
      "node", "edstem", "lessons", "mark-read", "100", "--all", "--yes", "--json",
    ], runtime)).toBe(0);

    expect(JSON.parse(stdout.join(""))).toEqual([
      expect.objectContaining({ id: 7001, completedSlides: 1, success: true }),
      expect.objectContaining({ id: 7002, completedSlides: 1, success: true }),
    ]);
  });

  it("announces the full unit in the --all plan", async () => {
    const { runtime } = makeRuntime();
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      expect(await run([
        "node", "edstem", "lessons", "mark-read", "100", "--all", "--dry-run",
      ], runtime)).toBe(0);

      expect(write).toHaveBeenCalledWith("Mark ALL lessons as read in unit 100.\n");
    } finally {
      write.mockRestore();
    }
  });

  it("names the argument in validation errors", async () => {
    const lesson = makeRuntime();
    expect(await run(["node", "edstem", "lessons", "show", "abc", "--json"], lesson.runtime)).toBe(2);
    expect(JSON.parse(lesson.stderr.join(""))).toMatchObject({
      error: { code: "usage", message: "<lesson> must be a positive integer." },
    });

    const delay = makeRuntime();
    expect(await run([
      "node", "edstem", "lessons", "mark-read", "100", "--all", "--delay=-1", "--json",
    ], delay.runtime)).toBe(2);
    expect(JSON.parse(delay.stderr.join(""))).toMatchObject({
      error: { code: "usage", message: "--delay must be greater than or equal to 0." },
    });

    const choice = makeRuntime();
    expect(await run([
      "node", "edstem", "slides", "submit", "12", "--question", "15", "--choice", "0", "--json",
    ], choice.runtime)).toBe(2);
    expect(JSON.parse(choice.stderr.join(""))).toMatchObject({
      error: { code: "usage", message: "--choice must be a positive integer." },
    });
  });
});

describe("auth commands", () => {
  async function tokenPath(prefix: string): Promise<string> {
    return join(await mkdtemp(join(tmpdir(), prefix)), "config", "token");
  }

  it("saves and verifies a token read from stdin", async () => {
    vi.stubEnv("EDSTEM_TOKEN", undefined);
    const tokenFile = await tokenPath("edstem-login-");
    const { fetch, runtime, stderr, stdout } = makeRuntime(200, false, fixture("user_info"), {
      stdinLine: "stdin-token",
      tokenFile,
    });
    try {
      expect(await run(["node", "edstem", "auth", "login", "--token-stdin", "--json"], runtime)).toBe(0);
    } finally {
      vi.unstubAllEnvs();
    }

    expect(JSON.parse(stdout.join(""))).toMatchObject({
      authenticated: true,
      tokenFile,
      user: { id: 12345, name: "Alice Student" },
    });
    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: "Bearer stdin-token",
    });
    expect(await readFile(tokenFile, "utf8")).toBe("stdin-token\n");
    expect((await stat(tokenFile)).mode & 0o777).toBe(0o600);
    expect(stderr).toEqual([]);
  });

  it("warns when EDSTEM_TOKEN shadows the saved token", async () => {
    const tokenFile = await tokenPath("edstem-login-env-");
    const { runtime, stderr } = makeRuntime(200, false, fixture("user_info"), {
      stdinLine: "stdin-token",
      tokenFile,
    });

    vi.stubEnv("EDSTEM_TOKEN", "env-token");
    try {
      expect(await run(["node", "edstem", "auth", "login", "--token-stdin", "--json"], runtime)).toBe(0);
    } finally {
      vi.unstubAllEnvs();
    }

    expect(stderr.join("")).toContain("EDSTEM_TOKEN is set and takes precedence");
    expect(await readFile(tokenFile, "utf8")).toBe("stdin-token\n");
  });

  it("prints the login plan without reading or saving a token on a dry run", async () => {
    const tokenFile = await tokenPath("edstem-login-dry-");
    await writeTokenFile(tokenFile);
    const { fetch, runtime, stdout } = makeRuntime(200, false, fixture("user_info"), {
      stdinLine: "stdin-token",
      tokenFile,
    });
    const planned: string[] = [];
    const write = vi.spyOn(process.stderr, "write").mockImplementation((text) => {
      planned.push(String(text));
      return true;
    });

    vi.stubEnv("EDSTEM_TOKEN", undefined);
    try {
      expect(await run([
        "node", "edstem", "auth", "login", "--token-stdin", "--dry-run", "--json",
      ], runtime)).toBe(0);
    } finally {
      write.mockRestore();
      vi.unstubAllEnvs();
    }

    expect(planned.join("")).toBe(`Verify an Ed token and save it to ${tokenFile}.\n`);
    expect(fetch).not.toHaveBeenCalled();
    expect(stdout).toEqual([]);
    expect(await readFile(tokenFile, "utf8")).toBe("saved-token\n");
  });

  it("rejects an invalid token without writing it", async () => {
    const tokenFile = await tokenPath("edstem-login-invalid-");
    const { runtime, stderr } = makeRuntime(401, false, fixture("user_info"), {
      stdinLine: "bad-token",
      tokenFile,
    });

    expect(await run(["node", "edstem", "auth", "login", "--token-stdin", "--json"], runtime)).toBe(3);

    expect(JSON.parse(stderr.join(""))).toMatchObject({ error: { code: "auth" } });
    await expect(readFile(tokenFile, "utf8")).rejects.toThrow();
  });

  it("removes the token file and stays idempotent", async () => {
    const tokenFile = await tokenPath("edstem-logout-");
    await writeTokenFile(tokenFile);
    const first = makeRuntime(200, false, fixture("user_info"), { tokenFile });

    expect(await run(["node", "edstem", "auth", "logout", "--yes", "--json"], first.runtime)).toBe(0);
    expect(JSON.parse(first.stdout.join(""))).toEqual({ removed: true, tokenFile });
    await expect(readFile(tokenFile, "utf8")).rejects.toThrow();

    const second = makeRuntime(200, false, fixture("user_info"), { tokenFile });
    expect(await run(["node", "edstem", "auth", "logout", "--yes", "--json"], second.runtime)).toBe(0);
    expect(JSON.parse(second.stdout.join(""))).toEqual({ removed: false, tokenFile });
    expect(first.fetch).not.toHaveBeenCalled();
  });

  it("prints the logout plan without removing the token on a dry run", async () => {
    const tokenFile = await tokenPath("edstem-logout-dry-");
    await writeTokenFile(tokenFile);
    const { runtime, stdout } = makeRuntime(200, false, fixture("user_info"), { tokenFile });
    const planned: string[] = [];
    const write = vi.spyOn(process.stderr, "write").mockImplementation((text) => {
      planned.push(String(text));
      return true;
    });

    try {
      expect(await run(["node", "edstem", "auth", "logout", "--dry-run", "--json"], runtime)).toBe(0);
    } finally {
      write.mockRestore();
    }

    expect(planned.join("")).toBe(`Remove the saved Ed token at ${tokenFile}.\n`);
    expect(stdout).toEqual([]);
    expect(await readFile(tokenFile, "utf8")).toBe("saved-token\n");
  });

  it("reports the token source for the environment and the token file", async () => {
    const tokenFile = await tokenPath("edstem-status-");
    await writeTokenFile(tokenFile);

    const environment = makeRuntime(200, false, fixture("user_info"), { tokenFile });
    vi.stubEnv("EDSTEM_TOKEN", "env-token");
    try {
      expect(await run(["node", "edstem", "auth", "status", "--json"], environment.runtime)).toBe(0);
    } finally {
      vi.unstubAllEnvs();
    }
    expect(JSON.parse(environment.stdout.join(""))).toMatchObject({
      authenticated: true,
      source: "environment",
      tokenFile,
    });

    const file = makeRuntime(200, false, fixture("user_info"), { tokenFile });
    vi.stubEnv("EDSTEM_TOKEN", undefined);
    try {
      expect(await run(["node", "edstem", "auth", "status", "--json"], file.runtime)).toBe(0);
    } finally {
      vi.unstubAllEnvs();
    }
    expect(JSON.parse(file.stdout.join(""))).toMatchObject({
      authenticated: true,
      source: "file",
      tokenFile,
      user: { id: 12345 },
    });
  });
});

async function writeTokenFile(tokenFile: string): Promise<void> {
  await mkdir(dirname(tokenFile), { mode: 0o700, recursive: true });
  await writeFile(tokenFile, "saved-token\n", { encoding: "utf8", mode: 0o600 });
}

function duplicateCourseIdentity(): unknown {
  const identity = fixture("user_info") as {
    courses: Array<{ course: Record<string, unknown>; role: Record<string, unknown> }>;
  };
  const enrollment = identity.courses[0];
  if (!enrollment) throw new Error("Expected a course fixture");
  identity.courses.push({
    course: {
      ...enrollment.course,
      id: 101,
      status: "archived",
      year: "2025",
    },
    role: { ...enrollment.role, course_id: 101 },
  });
  return identity;
}
