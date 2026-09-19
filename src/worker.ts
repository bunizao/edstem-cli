import { type AuthInfo } from "@modelcontextprotocol/server";
import {
  createMcpHandler,
  type StatelessMcpHandler
} from "agents/mcp/server";

import { EdClient } from "./ed/client.js";
import { createEdMcpServer } from "./mcp/server.js";
import {
  EdApiBaseUrlError,
  EdApiUpstreamError,
  EdTokenInvalidError,
  verifyEdToken
} from "./remote/credentials/verifier.js";

const DEFAULT_ED_API_BASE_URL = "https://edstem.org/api/";
const READ_SCOPE = "mcp:tools.read";
const WRITE_SCOPE = "mcp:tools.write";
const TOKEN_CACHE_TTL_MS = 5 * 60 * 1000;
const TOKEN_CACHE_MAX_ENTRIES = 1000;
const handlers = new WeakMap<object, StatelessMcpHandler>();

// Verified tokens, keyed by SHA-256 so the raw token never lives in the map.
// The cache is per-isolate and best-effort: a cold isolate just verifies again.
const verifiedTokens = new Map<string, CachedIdentity>();

export interface WorkerEnv {
  ED_API_BASE_URL?: string;
  MCP_ALLOWED_HOSTNAMES?: string;
  MCP_ALLOWED_ORIGIN_HOSTNAMES?: string;
  MCP_TOKEN_CACHE_TTL_SECONDS?: string;
  MCP_ALLOW_POSTING?: string;
}

type Credential = {
  source: "api-key" | "bearer";
  token: string;
};

type CachedIdentity = {
  edUserId: number;
  expiresAt: number;
};

const worker = {
  async fetch(
    request: Request,
    env: WorkerEnv,
    context: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/healthz" && request.method === "GET") {
      return jsonResponse({ ok: true, service: "edstem-mcp-worker" });
    }

    const handler = getHandler(env);
    if (request.method === "OPTIONS") {
      return handler(request, env, context);
    }

    if (url.pathname !== "/mcp") {
      return handler(request, env, context);
    }

    const credential = readCredential(request);
    if (credential instanceof Response) {
      return credential;
    }

    const authInfo = await verifyCredential(credential, env);
    if (authInfo instanceof Response) {
      return authInfo;
    }

    return handler.fetch(request, { authInfo });
  }
} satisfies ExportedHandler<WorkerEnv>;

export default worker;

function getHandler(env: WorkerEnv): StatelessMcpHandler {
  const key = env as object;
  const existing = handlers.get(key);
  if (existing) {
    return existing;
  }

  const apiBaseUrl = normalizeApiBaseUrl(env.ED_API_BASE_URL);
  const handler = createMcpHandler(
    ({ authInfo }) => {
      if (!authInfo?.token) {
        throw new Error("Verified MCP auth context is missing a token.");
      }

      const token = authInfo.token;
      const client = new EdClient({ apiBaseUrl, token });
      return createEdMcpServer({
        canPost: () => env.MCP_ALLOW_POSTING === "1",
        canWrite: () => true,
        getClient: () => client,
        onAuthExpired: async () => {
          verifiedTokens.delete(await hashToken(token));
        }
      });
    },
    {
      allowedHostnames: parseHostnameList(env.MCP_ALLOWED_HOSTNAMES),
      allowedOriginHostnames: parseHostnameList(env.MCP_ALLOWED_ORIGIN_HOSTNAMES),
      corsOptions: {
        headers:
          "Content-Type, Accept, Authorization, X-API-Key, mcp-session-id, MCP-Protocol-Version, Mcp-Method, Mcp-Name",
        exposeHeaders: "mcp-session-id, MCP-Protocol-Version"
      },
      legacy: "stateless",
      route: "/mcp"
    }
  );
  handlers.set(key, handler);
  return handler;
}

