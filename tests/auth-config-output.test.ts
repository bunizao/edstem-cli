import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { detectRegion, loadTokenWithSource, saveToken } from "../src/auth.js";
import { loadConfig } from "../src/config.js";
import { ED_REGIONS, isEdRegion, type EdRegion } from "../src/regions.js";

describe("auth, config, and output", () => {
  it("prefers the environment token", async () => {
    expect(await loadTokenWithSource({ env: { EDSTEM_TOKEN: " env-token " }, tokenFile: "/missing" })).toMatchObject({
      token: "env-token", source: "environment",
    });
  });

  it("loads a token file without verifying it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "edstem-token-"));
    const tokenFile = join(directory, "token");
    await writeFile(tokenFile, "file-token\n", { mode: 0o600 });

    expect(await loadTokenWithSource({ env: {}, tokenFile })).toMatchObject({
      token: "file-token", region: "au", regionSource: "default",
    });
  });

  it.each(["au", "us", "eu"] as const)("loads a saved %s token with its API endpoint", async (region) => {
    const directory = await mkdtemp(join(tmpdir(), "edstem-region-"));
    const tokenFile = join(directory, "token");
    await saveToken("file-token", tokenFile, region);
    const credentials = await loadTokenWithSource({ env: {}, tokenFile });
    expect(credentials).toMatchObject({ token: "file-token", region, regionSource: "file", source: "file" });
    expect(await loadConfig(join(directory, "missing.yaml"), credentials.region)).toMatchObject({
      apiBaseUrl: ED_REGIONS[region].apiBaseUrl,
    });
  });

  it("keeps an environment token independent of the saved token's region", async () => {
    const tokenFile = join(await mkdtemp(join(tmpdir(), "edstem-env-region-")), "token");
    await saveToken("saved-eu-token", tokenFile, "eu");
    expect(await loadTokenWithSource({ env: { EDSTEM_TOKEN: "env-token" }, tokenFile })).toMatchObject({
      token: "env-token", region: "au", regionSource: "default", source: "environment",
    });
    expect(await loadTokenWithSource({ env: { EDSTEM_TOKEN: "env-token", EDSTEM_REGION: " US " }, tokenFile })).toMatchObject({
      token: "env-token", region: "us", regionSource: "environment", source: "environment",
    });
    expect(await loadTokenWithSource({ env: { EDSTEM_REGION: "us" }, tokenFile })).toMatchObject({
      token: "saved-eu-token", region: "us", regionSource: "environment", source: "file",
    });
  });

  it.each(['{"token":"secret",', '{"token":"secret","region":"invalid"}', '{"region":"eu"}'])(
    "rejects malformed credentials without exposing their contents", async (content) => {
      const tokenFile = join(await mkdtemp(join(tmpdir(), "edstem-invalid-region-")), "token");
      await writeFile(tokenFile, content);
      await expect(loadTokenWithSource({ env: {}, tokenFile })).rejects.toMatchObject({
        code: "config", message: `Invalid Ed credentials in ${tokenFile}. Run edstem auth login again.`,
      });
    }
  );

  it("rejects an invalid environment region before reading a token", async () => {
    await expect(loadTokenWithSource({ env: { EDSTEM_TOKEN: "secret", EDSTEM_REGION: "invalid" } }))
      .rejects.toMatchObject({ code: "usage", message: "Ed region must be au, us, or eu." });
  });

  it("normalizes the configured fetch count", async () => {
    const directory = await mkdtemp(join(tmpdir(), "edstem-config-"));
    const configFile = join(directory, "config.yaml");
    await writeFile(configFile, "fetch:\n  count: 12\n", "utf8");

    expect(await loadConfig(configFile)).toMatchObject({ fetchCount: 12 });
  });

  it("reads the rate-limit retry settings", async () => {
    const directory = await mkdtemp(join(tmpdir(), "edstem-config-"));
    const configFile = join(directory, "config.yaml");
    await writeFile(configFile, "rateLimit:\n  maxRetries: 5\n  retryBaseDelay: 2.5\n", "utf8");

    expect(await loadConfig(configFile)).toMatchObject({ maxRetries: 5, retryBaseDelayMs: 2500 });
  });

  it("falls back to default retry settings for invalid values", async () => {
    const directory = await mkdtemp(join(tmpdir(), "edstem-config-"));
    const configFile = join(directory, "config.yaml");
    await writeFile(configFile, "rateLimit:\n  maxRetries: nope\n  retryBaseDelay: -1\n", "utf8");

    expect(await loadConfig(configFile)).toMatchObject({ maxRetries: 3, retryBaseDelayMs: 1000 });
  });

  it("uses the normalized base URL even when the config file is absent", async () => {
    vi.stubEnv("EDSTEM_BASE_URL", "https://example.test/api/");
    try {
      expect(await loadConfig("/missing-edstem-config.yaml", "eu")).toMatchObject({
        apiBaseUrl: "https://example.test/api/",
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

});

describe("region detection", () => {
  const user = { user: { id: 1, name: "Alice" }, courses: [] } as never;
  // A fake Ed that accepts the token only in the given regions.
  const probe = (accepting: EdRegion[]) => vi.fn(async (_token: string, region: EdRegion) => ({
    fetchUser: async () => {
      if (!accepting.includes(region)) throw new Error("rejected");
      return user;
    },
  }));

  it.each(["au", "us", "eu"] as const)("returns %s with its user when only it accepts the token", async (region) => {
    const createClient = probe([region]);
    expect(await detectRegion("token", createClient)).toEqual({ region, user });
    expect(createClient.mock.calls.map(([, name]) => name).sort()).toEqual(["au", "eu", "us"]);
  });

  it.each([[[]], [["au", "eu"]], [["au", "us", "eu"]]] as [EdRegion[]][])(
    "is undetected when %j accept the token",
    async (accepting) => {
      expect(await detectRegion("token", probe(accepting))).toBe("undetected");
    }
  );

  it("treats a client that fails to start as a rejection", async () => {
    const createClient = vi.fn(async (_token: string, region: EdRegion) => {
      if (region !== "eu") throw new Error("no config");
      return { fetchUser: async () => user };
    });
    expect(await detectRegion("token", createClient)).toEqual({ region: "eu", user });
  });

  it("guards region values", () => {
    expect(["au", "us", "eu"].every(isEdRegion)).toBe(true);
    expect([undefined, "", "AU", "toString", "constructor"].some(isEdRegion)).toBe(false);
  });
});
