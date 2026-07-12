import { afterEach, describe, expect, it } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { startFakeEdServer } from "../support/fake-ed-server.js";
import { createTestRuntime, issueAccessToken, upsertTestUser } from "../support/test-runtime.js";
import { startAppServer } from "../support/start-app-server.js";

describe("mcp integration", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()?.();
    }
  });

  it("isolates Ed data per user", async () => {
    const fakeEd = await startFakeEdServer([
      {
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
        courses: [
          {
            course: {
              code: "COMP202",
              id: 2,
              name: "Intro B",
              session: "S2",
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

    const userA = upsertTestUser(runtime, {
      email: "ada@example.com",
      id: 101,
      name: "Ada"
    });
    const userB = upsertTestUser(runtime, {
      email: "grace@example.com",
      id: 202,
      name: "Grace"
    });
    await runtime.credentials.connect(userA.id, "ed-token-a");
    await runtime.credentials.connect(userB.id, "ed-token-b");

    const tokenA = issueAccessToken(runtime, {
      scopes: ["mcp:tools.read"],
      userId: userA.id,
      username: userA.email
    });
    const tokenB = issueAccessToken(runtime, {
      scopes: ["mcp:tools.read"],
      userId: userB.id,
      username: userB.email
    });

    const server = await startAppServer(runtime);
    cleanups.push(async () => server.close());
    const baseUrl = server.baseUrl;

    const coursesA = await callTool(baseUrl, tokenA, "list_courses", {
      includeArchived: false
    });
    const coursesB = await callTool(baseUrl, tokenB, "list_courses", {
      includeArchived: false
    });

    expect(coursesA[0]?.name).toBe("Intro A");
    expect(coursesB[0]?.name).toBe("Intro B");
  });

  it("rejects write tools without write scope and accepts them with it", async () => {
    const fakeEd = await startFakeEdServer([
      {
        answerResult: {
          correct: true,
          slide_completed: true,
          solution: [1]
        },
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

    const user = upsertTestUser(runtime, {
      email: "ada@example.com",
      id: 101,
      name: "Ada"
    });
    await runtime.credentials.connect(user.id, "ed-token-a");

    const readToken = issueAccessToken(runtime, {
      scopes: ["mcp:tools.read"],
      userId: user.id,
      username: user.email
    });
    const writeToken = issueAccessToken(runtime, {
      scopes: ["mcp:tools.read", "mcp:tools.write"],
      userId: user.id,
      username: user.email
    });

    const server = await startAppServer(runtime);
    cleanups.push(async () => server.close());
    const baseUrl = server.baseUrl;

    const denied = await callTool(baseUrl, readToken, "submit_slide_answer", {
      choices: [2],
      questionId: 99
    });
    expect(denied.type).toBe("INSUFFICIENT_SCOPE");

    const accepted = await callTool(baseUrl, writeToken, "submit_slide_answer", {
      choices: [2],
      questionId: 99
    });
    expect(accepted.correct).toBe(true);
    expect(fakeEd.submissions.answers).toEqual([
      {
        amend: false,
        body: [1],
        questionId: 99,
        token: "ed-token-a"
      }
    ]);

    const submitted = await callTool(baseUrl, writeToken, "submit_slide", {
      slideId: 50
    });
    expect(submitted.submitted).toBe(true);
    expect(fakeEd.submissions.slides).toEqual([
      {
        slideId: 50,
        token: "ed-token-a"
      }
    ]);
  });
});

async function callTool(
  baseUrl: string,
  token: string,
  name: string,
  args: Record<string, unknown>
): Promise<any> {
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL("/mcp", baseUrl), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  });

  try {
    await client.connect(transport);
    const result = await client.callTool({
      arguments: args,
      name
    });
    const content = result.content as Array<{ text?: string; type: string }>;

    if (result.isError) {
      const errorText = content.find((part) => part.type === "text")?.text || "{}";
      const parsed = JSON.parse(errorText) as { error?: unknown };
      return parsed.error ?? parsed;
    }

    const text = content.find((part) => part.type === "text")?.text || "null";
    return JSON.parse(text);
  } finally {
    await transport.close();
  }
}
