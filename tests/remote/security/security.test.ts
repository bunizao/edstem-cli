import { afterEach, describe, expect, it } from "bun:test";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";

import { buildCsrfCookie } from "../../../src/remote/oauth/csrf.js";
import { buildSessionCookie } from "../../../src/remote/oauth/session.js";
import type { Logger } from "../../../src/remote/logger.js";
import { startFakeEdServer } from "../support/fake-ed-server.js";
import { startAppServer } from "../support/start-app-server.js";
import { BrowserSession } from "../support/browser-session.js";
import { createTestRuntime, extractCsrfToken, upsertTestUser } from "../support/test-runtime.js";

const TEST_CLIENT: OAuthClientInformationFull = {
  client_id: "test-client",
  client_name: "Test Client",
  grant_types: ["authorization_code", "refresh_token"],
  redirect_uris: ["http://127.0.0.1/callback"],
  response_types: ["code"],
  token_endpoint_auth_method: "none"
};

describe("security hardening", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()?.();
    }
  });

  it("sets secure cookies and anti-embedding headers for https deployments", async () => {
    const fakeEd = await startFakeEdServer([]);
    cleanups.push(fakeEd.close);

    const { runtime, cleanup } = await createTestRuntime({
      apiBaseUrl: fakeEd.baseUrl,
      publicBaseUrl: "https://mcp.example.test"
    });
    cleanups.push(cleanup);
    runtime.store.saveClient(TEST_CLIENT);

    const app = await startAppServer(runtime);
    cleanups.push(async () => app.close());

    const response = await fetch(
      `${app.baseUrl}/authorize?${new URLSearchParams({
        client_id: TEST_CLIENT.client_id,
        code_challenge: "challenge",
        code_challenge_method: "S256",
        redirect_uri: TEST_CLIENT.redirect_uris[0]!,
        response_type: "code",
        scope: "mcp:tools.read"
      })}`
    );

    expect(response.status).toBe(200);
    expect(readSetCookies(response.headers).some((cookie) => cookie.includes("Secure"))).toBe(
      true
    );
    expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("serves protected resource metadata from both root and MCP-specific paths", async () => {
    const fakeEd = await startFakeEdServer([]);
    cleanups.push(fakeEd.close);

    const { runtime, cleanup } = await createTestRuntime({
      apiBaseUrl: fakeEd.baseUrl
    });
    cleanups.push(cleanup);

    const app = await startAppServer(runtime);
    cleanups.push(async () => app.close());

    const rootResponse = await fetch(`${app.baseUrl}/.well-known/oauth-protected-resource`);
    const mcpResponse = await fetch(`${app.baseUrl}/.well-known/oauth-protected-resource/mcp`);

    expect(rootResponse.status).toBe(200);
    expect(mcpResponse.status).toBe(200);

    const rootMetadata = await rootResponse.json();
    const mcpMetadata = await mcpResponse.json();

    expect(rootMetadata).toEqual(mcpMetadata);
    expect(rootMetadata).toMatchObject({
      authorization_servers: [runtime.config.oauth.issuerUrl.href],
      resource: runtime.config.oauth.mcpServerUrl.href
    });
  });

  it("clears expired session cookies on protected pages", async () => {
    const fakeEd = await startFakeEdServer([]);
    cleanups.push(fakeEd.close);

    const { runtime, cleanup } = await createTestRuntime({
      apiBaseUrl: fakeEd.baseUrl
    });
    cleanups.push(cleanup);

    const user = upsertTestUser(runtime, {
      email: "ada@example.com",
      id: 101,
      name: "Ada"
    });
    const expiredSessionCookie = buildSessionCookie(
      {
        displayName: "Ada",
        email: user.email,
        expiresAt: Date.now() - 5_000,
        userId: user.id
      },
      runtime.config.oauth
    );

    const app = await startAppServer(runtime);
    cleanups.push(async () => app.close());

    const response = await fetch(`${app.baseUrl}/settings`, {
      headers: {
        Cookie: cookieHeader(expiredSessionCookie)
      }
    });

    expect(response.status).toBe(401);
    const body = await response.text();
    expect(body).toContain("session expired");

    const setCookies = readSetCookies(response.headers);
    expect(
      setCookies.some(
        (cookie) =>
          cookie.startsWith(`${runtime.config.oauth.sessionCookieName}=`) &&
          cookie.includes("Max-Age=0")
      )
    ).toBe(true);
    expect(
      setCookies.some(
        (cookie) => cookie.startsWith("edstem_mcp_csrf=") && cookie.includes("Max-Age=0")
      )
    ).toBe(true);
  });

  it("throttles repeated reconnect token attempts", async () => {
    const fakeEd = await startFakeEdServer([]);
    cleanups.push(fakeEd.close);

    const { runtime, cleanup } = await createTestRuntime({
      apiBaseUrl: fakeEd.baseUrl
    });
    cleanups.push(cleanup);

    const user = upsertTestUser(runtime, {
      email: "ada@example.com",
      id: 101,
      name: "Ada"
    });
    const sessionCookie = buildSessionCookie(
      {
        displayName: "Ada",
        email: user.email,
        expiresAt: Date.now() + runtime.config.oauth.sessionTtlSeconds * 1000,
        userId: user.id
      },
      runtime.config.oauth
    );
    const csrfCookie = buildCsrfCookie(runtime.config.oauth, "csrf-token");

    const app = await startAppServer(runtime);
    cleanups.push(async () => app.close());

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await submitReconnect(app.baseUrl, cookieHeader(sessionCookie, csrfCookie), `bad-token-${attempt}`);
      expect(response.status).toBe(422);
    }

    const blocked = await submitReconnect(
      app.baseUrl,
      cookieHeader(sessionCookie, csrfCookie),
      "bad-token-final"
    );
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
    expect(await blocked.text()).toContain("Too many Ed token attempts");
  });

  it("rejects reconnecting with a token from a different Ed account", async () => {
    const fakeEd = await startFakeEdServer([
      {
        courses: [],
        token: "ed-token-b",
        user: {
          avatar: "",
          course_role: "student",
          email: "grace@example.com",
          id: 202,
          name: "Grace",
          role: "student"
        }
      }
    ]);
    cleanups.push(fakeEd.close);

    const { runtime, cleanup } = await createTestRuntime({
      apiBaseUrl: fakeEd.baseUrl
    });
    cleanups.push(cleanup);

    const user = upsertTestUser(runtime, {
      email: "ada@example.com",
      id: 101,
      name: "Ada"
    });
    const sessionCookie = buildSessionCookie(
      {
        displayName: "Ada",
        email: user.email,
        expiresAt: Date.now() + runtime.config.oauth.sessionTtlSeconds * 1000,
        userId: user.id
      },
      runtime.config.oauth
    );
    const csrfCookie = buildCsrfCookie(runtime.config.oauth, "csrf-token");

    const app = await startAppServer(runtime);
    cleanups.push(async () => app.close());

    const response = await submitReconnect(
      app.baseUrl,
      cookieHeader(sessionCookie, csrfCookie),
      "ed-token-b"
    );
    expect(response.status).toBe(422);
    expect(await response.text()).toContain("different Ed account");
  });

  it("throttles repeated authorize attempts from the same identity", async () => {
    const fakeEd = await startFakeEdServer([]);
    cleanups.push(fakeEd.close);

    const memoryLogger = createMemoryLogger();
    const { runtime, cleanup } = await createTestRuntime({
      apiBaseUrl: fakeEd.baseUrl,
      logger: memoryLogger.logger
    });
    cleanups.push(cleanup);
    runtime.store.saveClient(TEST_CLIENT);

    const app = await startAppServer(runtime);
    cleanups.push(async () => app.close());

    const browser = new BrowserSession();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await submitAuthorize(browser, app.baseUrl, "bad-token");
      expect(response.status).toBe(422);
    }

    const blocked = await submitAuthorize(browser, app.baseUrl, "bad-token");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
    expect(await blocked.text()).toContain("Too many attempts");
    expect(
      memoryLogger.entries.some(
        (entry) =>
          entry.message === "oauth authorize attempt throttled" &&
          entry.fields.event === "oauth.authorize.attempt_throttled" &&
          typeof entry.fields.attemptKey === "string" &&
          typeof entry.fields.resetInSec === "number" &&
          entry.fields.hasEdToken === true &&
          entry.fields.hasTosConsent === true
      )
    ).toBe(true);
  });

  it("writes oauth audit logs for denied and approved authorization attempts", async () => {
    const fakeEd = await startFakeEdServer([
      {
        courses: [],
        token: "ed-token-a",
        user: {
          avatar: "",
          course_role: "student",
          email: "ada@example.com",
          id: 101,
          name: "Ada",
          role: "student"
        }
      }
    ]);
    cleanups.push(fakeEd.close);

    const memoryLogger = createMemoryLogger();
    const { runtime, cleanup } = await createTestRuntime({
      apiBaseUrl: fakeEd.baseUrl,
      logger: memoryLogger.logger
    });
    cleanups.push(cleanup);
    runtime.store.saveClient(TEST_CLIENT);

    const app = await startAppServer(runtime);
    cleanups.push(async () => app.close());

    const browser = new BrowserSession();
    const denied = await submitAuthorize(browser, app.baseUrl, "bad-token");
    expect(denied.status).toBe(422);

    const approved = await submitAuthorize(browser, app.baseUrl, "ed-token-a");
    expect(approved.status).toBe(302);

    expect(
      memoryLogger.entries.some(
        (entry) =>
          entry.message === "oauth authorize denied" &&
          entry.fields.event === "oauth.authorize.denied" &&
          entry.fields.errorCode === "invalid_ed_token"
      )
    ).toBe(true);
    expect(
      memoryLogger.entries.some(
        (entry) =>
          entry.message === "oauth authorize approved" &&
          entry.fields.event === "oauth.authorize.approved"
      )
    ).toBe(true);
  });
});