function readCredential(request: Request): Credential | Response {
  const authorization = request.headers.get("authorization")?.trim();
  const apiKey = request.headers.get("x-api-key")?.trim();
  let bearerToken: string | undefined;

  if (authorization) {
    const match = /^Bearer\s+(\S+)$/i.exec(authorization);
    if (!match?.[1]) {
      return unauthorizedResponse(
        "invalid_request",
        "Authorization must use the Bearer scheme."
      );
    }
    bearerToken = match[1];
  }

  if (bearerToken && apiKey && bearerToken !== apiKey) {
    return unauthorizedResponse(
      "invalid_request",
      "Authorization and X-API-Key credentials must match."
    );
  }
  if (bearerToken) {
    return { source: "bearer", token: bearerToken };
  }
  if (apiKey) {
    return { source: "api-key", token: apiKey };
  }
  return unauthorizedResponse(
    "unauthorized",
    "Bearer token or X-API-Key is required."
  );
}

async function verifyCredential(
  credential: Credential,
  env: WorkerEnv
): Promise<AuthInfo | Response> {
  const ttlMs = tokenCacheTtlMs(env);
  const cacheKey = ttlMs > 0 ? await hashToken(credential.token) : undefined;
  if (cacheKey) {
    const cached = readCachedIdentity(cacheKey);
    if (cached) {
      return buildAuthInfo(credential, cached.edUserId);
    }
  }

  try {
    const identity = await verifyEdToken(
      credential.token,
      normalizeApiBaseUrl(env.ED_API_BASE_URL)
    );
    if (cacheKey) {
      cacheIdentity(cacheKey, identity.edUserId, ttlMs);
    }
    return buildAuthInfo(credential, identity.edUserId);
  } catch (error) {
    if (error instanceof EdTokenInvalidError) {
      return unauthorizedResponse(
        "invalid_token",
        "The Ed access token or API key is invalid."
      );
    }
    if (error instanceof EdApiBaseUrlError || error instanceof EdApiUpstreamError) {
      console.error("Ed credential verification failed", error);
      return jsonResponse(
        {
          error: "temporarily_unavailable",
          error_description: "The Ed API could not verify this credential."
        },
        503
      );
    }
    throw error;
  }
}

function buildAuthInfo(credential: Credential, edUserId: number): AuthInfo {
  return {
    clientId: `ed:${edUserId}`,
    extra: {
      authMethod: credential.source,
      edUserId
    },
    scopes: [READ_SCOPE, WRITE_SCOPE],
    token: credential.token
  };
}

function readCachedIdentity(cacheKey: string): CachedIdentity | undefined {
  const cached = verifiedTokens.get(cacheKey);
  if (!cached) {
    return undefined;
  }
  if (cached.expiresAt <= Date.now()) {
    verifiedTokens.delete(cacheKey);
    return undefined;
  }
  return cached;
}

function cacheIdentity(cacheKey: string, edUserId: number, ttlMs: number): void {
  verifiedTokens.delete(cacheKey);
  if (verifiedTokens.size >= TOKEN_CACHE_MAX_ENTRIES) {
    const oldest = verifiedTokens.keys().next();
    if (!oldest.done) {
      verifiedTokens.delete(oldest.value);
    }
  }
  verifiedTokens.set(cacheKey, { edUserId, expiresAt: Date.now() + ttlMs });
}

function tokenCacheTtlMs(env: WorkerEnv): number {
  const raw = env.MCP_TOKEN_CACHE_TTL_SECONDS?.trim();
  if (!raw) {
    return TOKEN_CACHE_TTL_MS;
  }
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : TOKEN_CACHE_TTL_MS;
}

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeApiBaseUrl(value: string | undefined): string {
  const normalized = value?.trim() || DEFAULT_ED_API_BASE_URL;
  return `${normalized.replace(/\/+$/, "")}/`;
}

function parseHostnameList(value: string | undefined): string[] | undefined {
  const values = value
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return values && values.length > 0 ? values : undefined;
}

function unauthorizedResponse(error: string, description: string): Response {
  return jsonResponse(
    {
      error,
      error_description: description
    },
    401,
    {
      "Cache-Control": "no-store",
      "WWW-Authenticate": `Bearer realm="edstem-mcp", error="${error}"`
    }
  );
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers?: HeadersInit
): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Access-Control-Allow-Origin", "*");
  responseHeaders.set("Content-Type", "application/json");
  return new Response(JSON.stringify(body), {
    headers: responseHeaders,
    status
  });
}
