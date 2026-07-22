import { describe, expect, it } from "bun:test";

import { decryptToken, encryptToken } from "../../../src/remote/credentials/crypto.js";

describe("credentials crypto", () => {
  it("round-trips encrypted tokens", () => {
    const key = Buffer.alloc(32, 1);
    const encrypted = encryptToken("secret-token", key);

    expect(decryptToken(encrypted, key)).toBe("secret-token");
  });

  it("rejects tampered auth tags", () => {
    const key = Buffer.alloc(32, 2);
    const encrypted = encryptToken("secret-token", key);
    encrypted.authTag = Buffer.from(encrypted.authTag);
    encrypted.authTag[0] = (encrypted.authTag[0] ?? 0) ^ 0xff;

    expect(() => decryptToken(encrypted, key)).toThrow();
  });
});
