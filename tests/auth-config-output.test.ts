import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { loadToken } from "../src/auth.js";
import { loadConfig } from "../src/config.js";

describe("auth, config, and output", () => {
  it("prefers the environment token", async () => {
    expect(await loadToken({ env: { EDSTEM_TOKEN: " env-token " }, tokenFile: "/missing" })).toBe("env-token");
  });

  it("loads a token file without verifying it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "edstem-token-"));
    const tokenFile = join(directory, "token");
    await writeFile(tokenFile, "file-token\n", { mode: 0o600 });

    expect(await loadToken({ env: {}, tokenFile })).toBe("file-token");
  });

  it("prompts once and saves a private token file in an interactive terminal", async () => {
    const directory = await mkdtemp(join(tmpdir(), "edstem-prompt-"));
    const tokenFile = join(directory, "config", "token");

    expect(await loadToken({
      env: {},
      interactive: true,
      prompt: async () => "prompt-token",
      tokenFile,
    })).toBe("prompt-token");

    expect(await readFile(tokenFile, "utf8")).toBe("prompt-token\n");
    expect((await stat(tokenFile)).mode & 0o777).toBe(0o600);
  });

  it("normalizes the configured fetch count", async () => {
    const directory = await mkdtemp(join(tmpdir(), "edstem-config-"));
    const configFile = join(directory, "config.yaml");
    await writeFile(configFile, "fetch:\n  count: 12\n", "utf8");

    expect(await loadConfig(configFile)).toMatchObject({ fetchCount: 12 });
  });

  it("uses the normalized base URL even when the config file is absent", async () => {
    vi.stubEnv("EDSTEM_BASE_URL", "https://example.test/api/");
    try {
      expect(await loadConfig("/missing-edstem-config.yaml")).toMatchObject({
        apiBaseUrl: "https://example.test/api/",
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

});
