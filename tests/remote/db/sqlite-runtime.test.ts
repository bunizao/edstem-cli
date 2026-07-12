import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { loadConfig } from "../../../src/remote/config.js";
import { createRuntime } from "../../../src/remote/runtime.js";
import { upsertTestUser } from "../support/test-runtime.js";

const TEST_MASTER_KEY = Buffer.alloc(32, 9).toString("base64");

describe("sqlite runtime", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()?.();
    }
  });

  it("creates oauth indexes and tolerates two live connections to the same database", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "edstem-mcp-sqlite-"));
    cleanups.push(async () => {
      await rm(directory, { force: true, recursive: true });
    });

    const databasePath = path.join(directory, "shared.db");
    const config = loadConfig({
      DATABASE_PATH: databasePath,
      ED_API_BASE_URL: "http://127.0.0.1:1/api/",
      MASTER_KEY: TEST_MASTER_KEY,
      PUBLIC_BASE_URL: "http://127.0.0.1:9999"
    });

    const runtimeA = createRuntime(config);
    const runtimeB = createRuntime(config);
    cleanups.push(async () => runtimeB.close());
    cleanups.push(async () => runtimeA.close());

    const user = upsertTestUser(runtimeA, {
      email: "ada@example.com",
      id: 101,
      name: "Ada"
    });

    expect(runtimeB.users.findByEmail("ada@example.com")?.id).toBe(user.id);

    runtimeB.store.saveAccessToken("shared-access", {
      clientId: "client-a",
      displayName: "Ada",
      expiresAt: Date.now() + 60_000,
      issuedAt: Date.now(),
      scopes: ["mcp:tools.read"],
      userId: user.id,
      username: user.email
    });

    expect(runtimeA.store.getAccessToken("shared-access")?.userId).toBe(user.id);

    const accessIndexes = runtimeA.db
      .query("PRAGMA index_list('oauth_access_tokens')")
      .all() as Array<{ name: string }>;
    const refreshIndexes = runtimeA.db
      .query("PRAGMA index_list('oauth_refresh_tokens')")
      .all() as Array<{ name: string }>;
    const codeIndexes = runtimeA.db
      .query("PRAGMA index_list('oauth_authorization_codes')")
      .all() as Array<{ name: string }>;

    expect(accessIndexes.some((index) => index.name === "oauth_access_tokens_expires_at_idx")).toBe(
      true
    );
    expect(refreshIndexes.some((index) => index.name === "oauth_refresh_tokens_expires_at_idx")).toBe(
      true
    );
    expect(
      codeIndexes.some((index) => index.name === "oauth_authorization_codes_expires_at_idx")
    ).toBe(true);
  });

  it("fails fast on a corrupted database file", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "edstem-mcp-corrupt-"));
    cleanups.push(async () => {
      await rm(directory, { force: true, recursive: true });
    });

    const databasePath = path.join(directory, "corrupt.db");
    await writeFile(databasePath, "not-a-sqlite-database", "utf-8");

    expect(() =>
      createRuntime(
        loadConfig({
          DATABASE_PATH: databasePath,
          ED_API_BASE_URL: "http://127.0.0.1:1/api/",
          MASTER_KEY: TEST_MASTER_KEY,
          PUBLIC_BASE_URL: "http://127.0.0.1:9999"
        })
      )
    ).toThrow();
  });

  it("seeds a fixed OAuth client when configured", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "edstem-mcp-fixed-client-"));
    cleanups.push(async () => {
      await rm(directory, { force: true, recursive: true });
    });

    const runtime = createRuntime(
      loadConfig({
        DATABASE_PATH: path.join(directory, "fixed-client.db"),
        ED_API_BASE_URL: "http://127.0.0.1:1/api/",
        MASTER_KEY: TEST_MASTER_KEY,
        OAUTH_FIXED_CLIENT_ID: "claude-fixed-client",
        OAUTH_FIXED_CLIENT_NAME: "Claude Fixed Client",
        OAUTH_FIXED_CLIENT_REDIRECT_URIS:
          "https://claude.ai/api/mcp/auth_callback,https://claude.ai/api/mcp/auth_callback_alt",
        OAUTH_FIXED_CLIENT_SECRET: "super-secret",
        PUBLIC_BASE_URL: "http://127.0.0.1:9999"
      })
    );
    cleanups.push(async () => runtime.close());

    expect(runtime.store.getClient("claude-fixed-client")).toMatchObject({
      client_id: "claude-fixed-client",
      client_name: "Claude Fixed Client",
      client_secret: "super-secret",
      redirect_uris: [
        "https://claude.ai/api/mcp/auth_callback",
        "https://claude.ai/api/mcp/auth_callback_alt"
      ],
      token_endpoint_auth_method: "client_secret_post"
    });
  });
});
