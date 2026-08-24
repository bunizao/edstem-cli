import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { EdAuthExpiredError, EdClient, type FetchLike } from "../src/ed/client.js";

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`fixtures/${name}.json`, import.meta.url), "utf8"));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("EdClient", () => {
  it("fetches identity with one authenticated request", async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(jsonResponse(fixture("user_info")));
    const client = new EdClient({ apiBaseUrl: "https://ed.example/api", fetch, token: "secret" });

    const identity = await client.fetchUser();

    expect(identity.user.email).toBe("alice@university.edu");
    expect(identity.courses).toHaveLength(2);
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://ed.example/api/user");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer secret");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("calls the default fetch with the global receiver", async () => {
    const fetch = vi.fn<FetchLike>(function (this: unknown) {
      expect(this).toBe(globalThis);
      return Promise.resolve(jsonResponse(fixture("user_info")));
    });
    vi.stubGlobal("fetch", fetch);

    try {
      const client = new EdClient({ apiBaseUrl: "https://ed.example/api", token: "secret" });
      await client.fetchUser();
    } finally {
      vi.unstubAllGlobals();
    }

    expect(fetch).toHaveBeenCalledOnce();
  });

  it("parses nested thread authors and comments", async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(jsonResponse(fixture("thread_detail")));
    const client = new EdClient({ fetch, token: "secret" });

    const thread = await client.fetchThread(5001);

    expect(thread.author?.name).toBe("Alice Student");
    expect(thread.answers[0]?.author?.courseRole).toBe("tutor");
    expect(thread.answers[0]?.comments[0]?.document).toBe("Thanks, that worked!");
  });

  it("parses slide content from nested passage data", async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(
      jsonResponse({
        slide: {
          id: 8,
          index: 2,
          data: { passage: "Read this" },
          file_url: "https://static.edusercontent.com/files/slide-8",
        },
      })
    );
    const client = new EdClient({ fetch, token: "secret" });

    const slide = await client.fetchSlide(8, { view: true });

    expect(slide.content).toBe("Read this");
    expect(slide.fileUrl).toBe("https://static.edusercontent.com/files/slide-8");
    expect(String(fetch.mock.calls[0]?.[0])).toContain("lessons/slides/8?view=1");
  });

  it("downloads only trusted Ed-hosted HTTPS files without forwarding the token", async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(new Response("pdf", { status: 200 }));
    const client = new EdClient({ fetch, token: "secret" });

    await client.fetchFile("https://static.edusercontent.com/files/slide-8");

    expect(fetch.mock.calls[0]?.[1]?.headers).toEqual({ Accept: "*/*" });
    await expect(client.fetchFile("https://example.com/file.pdf")).rejects.toThrow(
      "Only HTTPS files hosted on edusercontent.com"
    );
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("maps expired tokens without exposing the credential", async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(
      jsonResponse({ code: "bad_token", message: "invalid" }, 401)
    );
    const client = new EdClient({ fetch, token: "never-print-this" });

    await expect(client.fetchUser()).rejects.toBeInstanceOf(EdAuthExpiredError);
    await expect(client.fetchUser()).rejects.not.toThrow(/never-print-this/);
  });

  it("marks a slide complete with an empty response", async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(new Response(null, { status: 204 }));
    const client = new EdClient({ fetch, token: "secret" });

    await client.completeSlide(42);

    expect(fetch.mock.calls[0]?.[1]?.method).toBe("PUT");
  });
});
