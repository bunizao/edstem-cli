import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

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
  afterEach(() => {
    vi.useRealTimers();
  });

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

  it("rejects redirects before following an Ed-hosted file URL", async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(new Response(null, {
      headers: { location: "https://example.com/file.pdf" },
      status: 302,
    }));
    const client = new EdClient({ fetch, token: "secret" });

    await expect(client.fetchFile("https://static.edusercontent.com/files/slide-8"))
      .rejects.toThrow("Ed file downloads cannot redirect");
    expect(fetch.mock.calls[0]?.[1]?.redirect).toBe("manual");
  });

  it("rejects lookalike Ed file hosts before issuing a request", async () => {
    const fetch = vi.fn<FetchLike>();
    const client = new EdClient({ fetch, token: "secret" });

    await expect(client.fetchFile("https://edusercontent.com.example.com/file.pdf"))
      .rejects.toThrow("Only HTTPS files hosted on edusercontent.com");
    await expect(client.fetchFile("https://evil-edusercontent.com/file.pdf"))
      .rejects.toThrow("Only HTTPS files hosted on edusercontent.com");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("maps expired tokens without exposing the credential", async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(
      jsonResponse({ code: "bad_token", message: "invalid" }, 401)
    );
    const client = new EdClient({ fetch, token: "never-print-this" });

    await expect(client.fetchUser()).rejects.toBeInstanceOf(EdAuthExpiredError);
    await expect(client.fetchUser()).rejects.not.toThrow(/never-print-this/);
  });

  it("serves a repeated identity lookup from the memo", async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(jsonResponse(fixture("user_info")));
    const client = new EdClient({ fetch, token: "secret" });

    const [first, second] = await Promise.all([client.fetchUser(), client.fetchUser()]);
    await client.fetchUser();

    expect(fetch).toHaveBeenCalledOnce();
    expect(first).toBe(second);
  });

  it("refetches the identity after the memo expires", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<FetchLike>().mockImplementation(async () => jsonResponse(fixture("user_info")));
    const client = new EdClient({ fetch, token: "secret" });

    await client.fetchUser();
    vi.advanceTimersByTime(61_000);
    await client.fetchUser();

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not memoize a failed identity lookup", async () => {
    const fetch = vi.fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({ code: "bad_token" }, 401))
      .mockResolvedValueOnce(jsonResponse(fixture("user_info")));
    const client = new EdClient({ fetch, token: "secret" });

    await expect(client.fetchUser()).rejects.toBeInstanceOf(EdAuthExpiredError);
    await expect(client.fetchUser()).resolves.toMatchObject({ user: { id: 12345 } });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("retries a rate-limited read with exponential backoff", async () => {
    const fetch = vi.fn<FetchLike>()
      .mockResolvedValueOnce(jsonResponse({ message: "slow down" }, 429))
      .mockResolvedValueOnce(jsonResponse({ message: "gateway" }, 503))
      .mockResolvedValueOnce(jsonResponse(fixture("user_info")));
    const delays: number[] = [];
    const client = new EdClient({
      fetch,
      retryBaseDelayMs: 10,
      sleep: async (ms) => { delays.push(ms); },
      token: "secret",
    });

    await expect(client.fetchUser()).resolves.toMatchObject({ user: { id: 12345 } });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([10, 20]);
  });

  it("waits for a longer Retry-After header", async () => {
    const fetch = vi.fn<FetchLike>()
      .mockResolvedValueOnce(new Response("{}", { headers: { "retry-after": "5" }, status: 429 }))
      .mockResolvedValueOnce(jsonResponse(fixture("user_info")));
    const delays: number[] = [];
    const client = new EdClient({
      fetch,
      retryBaseDelayMs: 10,
      sleep: async (ms) => { delays.push(ms); },
      token: "secret",
    });

    await client.fetchUser();

    expect(delays).toEqual([5000]);
  });

  it("gives up after the configured retry count", async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({ message: "slow down" }, 429));
    const client = new EdClient({
      fetch,
      maxRetries: 2,
      retryBaseDelayMs: 10,
      sleep: async () => undefined,
      token: "secret",
    });

    await expect(client.fetchUser()).rejects.toThrow("HTTP 429");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("never retries a write", async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({ message: "slow down" }, 429));
    const sleep = vi.fn(async () => undefined);
    const client = new EdClient({ fetch, sleep, token: "secret" });

    await expect(client.submitSlide(42)).rejects.toThrow("HTTP 429");
    expect(fetch).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it.each([429, 503])("does not retry a new thread after HTTP %s", async (status) => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(jsonResponse({ message: "try later" }, status));
    const sleep = vi.fn(async () => undefined);
    const client = new EdClient({ fetch, sleep, token: "test-token" });

    await expect(client.createThread(100, {
      content: "<document><paragraph>Mock post</paragraph></document>",
      title: "Mock post",
      type: "post",
    })).rejects.toThrow(`HTTP ${status}`);
    expect(fetch).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("creates a thread with the Ed thread envelope", async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(
      jsonResponse({ thread: { id: 5001, number: 42, title: "Install Python", type: "question" } })
    );
    const client = new EdClient({ fetch, token: "secret" });

    const thread = await client.createThread(100, {
      category: "General",
      content: '<document version="2.0"><paragraph>Help</paragraph></document>',
      private: true,
      title: "Install Python",
      type: "question",
    });

    expect(thread).toMatchObject({ id: 5001, number: 42, title: "Install Python" });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://edstem.org/api/courses/100/threads");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      thread: {
        anonymous_comments: false,
        category: "General",
        content: '<document version="2.0"><paragraph>Help</paragraph></document>',
        is_anonymous: false,
        is_megathread: false,
        is_pinned: false,
        is_private: true,
        subcategory: "",
        subsubcategory: "",
        title: "Install Python",
        type: "question",
      },
    });
  });

  it("posts thread and comment replies to their own endpoints", async () => {
    const fetch = vi.fn<FetchLike>().mockImplementation(async () =>
      jsonResponse({ comment: { id: 9001, type: "answer", user_id: 7 } })
    );
    const client = new EdClient({ fetch, token: "secret" });
    const input = {
      content: '<document version="2.0"><paragraph>Try brew</paragraph></document>',
      type: "answer" as const,
    };

    expect(await client.createThreadReply(5001, input)).toMatchObject({ id: 9001, type: "answer" });
    await client.createCommentReply(9001, { ...input, anonymous: true, type: "comment" });

    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      "https://edstem.org/api/threads/5001/comments",
      "https://edstem.org/api/comments/9001/comments",
    ]);
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      comment: { content: input.content, is_anonymous: false, is_private: false, type: "answer" },
    });
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toEqual({
      comment: { content: input.content, is_anonymous: true, is_private: false, type: "comment" },
    });
  });

  it("marks a slide complete with an empty response", async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(new Response(null, { status: 204 }));
    const client = new EdClient({ fetch, token: "secret" });

    await client.completeSlide(42);

    expect(fetch.mock.calls[0]?.[1]?.method).toBe("PUT");
  });
});
