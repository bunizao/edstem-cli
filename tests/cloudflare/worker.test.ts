import { exportJWK, generateKeyPair, SignJWT, type KeyLike } from "jose";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { createWorker, type CloudflareEnv } from "../../src/cloudflare/worker.js";
import type { AccessFetch } from "../../src/cloudflare/access.js";

const TEAM_DOMAIN = "https://test.cloudflareaccess.com";
const AUDIENCE = "test-access-audience";
const OWNER_EMAIL = "owner@example.com";
const ED_TOKEN = "ed-secret-token";

let privateKey: KeyLike;
let otherPrivateKey: KeyLike;
let jwks: { keys: Array<Record<string, unknown>> };

beforeAll(async () => {
  const signing = await generateKeyPair("RS256");
  const other = await generateKeyPair("RS256");
  privateKey = signing.privateKey;
  otherPrivateKey = other.privateKey;
  jwks = { keys: [{ ...(await exportJWK(signing.publicKey)), alg: "RS256", kid: "test-key" }] };
});

describe("Cloudflare Worker MCP adapter", () => {
  it("rejects unsupported routes and methods before authentication", async () => {
    const harness = createHarness();

    const missing = await harness.request("https://mcp.example.com/nope", { method: "POST" });
    const method = await harness.request("https://mcp.example.com/mcp", { method: "GET" });

    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Not found." });
    expect(method.status).toBe(405);
    expect(method.headers.get("allow")).toBe("POST");
  });

  it("requires a Cloudflare Access assertion", async () => {
    const response = await createHarness().mcp(initializeRequest());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized." });
  });

  it.each([
    ["invalid signature", () => signAssertion({ key: otherPrivateKey })],
    ["wrong issuer", () => signAssertion({ issuer: "https://other.cloudflareaccess.com" })],
    ["wrong audience", () => signAssertion({ audience: "other-audience" })],
    ["expired assertion", () => signAssertion({ expirationTime: "-1 minute" })],
    ["not-yet-valid assertion", () => signAssertion({ notBefore: "10 minutes" })],
    ["missing email", () => signAssertion({ email: undefined })],
    ["non-owner identity", () => signAssertion({ email: "other@example.com" })],
  ])("rejects %s", async (_name, createAssertion) => {
    const response = await createHarness().mcp(initializeRequest(), await createAssertion());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized." });
  });

  it("initializes and lists tools without creating MCP sessions", async () => {
    const harness = createHarness();
    const assertion = await signAssertion();

    const initialized = await harness.mcp(initializeRequest(), assertion);
    const listed = await harness.mcp(rpcRequest(2, "tools/list"), assertion);
    const listPayload = await listed.json() as RpcResponse;

    expect(initialized.status).toBe(200);
    expect(initialized.headers.get("mcp-session-id")).toBeNull();
    expect((await initialized.json() as RpcResponse).result).toHaveProperty("serverInfo");
    expect(listed.status).toBe(200);
    expect(listed.headers.get("mcp-session-id")).toBeNull();
    expect((listPayload.result as { tools: Array<{ name: string }> }).tools)
      .toEqual(expect.arrayContaining([expect.objectContaining({ name: "get_user" })]));
  });

  it("calls Ed with only the configured Ed credential", async () => {
    const harness = createHarness();
    const assertion = await signAssertion();
    const response = await harness.mcp(
      rpcRequest(3, "tools/call", { arguments: {}, name: "get_user" }),
      assertion
    );
    const payload = await response.json() as RpcResponse;
    const text = ((payload.result as ToolResult).content[0] as { text: string }).text;

    expect(response.status).toBe(200);
    expect(JSON.parse(text)).toHaveProperty("email", OWNER_EMAIL);
    expect(harness.edRequests).toHaveLength(1);
    expect(harness.edRequests[0]?.headers.get("authorization")).toBe(`Bearer ${ED_TOKEN}`);
    expect(harness.edRequests[0]?.headers.get("cf-access-jwt-assertion")).toBeNull();
    expect(JSON.stringify(payload)).not.toContain(ED_TOKEN);
    expect(JSON.stringify(payload)).not.toContain(assertion);
  });

  it("blocks writes by default and allows explicit write opt-in", async () => {
    const assertion = await signAssertion();
    const body = rpcRequest(4, "tools/call", {
      arguments: { choices: [1], questionId: 2 },
      name: "submit_slide_answer",
    });
    const readOnly = createHarness();
    const writable = createHarness({ MCP_WRITE_ENABLED: "true" });

    const blockedPayload = await (await readOnly.mcp(body, assertion)).json() as RpcResponse;
    const allowedPayload = await (await writable.mcp(body, assertion)).json() as RpcResponse;
    const blocked = JSON.parse(((blockedPayload.result as ToolResult).content[0] as { text: string }).text);

    expect(blockedPayload.result).toHaveProperty("isError", true);
    expect(blocked).toHaveProperty("error.type", "INSUFFICIENT_SCOPE");
    expect(readOnly.edRequests).toHaveLength(0);
    expect(allowedPayload.result).not.toHaveProperty("isError", true);
    expect(writable.edRequests[0]?.method).toBe("POST");
  });

  it("returns secret-free errors for malformed requests and configuration", async () => {
    const assertion = await signAssertion();
    const harness = createHarness();
    const malformed = await harness.mcp({ nope: true }, assertion);
    const misconfigured = createHarness({ ED_API_TOKEN: " " });
    const configurationError = await misconfigured.mcp(initializeRequest(), assertion);

    const configurationBody = await configurationError.text();

    expect(malformed.status).toBe(400);
    expect(JSON.parse(configurationBody)).toEqual({ error: "Server configuration error." });
    expect(configurationBody).not.toContain(ED_TOKEN);
  });
});

