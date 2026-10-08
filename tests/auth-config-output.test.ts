import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { loadToken, loadTokenWithSource, saveToken } from "../src/auth.js";
import { loadConfig } from "../src/config.js";
import { ED_REGIONS } from "../src/regions.js";

describe("auth, config, and output", () => {
  it("prefers the environment token", async () => {
    expect(await loadToken({ env: { EDSTEM_TOKEN: " env-token " }, tokenFile: "/missing" })).toBe("env-token");
  });

  it("loads a token file without verifying it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "edstem-token-"));
    const tokenFile = join(directory, "token");
    await writeFile(tokenFile, "file-token\n", { mode: 0o600 });

    expect(await loadToken({ env: {}, tokenFile })).toBe("file-token");
    expect(await loadTokenWithSource({ env: {}, tokenFile })).toMatchObject({ token: "file-token", region: "au" });
  });

  it.each(["au", "us", "eu"] as const)("loads a saved %s token with its API endpoint", async (region) => {
    const directory = await mkdtemp(join(tmpdir(), "edstem-region-"));
    const tokenFile = join(directory, "token");
    await saveToken("file-token", tokenFile, region);
    const credentials = await loadTokenWithSource({ env: {}, tokenFile });
    expect(credentials).toMatchObject({ token: "file-token", region, source: "file" });
    expect(await loadConfig(join(directory, "missing.yaml"), credentials.region)).toMatchObject({
      apiBaseUrl: ED_REGIONS[region].apiBaseUrl,
    });
  });

  it("keeps an environment token independent of the saved token's region", async () => {
    const tokenFile = join(await mkdtemp(join(tmpdir(), "edstem-env-region-")), "token");
    await saveToken("saved-eu-token", tokenFile, "eu");
    expect(await loadTokenWithSource({ env: { EDSTEM_TOKEN: "env-token" }, tokenFile })).toMatchObject({
      token: "env-token", region: "au", source: "environment",
    });
    expect(await loadTokenWithSource({ env: { EDSTEM_TOKEN: "env-token", EDSTEM_REGION: " US " }, tokenFile })).toMatchObject({
      token: "env-token", region: "us", source: "environment",
    });
    expect(await loadTokenWithSource({ env: { EDSTEM_REGION: "us" }, tokenFile })).toMatchObject({
      token: "saved-eu-token", region: "us", source: "file",
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

  it("prompts once and saves a private token file in an interactive terminal", async () => {
    const directory = await mkdtemp(join(tmpdir(), "edstem-prompt-"));
    const tokenFile = join(directory, "config", "token");

    expect(await loadToken({
      env: {},
      interactive: true,
      prompt: async () => "prompt-token",
      promptRegion: async () => "eu",
      tokenFile,
    })).toBe("prompt-token");

    expect(JSON.parse(await readFile(tokenFile, "utf8"))).toEqual({ token: "prompt-token", region: "eu" });
    expect((await stat(tokenFile)).mode & 0o777).toBe(0o600);
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
