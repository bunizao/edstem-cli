import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

import { EdClient } from "../ed/client.js";
import { createEdMcpServer } from "../mcp/server.js";
import {
  AccessConfigurationError,
  AccessUnauthorizedError,
  verifyAccessAssertion,
  type AccessFetch,
} from "./access.js";

export interface CloudflareEnv {
  ACCESS_AUD: string;
  ACCESS_TEAM_DOMAIN: string;
  ED_API_BASE_URL: string;
  ED_API_TOKEN: string;
  MCP_WRITE_ENABLED?: string;
  OWNER_EMAIL: string;
}

interface WorkerDependencies {
  fetch: AccessFetch;
}

export function createWorker(
  dependencies: WorkerDependencies = { fetch: globalThis.fetch }
): ExportedHandler<CloudflareEnv> {
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      if (url.pathname !== "/mcp") {
        return jsonError(404, "Not found.");
      }
      if (request.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method not allowed." }), {
          status: 405,
          headers: {
            Allow: "POST",
            "Content-Type": "application/json; charset=utf-8",
          },
        });
      }

      const assertion = request.headers.get("Cf-Access-Jwt-Assertion");
      if (!assertion) {
        return jsonError(401, "Unauthorized.");
      }

      try {
        const identity = await verifyAccessAssertion(
          assertion,
          {
            accessAud: env.ACCESS_AUD,
            accessTeamDomain: env.ACCESS_TEAM_DOMAIN,
            ownerEmail: env.OWNER_EMAIL,
          },
          dependencies.fetch
        );
        const client = new EdClient({
          apiBaseUrl: requireBinding(env.ED_API_BASE_URL),
          fetch: dependencies.fetch,
          token: requireBinding(env.ED_API_TOKEN),
        });
        const writeEnabled = env.MCP_WRITE_ENABLED?.trim().toLowerCase() === "true";
        const authInfo: AuthInfo = {
          clientId: identity.subject,
          expiresAt: identity.expiresAt,
          extra: { email: identity.email },
          scopes: writeEnabled ? ["mcp:tools.read", "mcp:tools.write"] : ["mcp:tools.read"],
          token: "cloudflare-access",
        };
        const server = createEdMcpServer({
          canWrite: () => writeEnabled,
          getClient: () => client,
        });
        const transport = new WebStandardStreamableHTTPServerTransport({
          enableJsonResponse: true,
          sessionIdGenerator: undefined,
        });

        await server.connect(transport);
        return await transport.handleRequest(request, { authInfo });
      } catch (error) {
        if (error instanceof AccessUnauthorizedError) {
          return jsonError(401, "Unauthorized.");
        }
        if (error instanceof AccessConfigurationError || error instanceof BindingError) {
          return jsonError(500, "Server configuration error.");
        }
        return jsonError(500, "Internal server error.");
      }
    },
  };
}

class BindingError extends Error {}

function requireBinding(value: string | undefined): string {
  const binding = value?.trim();
  if (!binding) {
    throw new BindingError();
  }
  return binding;
}

function jsonError(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

export default createWorker();
