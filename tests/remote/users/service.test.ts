import { afterEach, describe, expect, it } from "bun:test";

import { EdIdentityMismatchError } from "../../../src/remote/users/service.js";
import { createTestRuntime } from "../support/test-runtime.js";

describe("users service", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()?.();
    }
  });

  it("upserts a user from Ed identity and reuses the same row on repeat sign-ins", async () => {
    const { runtime, cleanup } = await createTestRuntime({
      apiBaseUrl: "http://127.0.0.1:1/api/"
    });
    cleanups.push(cleanup);

    const first = runtime.users.upsertFromEdIdentity({
      edUserEmail: "ada@example.com",
      edUserId: 101,
      edUserName: "Ada"
    });
    const second = runtime.users.upsertFromEdIdentity({
      edUserEmail: "Ada@Example.com",
      edUserId: 101,
      edUserName: "Ada Lovelace"
    });

    expect(second.id).toBe(first.id);
    expect(second.email).toBe("ada@example.com");
    expect(second.displayName).toBe("Ada Lovelace");
  });

  it("migrates a legacy email row onto the verified Ed identity", async () => {
    const { runtime, cleanup } = await createTestRuntime({
      apiBaseUrl: "http://127.0.0.1:1/api/"
    });
    cleanups.push(cleanup);

    const legacy = runtime.users.upsertFromEdIdentity({
      edUserEmail: "ada@example.com",
      edUserId: 101,
      edUserName: "Ada"
    });

    runtime.db.query("UPDATE users SET ed_user_id = NULL WHERE id = ?").run(legacy.id);

    const migrated = runtime.users.upsertFromEdIdentity({
      edUserEmail: "ada@example.com",
      edUserId: 202,
      edUserName: "Ada Updated"
    });

    expect(migrated.id).toBe(legacy.id);
    expect(migrated.edUserId).toBe(202);
    expect(migrated.displayName).toBe("Ada Updated");
  });

  it("rejects binding a different Ed identity onto an existing user", async () => {
    const { runtime, cleanup } = await createTestRuntime({
      apiBaseUrl: "http://127.0.0.1:1/api/"
    });
    cleanups.push(cleanup);

    const user = runtime.users.upsertFromEdIdentity({
      edUserEmail: "ada@example.com",
      edUserId: 101,
      edUserName: "Ada"
    });

    expect(() =>
      runtime.users.syncIdentity(user.id, {
        edUserEmail: "grace@example.com",
        edUserId: 202,
        edUserName: "Grace"
      })
    ).toThrow(EdIdentityMismatchError);
  });
});
