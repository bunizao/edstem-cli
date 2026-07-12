import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadToken } from "../src/auth.js";
import { loadConfig } from "../src/config.js";
import { selectFields } from "../src/output.js";

describe("auth, config, and output", () => {
  it("prefers the environment token", async () => {
    expect(await loadToken({ env: { ED_API_TOKEN: " env-token " }, tokenFile: "/missing" })).toBe("env-token");
  });

  it("loads a token file without verifying it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "edstem-token-"));
    const tokenFile = join(directory, "token");
    await writeFile(tokenFile, "file-token\n", { mode: 0o600 });

    expect(await loadToken({ env: {}, tokenFile })).toBe("file-token");
  });

  it("normalizes the configured fetch count", async () => {
    const directory = await mkdtemp(join(tmpdir(), "edstem-config-"));
    const configFile = join(directory, "config.yaml");
    await writeFile(configFile, "fetch:\n  count: 12\n", "utf8");

    expect(await loadConfig(configFile)).toMatchObject({ fetchCount: 12 });
  });

  it("selects top-level fields from list results", () => {
    expect(selectFields([{ id: 1, title: "A", body: "large" }], "id,title")).toEqual([
      { id: 1, title: "A" },
    ]);
  });
});