interface RpcResponse {
  result?: unknown;
}

interface ToolResult {
  content: unknown[];
  isError?: boolean;
}

function createHarness(overrides: Partial<CloudflareEnv> = {}) {
  const edRequests: Request[] = [];
  const env: CloudflareEnv = {
    ACCESS_AUD: AUDIENCE,
    ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
    ED_API_BASE_URL: "https://ed.example.com/api/",
    ED_API_TOKEN: ED_TOKEN,
    MCP_WRITE_ENABLED: "false",
    OWNER_EMAIL,
    ...overrides,
  };
  const fetch = vi.fn<AccessFetch>(async (input, init) => {
    const request = new Request(input, init);
    if (request.url === `${TEAM_DOMAIN}/cdn-cgi/access/certs`) {
      return Response.json(jwks);
    }
    if (request.url.startsWith(env.ED_API_BASE_URL)) {
      edRequests.push(request);
      if (request.url.endsWith("/user")) {
        return Response.json({
          courses: [],
          user: { email: OWNER_EMAIL, id: 1, name: "Owner" },
        });
      }
      return Response.json({ correct: true, slide_completed: false });
    }
    return new Response("Not found", { status: 404 });
  });
  const worker = createWorker({ fetch });

  async function request(input: string, init: RequestInit): Promise<Response> {
    return worker.fetch!(new Request(input, init), env, {} as ExecutionContext);
  }

  return {
    edRequests,
    mcp(body: unknown, assertion?: string) {
      const headers = new Headers({
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
      });
      if (assertion) {
        headers.set("Cf-Access-Jwt-Assertion", assertion);
      }
      return request("https://mcp.example.com/mcp", {
        body: JSON.stringify(body),
        headers,
        method: "POST",
      });
    },
    request,
  };
}

function initializeRequest(): Record<string, unknown> {
  return rpcRequest(1, "initialize", {
    capabilities: {},
    clientInfo: { name: "worker-test", version: "1.0.0" },
    protocolVersion: "2025-06-18",
  });
}

function rpcRequest(id: number, method: string, params?: unknown): Record<string, unknown> {
  return { id, jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) };
}

async function signAssertion(options: {
  audience?: string;
  email?: string;
  expirationTime?: string;
  issuer?: string;
  key?: KeyLike;
  notBefore?: string;
} = {}): Promise<string> {
  const payload = options.email === undefined && "email" in options
    ? {}
    : { email: options.email ?? OWNER_EMAIL };
  let token = new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(options.issuer ?? TEAM_DOMAIN)
    .setAudience(options.audience ?? AUDIENCE)
    .setSubject("owner-subject")
    .setIssuedAt()
    .setExpirationTime(options.expirationTime ?? "5 minutes");
  if (options.notBefore) {
    token = token.setNotBefore(options.notBefore);
  }
  return token.sign(options.key ?? privateKey);
}
