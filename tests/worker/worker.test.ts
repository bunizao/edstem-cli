import { afterEach, describe, expect, it } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import worker, { type WorkerEnv } from "../../src/worker.js";
import { startFakeEdServer } from "../remote/support/fake-ed-server.js";

const MODERN_PROTOCOL_VERSION = "2026-07-28";
const CLIENT_META = {
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": {
    name: "worker-test",
    version: "1.0.0"
  },
  "io.modelcontextprotocol/protocolVersion": MODERN_PROTOCOL_VERSION
};

describe("Cloudflare Worker MCP", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()?.();
    }
  });

  it("rejects MCP requests without a static credential", async () => {
    const response = await fetchWorker(
      modernRequest("tools/list", {
        _meta: CLIENT_META
      }),
      { ED_API_BASE_URL: "https://edstem.org/api/" }
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("Bearer");
    expect(await response.json() as any).toEqual({
      error: "unauthorized",
      error_description: "Bearer token or X-API-Key is required."
    });
  });

  it("serves modern stateless requests with a Bearer access token", async () => {
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
        token: "ed-access-token",
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
    const env = { ED_API_BASE_URL: fakeEd.baseUrl };

    const discoverResponse = await fetchWorker(
      modernRequest(
        "server/discover",
        { _meta: CLIENT_META },
        { Authorization: "Bearer ed-access-token" }
      ),
      env
    );
    expect(discoverResponse.status).toBe(200);
    expect(discoverResponse.headers.get("mcp-session-id")).toBeNull();
    const discoverPayload = await discoverResponse.json() as any;
    expect(discoverPayload.result.supportedVersions).toContain(MODERN_PROTOCOL_VERSION);
    expect(discoverPayload.result.resultType).toBe("complete");

    const listResponse = await fetchWorker(
      modernRequest(
        "tools/list",
        { _meta: CLIENT_META },
        { Authorization: "Bearer ed-access-token" }
      ),
      env
    );
    expect(listResponse.status).toBe(200);
    expect(listResponse.headers.get("mcp-session-id")).toBeNull();
    const listPayload = await listResponse.json() as any;
    expect(listPayload.result.tools.some((tool: any) => tool.name === "list_courses")).toBe(true);

    const callResponse = await fetchWorker(
      modernRequest(
        "tools/call",
        {
          _meta: CLIENT_META,
          arguments: { includeArchived: false },
          name: "list_courses"
        },
        {
          Authorization: "Bearer ed-access-token",
          "Mcp-Name": "list_courses"
        }
      ),
      env
    );
    expect(callResponse.status).toBe(200);
    const callPayload = await callResponse.json() as any;
    expect(JSON.parse(callPayload.result.content[0].text)[0].name).toBe("Intro");
  });

  it("accepts X-API-Key and rejects invalid Ed credentials", async () => {
    const fakeEd = await startFakeEdServer([
      {
        courses: [],
        token: "valid-api-key",
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
    const env = { ED_API_BASE_URL: fakeEd.baseUrl };

    const accepted = await fetchWorker(
      modernRequest("tools/list", { _meta: CLIENT_META }, { "X-API-Key": "valid-api-key" }),
      env
    );
    expect(accepted.status).toBe(200);

    const rejected = await fetchWorker(
      modernRequest("tools/list", { _meta: CLIENT_META }, { "X-API-Key": "invalid" }),
      env
    );
    expect(rejected.status).toBe(401);
    expect(await rejected.json() as any).toEqual({
      error: "invalid_token",
      error_description: "The Ed access token or API key is invalid."
    });
  });

  it("keeps 2025 Streamable HTTP clients working without a session", async () => {
    const fakeEd = await startFakeEdServer([
      {
        courses: [
          {
            course: {
              code: "COMP101",
              id: 1,
              name: "Legacy Compatible",
              session: "S1",
              status: "active",
              year: "2026"
            },
            role: { role: "student" }
          }
        ],
        token: "legacy-token",
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

    const server = Bun.serve({
      fetch: (request) => worker.fetch(
        request,
        { ED_API_BASE_URL: fakeEd.baseUrl },
        executionContext()
      ),
      port: 0
    });
    cleanups.push(async () => server.stop(true));

    const client = new Client({ name: "legacy-client", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${server.port}/mcp`),
      {
        requestInit: {
          headers: { Authorization: "Bearer legacy-token" }
        }
      }
    );
    await client.connect(transport);
    cleanups.push(async () => client.close());

    const result = await client.callTool({
      arguments: { includeArchived: false },
      name: "list_courses"
    });
    const content = result.content as Array<{ text?: string; type: string }>;
    const text = content.find((part) => part.type === "text")?.text || "[]";
    expect(JSON.parse(text)[0].name).toBe("Legacy Compatible");
  });
});

function modernRequest(
  method: string,
  params: Record<string, unknown>,
  headers: HeadersInit = {}
): Request {
  return new Request("https://edstem-mcp.example.workers.dev/mcp", {
    body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }),
    headers: {
      "Content-Type": "application/json",
      Host: "edstem-mcp.example.workers.dev",
      "MCP-Protocol-Version": MODERN_PROTOCOL_VERSION,
      "Mcp-Method": method,
      ...headers
    },
    method: "POST"
  });
}

function fetchWorker(request: Request, env: WorkerEnv): Promise<Response> {
  return worker.fetch(request, env, executionContext());
}

function executionContext(): ExecutionContext {
  return {
    passThroughOnException() {},
    waitUntil() {}
  } as unknown as ExecutionContext;
}