async function submitAuthorize(
  browser: BrowserSession,
  baseUrl: string,
  edToken: string
): Promise<Response> {
  const page = await browser.fetch(
    `${baseUrl}/authorize?${new URLSearchParams({
      client_id: TEST_CLIENT.client_id,
      code_challenge: "challenge",
      code_challenge_method: "S256",
      redirect_uri: TEST_CLIENT.redirect_uris[0]!,
      response_type: "code",
      scope: "mcp:tools.read"
    })}`,
    {
      redirect: "manual"
    }
  );
  expect(page.status).toBe(200);

  const csrfToken = extractCsrfToken(await page.text());
  return browser.fetch(`${baseUrl}/authorize`, {
    body: new URLSearchParams({
      client_id: TEST_CLIENT.client_id,
      code_challenge: "challenge",
      code_challenge_method: "S256",
      csrf_token: csrfToken,
      ed_token: edToken,
      redirect_uri: TEST_CLIENT.redirect_uris[0]!,
      response_type: "code",
      scope: "mcp:tools.read",
      accept_toc: "1",
      scope_read: "1"
    }),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    method: "POST",
    redirect: "manual"
  });
}

async function submitReconnect(
  baseUrl: string,
  cookie: string,
  edToken: string
): Promise<Response> {
  return fetch(`${baseUrl}/reconnect`, {
    body: new URLSearchParams({
      csrf_token: "csrf-token",
      ed_token: edToken
    }),
    headers: {
      Cookie: cookie,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    method: "POST",
    redirect: "manual"
  });
}

function cookieHeader(...cookies: string[]): string {
  return cookies
    .map((cookie) => cookie.split(";", 1)[0] ?? "")
    .filter(Boolean)
    .join("; ");
}

function readSetCookies(headers: Headers): string[] {
  const maybeHeaders = headers as Headers & { getSetCookie?: () => string[] };
  return typeof maybeHeaders.getSetCookie === "function"
    ? maybeHeaders.getSetCookie()
    : [];
}

function createMemoryLogger(): {
  entries: Array<{ fields: Record<string, unknown>; level: string; message: string }>;
  logger: Logger;
} {
  const entries: Array<{ fields: Record<string, unknown>; level: string; message: string }> = [];

  const push =
    (level: string) =>
    (fields?: Record<string, unknown>, message?: string): void => {
      entries.push({
        fields: fields ?? {},
        level,
        message: message ?? ""
      });
    };

  return {
    entries,
    logger: {
      debug: push("debug"),
      error: push("error"),
      info: push("info"),
      warn: push("warn")
    }
  };
}
