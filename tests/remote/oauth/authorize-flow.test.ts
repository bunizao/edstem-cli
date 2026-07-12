import { afterEach, describe, expect, it } from "bun:test";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";

import { startFakeEdServer } from "../support/fake-ed-server.js";
import { startAppServer } from "../support/start-app-server.js";
import { createTestRuntime, extractCsrfToken } from "../support/test-runtime.js";

const TEST_CLIENT: OAuthClientInformationFull = {
  client_id: "test-client",
  client_name: "Test Client",
  grant_types: ["authorization_code", "refresh_token"],
  redirect_uris: ["http://127.0.0.1/callback"],
  response_types: ["code"],
  token_endpoint_auth_method: "none"
};

describe("oauth authorize flow", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()?.();
    }
  });

  it("signs up a user, verifies the Ed token, and issues an authorization code", async () => {
    const fakeEd = await startFakeEdServer([
      {
        courses: [
          {
            course: {
              code: "COMP101",
              id: 1,
              name: "Intro",
              session: "S1",
              status: "active",
              year: "2026"
            },
            role: { role: "student" }
          }
        ],
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

    const { runtime, cleanup } = await createTestRuntime({
      apiBaseUrl: fakeEd.baseUrl
    });
    cleanups.push(cleanup);
    runtime.store.saveClient(TEST_CLIENT);

    const app = await startAppServer(runtime);
    cleanups.push(async () => app.close());

    const page = await fetch(
      `${app.baseUrl}/authorize?${new URLSearchParams({
        client_id: TEST_CLIENT.client_id,
        code_challenge: "challenge",
        code_challenge_method: "S256",
        redirect_uri: TEST_CLIENT.redirect_uris[0]!,
        response_type: "code",
        scope: "mcp:tools.read mcp:tools.write"
      })}`
    );
    expect(page.status).toBe(200);

    const csrfToken = extractCsrfToken(await page.text());
    const response = await fetch(`${app.baseUrl}/authorize`, {
      body: new URLSearchParams({
        client_id: TEST_CLIENT.client_id,
        code_challenge: "challenge",
        code_challenge_method: "S256",
        csrf_token: csrfToken,
        ed_token: "ed-token-a",
        redirect_uri: TEST_CLIENT.redirect_uris[0]!,
        response_type: "code",
        scope: "mcp:tools.read mcp:tools.write",
        accept_toc: "1",
        scope_read: "1",
        scope_write: "1"
      }),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: page.headers.get("set-cookie") ?? ""
      },
      method: "POST",
      redirect: "manual"
    });
    expect(response.status).toBe(302);

    const redirect = new URL(response.headers.get("location")!, "http://127.0.0.1");
    const code = redirect.searchParams.get("code");
    expect(code).toBeTruthy();
    expect(runtime.users.findByEmail("ada@example.com")).not.toBeNull();
    expect(runtime.credentials.getConnectionStatus(1)).toMatchObject({
      connected: true,
      edUserName: "Ada"
    });

    const tokens = await runtime.oauthProvider.exchangeAuthorizationCode(
      TEST_CLIENT,
      code!,
      undefined,
      TEST_CLIENT.redirect_uris[0]!
    );
    expect(tokens.scope).toBe("mcp:tools.read mcp:tools.write");
  });

  it("rejects invalid Ed tokens without persisting the account", async () => {
    const fakeEd = await startFakeEdServer([]);
    cleanups.push(fakeEd.close);

    const { runtime, cleanup } = await createTestRuntime({
      apiBaseUrl: fakeEd.baseUrl
    });
    cleanups.push(cleanup);
    runtime.store.saveClient(TEST_CLIENT);

    const app = await startAppServer(runtime);
    cleanups.push(async () => app.close());

    const page = await fetch(
      `${app.baseUrl}/authorize?${new URLSearchParams({
        client_id: TEST_CLIENT.client_id,
        code_challenge: "challenge",
        code_challenge_method: "S256",
        redirect_uri: TEST_CLIENT.redirect_uris[0]!,
        response_type: "code",
        scope: "mcp:tools.read"
      })}`
    );
    expect(page.status).toBe(200);

    const csrfToken = extractCsrfToken(await page.text());
    const response = await fetch(`${app.baseUrl}/authorize`, {
      body: new URLSearchParams({
        client_id: TEST_CLIENT.client_id,
        code_challenge: "challenge",
        code_challenge_method: "S256",
        csrf_token: csrfToken,
        ed_token: "bad-token",
        redirect_uri: TEST_CLIENT.redirect_uris[0]!,
        response_type: "code",
        scope: "mcp:tools.read",
        accept_toc: "1",
        scope_read: "1"
      }),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: page.headers.get("set-cookie") ?? ""
      },
      method: "POST"
    });
    expect(response.status).toBe(422);

    expect(runtime.users.findByEmail("ada@example.com")).toBeNull();
  });

  it("requires Terms of Service consent before issuing authorization", async () => {
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

    const { runtime, cleanup } = await createTestRuntime({
      apiBaseUrl: fakeEd.baseUrl
    });
    cleanups.push(cleanup);
    runtime.store.saveClient(TEST_CLIENT);

    const app = await startAppServer(runtime);
    cleanups.push(async () => app.close());

    const page = await fetch(
      `${app.baseUrl}/authorize?${new URLSearchParams({
        client_id: TEST_CLIENT.client_id,
        code_challenge: "challenge",
        code_challenge_method: "S256",
        redirect_uri: TEST_CLIENT.redirect_uris[0]!,
        response_type: "code",
        scope: "mcp:tools.read"
      })}`
    );
    expect(page.status).toBe(200);

    const csrfToken = extractCsrfToken(await page.text());
    const response = await fetch(`${app.baseUrl}/authorize`, {
      body: new URLSearchParams({
        client_id: TEST_CLIENT.client_id,
        code_challenge: "challenge",
        code_challenge_method: "S256",
        csrf_token: csrfToken,
        ed_token: "ed-token-a",
        redirect_uri: TEST_CLIENT.redirect_uris[0]!,
        response_type: "code",
        scope: "mcp:tools.read",
        scope_read: "1"
      }),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: page.headers.get("set-cookie") ?? ""
      },
      method: "POST"
    });

    expect(response.status).toBe(422);
    expect(await response.text()).toContain("Terms of Service");
  });
});
