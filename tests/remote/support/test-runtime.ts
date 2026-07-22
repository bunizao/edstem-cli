import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadConfig } from "../../../src/remote/config.js";
import { createRuntime, type Runtime } from "../../../src/remote/runtime.js";
import type { Logger } from "../../../src/remote/logger.js";

const TEST_MASTER_KEY = Buffer.alloc(32, 7).toString("base64");

export async function createTestRuntime(options: {
  apiBaseUrl: string;
  logger?: Logger;
  publicBaseUrl?: string;
}): Promise<{
  cleanup: () => Promise<void>;
  runtime: Runtime;
}> {
  const directory = await mkdtemp(path.join(tmpdir(), "edstem-mcp-"));
  const runtime = createRuntime(
    loadConfig({
      DATABASE_PATH: path.join(directory, "edstem-mcp.db"),
      ED_API_BASE_URL: options.apiBaseUrl,
      LOG_LEVEL: "error",
      MASTER_KEY: TEST_MASTER_KEY,
      PUBLIC_BASE_URL: options.publicBaseUrl || "http://127.0.0.1:9999"
    }),
    options.logger
  );

  return {
    cleanup: async () => {
      runtime.close();
      await rm(directory, { force: true, recursive: true });
    },
    runtime
  };
}

export function extractCsrfToken(html: string): string {
  const match = html.match(/name="csrf_token" value="([^"]+)"/);
  if (!match?.[1]) {
    throw new Error("CSRF token not found");
  }
  return match[1];
}

export function issueAccessToken(runtime: Runtime, options: {
  scopes: string[];
  userId: number;
  username: string;
}): string {
  const token = `access-${Math.random().toString(36).slice(2)}`;
  runtime.store.saveAccessToken(token, {
    clientId: "test-client",
    displayName: options.username,
    expiresAt: Date.now() + 60 * 60 * 1000,
    issuedAt: Date.now(),
    scopes: options.scopes,
    userId: options.userId,
    username: options.username
  });
  return token;
}

export function upsertTestUser(
  runtime: Runtime,
  options: {
    email: string;
    id: number;
    name?: string;
  }
) {
  return runtime.users.upsertFromEdIdentity({
    edUserEmail: options.email,
    edUserId: options.id,
    edUserName: options.name ?? options.email
  });
}
