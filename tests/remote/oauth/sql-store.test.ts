import { afterEach, describe, expect, it } from "bun:test";

import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";

import { createTestRuntime, upsertTestUser } from "../support/test-runtime.js";

describe("oauth sql store", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()?.();
    }
  });

  it("persists clients, codes, and tokens", async () => {
    const { runtime, cleanup } = await createTestRuntime({
      apiBaseUrl: "http://127.0.0.1:1/api/"
    });
    cleanups.push(cleanup);

    const client: OAuthClientInformationFull = {
      client_id: "test-client",
      client_name: "Test Client",
      grant_types: ["authorization_code", "refresh_token"],
      redirect_uris: ["http://127.0.0.1/callback"],
      response_types: ["code"],
      token_endpoint_auth_method: "none"
    };

    runtime.store.saveClient(client);
    expect(runtime.store.getClient(client.client_id)).toMatchObject({
      client_id: "test-client"
    });

    const user = upsertTestUser(runtime, {
      email: "ada@example.com",
      id: 101,
      name: "Ada"
    });

    runtime.store.saveAuthorizationCode("code-1", {
      clientId: client.client_id,
      codeChallenge: "challenge",
      displayName: "Ada",
      expiresAt: Date.now() + 1_000,
      issuedAt: Date.now(),
      redirectUri: client.redirect_uris[0]!,
      scopes: ["mcp:tools.read"],
      userId: user.id,
      username: "ada@example.com"
    });
    expect(runtime.store.getAuthorizationCode("code-1")?.username).toBe("ada@example.com");

    runtime.store.saveRefreshToken("refresh-1", {
      clientId: client.client_id,
      displayName: "Ada",
      expiresAt: Date.now() + 1_000,
      issuedAt: Date.now(),
      scopes: ["mcp:tools.read"],
      userId: user.id,
      username: "ada@example.com"
    });
    expect(runtime.store.getRefreshToken("refresh-1")?.displayName).toBe("Ada");

    runtime.store.saveAccessToken("access-1", {
      clientId: client.client_id,
      displayName: "Ada",
      expiresAt: Date.now() + 1_000,
      issuedAt: Date.now(),
      refreshToken: "refresh-1",
      scopes: ["mcp:tools.read"],
      userId: user.id,
      username: "ada@example.com"
    });
    expect(runtime.store.getAccessToken("access-1")?.refreshToken).toBe("refresh-1");

    const summary = runtime.store.pruneExpired(Date.now() + 2_000);
    expect(summary.totalDeleted).toBe(3);
    expect(runtime.store.getAuthorizationCode("code-1")).toBeUndefined();
    expect(runtime.store.getRefreshToken("refresh-1")).toBeUndefined();
    expect(runtime.store.getAccessToken("access-1")).toBeUndefined();
  });
});
