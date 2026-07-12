import { afterEach, describe, expect, it } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startFakeEdServer } from "../support/fake-ed-server.js";
import { startAppServer } from "../support/start-app-server.js";
import { extractCsrfToken, createTestRuntime } from "../support/test-runtime.js";
import { BrowserSession } from "../support/browser-session.js";
import { InMemoryOAuthClientProvider } from "../support/in-memory-oauth-client-provider.js";

describe("remote client e2e", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()?.();
    }
  });

  it("completes OAuth, uses MCP read and write tools, then reconnects Ed after expiry", async () => {
    const fakeEd = await startFakeEdServer([
      {
        answerResult: {
          correct: true,
          slide_completed: true,
          solution: [1]
        },
        courses: [
          {
            course: {
              code: "COMP101",
              id: 1,
              name: "Intro A",
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
      },
      {
        answerResult: {
          correct: true,
          slide_completed: true,
          solution: [1]
        },
        courses: [
          {
            course: {
              code: "COMP101",
              id: 1,
              name: "Intro Reconnected",
              session: "S1",
              status: "active",
              year: "2026"
            },
            role: { role: "student" }
          }
        ],
        token: "ed-token-b",
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

    const app = await startAppServer(runtime, {
      syncPublicBaseUrl: true
    });
    cleanups.push(async () => app.close());

    const browser = new BrowserSession();
    const oauthProvider = new InMemoryOAuthClientProvider({
      clientMetadata: {
        client_name: "Remote E2E Client",
        grant_types: ["authorization_code", "refresh_token"],
        redirect_uris: ["http://127.0.0.1/callback"],
        response_types: ["code"],
        token_endpoint_auth_method: "none"
      },
      redirectUrl: "http://127.0.0.1/callback"
    });

    const client = await connectAuthorizedClient(
      `${app.baseUrl}/mcp`,
      oauthProvider,
      browser,
      {
        edToken: "ed-token-a"
      }
    );
    cleanups.push(async () => client.close());

    const registeredUser = runtime.users.findByEmail("ada@example.com");
    expect(registeredUser).not.toBeNull();

    const courses = await callToolPayload(client, "list_courses", {
      includeArchived: false
    });
    expect(courses[0]?.name).toBe("Intro A");

    const answer = await callToolPayload(client, "submit_slide_answer", {
      choices: [2],
      questionId: 99
    });
    expect(answer.correct).toBe(true);
    expect(fakeEd.submissions.answers).toEqual([
      {
        amend: false,
        body: [1],
        questionId: 99,
        token: "ed-token-a"
      }
    ]);

    fakeEd.revokeToken("ed-token-a");

    const reconnectRequired = await callToolError(client, "list_courses", {
      includeArchived: false
    });
    expect(reconnectRequired.type).toBe("EDSTEM_REAUTH_REQUIRED");
    expect(reconnectRequired.reconnect_url).toBe(`${app.baseUrl}/reconnect`);
    expect(runtime.credentials.getConnectionStatus(registeredUser!.id)).toMatchObject({
      connected: true,
      isInvalid: true
    });

    await reconnectEd(browser, app.baseUrl, "ed-token-b");

    const reconnectedCourses = await callToolPayload(client, "list_courses", {
      includeArchived: false
    });
    expect(reconnectedCourses[0]?.name).toBe("Intro Reconnected");
    expect(runtime.credentials.getConnectionStatus(registeredUser!.id)).toMatchObject({
      connected: true,
      isInvalid: false
    });
  });
});

async function connectAuthorizedClient(
  mcpUrl: string,
  oauthProvider: InMemoryOAuthClientProvider,
  browser: BrowserSession,
  credentials: {
    edToken: string;
  }
): Promise<Client> {
  const client = new Client({
    name: "remote-e2e-client",
    version: "1.0.0"
  });
  let transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    authProvider: oauthProvider
  });

  try {
    await client.connect(transport);
    return client;
  } catch (error) {
    if (!(error instanceof UnauthorizedError)) {
      throw error;
    }

    const callbackUrl = await authorizeOAuthClient(browser, oauthProvider.authorizationUrl(), credentials);
    const code = callbackUrl.searchParams.get("code");
    expect(code).toBeTruthy();

    await transport.finishAuth(code!);
    await client.close();

    transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
      authProvider: oauthProvider
    });
    await client.connect(transport);
    return client;
  }
}

async function authorizeOAuthClient(
  browser: BrowserSession,
  authorizationUrl: URL,
  credentials: {
    edToken: string;
  }
): Promise<URL> {
  const page = await browser.fetch(authorizationUrl, {
    redirect: "manual"
  });
  expect(page.status).toBe(200);

  const csrfToken = extractCsrfToken(await page.text());
  const body = new URLSearchParams(authorizationUrl.searchParams);
  body.set("csrf_token", csrfToken);
  body.set("ed_token", credentials.edToken);
  body.set("accept_toc", "1");
  body.set("scope_read", "1");
  body.set("scope_write", "1");

  const response = await browser.fetch(new URL("/authorize", authorizationUrl), {
    body,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    method: "POST",
    redirect: "manual"
  });
  expect(response.status).toBe(302);

  const redirectLocation = response.headers.get("location");
  expect(redirectLocation).toBeTruthy();
  return new URL(redirectLocation!);
}

async function reconnectEd(
  browser: BrowserSession,
  baseUrl: string,
  edToken: string
): Promise<void> {
  const page = await browser.fetch(new URL("/reconnect", baseUrl), {
    redirect: "manual"
  });
  expect(page.status).toBe(200);

  const csrfToken = extractCsrfToken(await page.text());
  const response = await browser.fetch(new URL("/reconnect", baseUrl), {
    body: new URLSearchParams({
      csrf_token: csrfToken,
      ed_token: edToken
    }),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    method: "POST",
    redirect: "manual"
  });
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe("/settings");
}

async function callToolPayload(
  client: Client,
  name: string,
  args: Record<string, unknown>
): Promise<any> {
  const result = await client.callTool({
    arguments: args,
    name
  });

  expect(result.isError).toBeFalsy();
  return parseToolText(result);
}

async function callToolError(
  client: Client,
  name: string,
  args: Record<string, unknown>
): Promise<Record<string, any>> {
  const result = await client.callTool({
    arguments: args,
    name
  });

  expect(result.isError).toBe(true);
  const parsed = parseToolText(result) as { error?: Record<string, any> };
  return parsed.error ?? parsed;
}

function parseToolText(result: Awaited<ReturnType<Client["callTool"]>>): unknown {
  if ("content" in result) {
    const content = result.content as Array<{ text?: string; type: string }>;
    const text = content.find((part) => part.type === "text")?.text || "null";
    return JSON.parse(text);
  }

  return result.toolResult;
}
