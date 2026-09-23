import { describe, expect, it, vi } from "vitest";

import type { CliRuntime } from "../src/cli.js";
import { run } from "../src/cli.js";
import type { FetchLike } from "../src/ed/client.js";
import { checkForUpdate, compareVersions } from "../src/update.js";

const spawnSync = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawnSync }));

function makeRuntime(latestVersion: string): {
  runtime: CliRuntime;
  stderr: string[];
  stdout: string[];
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    runtime: {
      createClient: async () => {
        throw new Error("update must not require an Ed client");
      },
      createClientForToken: async () => { throw new Error("update must not authenticate"); },
      readStdinLine: async () => { throw new Error("update must not read tokens"); },
      tokenFile: "/unused/token",
      defaultFetchCount: async () => 30,
      fetch: async () => new Response(JSON.stringify({ version: latestVersion }), { status: 200 }),
      interactive: false,
      isTTY: false,
      writeStderr: (text) => stderr.push(text),
      writeStdout: (text) => stdout.push(text),
    },
    stderr,
    stdout,
  };
}

describe("update checks", () => {
  it("compares semantic versions", () => {
    expect(compareVersions("0.5.0", "0.4.9")).toBe(1);
    expect(compareVersions("0.4.0", "0.4.0")).toBe(0);
  });

  it("returns a stable npm upgrade command", async () => {
    const fetch: FetchLike = async () => new Response(JSON.stringify({ version: "0.8.0" }), { status: 200 });

    await expect(checkForUpdate(fetch)).resolves.toMatchObject({
      currentVersion: "0.7.0",
      latestVersion: "0.8.0",
      updateAvailable: true,
      upgradeCommand: "npm install -g edstem-cli@latest",
    });
  });
});

describe("edstem update", () => {
  it("reports the registry version without installing it", async () => {
    const { runtime, stdout } = makeRuntime("9.9.9");

    expect(await run(["node", "edstem", "update", "--check", "--json"], runtime)).toBe(0);

    expect(JSON.parse(stdout.join(""))).toEqual({
      currentVersion: "0.7.0",
      latestVersion: "9.9.9",
      updateAvailable: true,
      upgradeCommand: "npm install -g edstem-cli@latest",
    });
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it("reports without installing when the release is current", async () => {
    const { runtime, stdout } = makeRuntime("0.1.0");

    expect(await run(["node", "edstem", "update", "--json"], runtime)).toBe(0);

    expect(JSON.parse(stdout.join(""))).toMatchObject({ updateAvailable: false });
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it("prints the upgrade plan for a dry run without spawning npm", async () => {
    const { runtime, stdout } = makeRuntime("9.9.9");
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      expect(await run(["node", "edstem", "update", "--dry-run"], runtime)).toBe(0);
      expect(write.mock.calls.join("")).toContain(
        "Upgrade edstem-cli from 0.7.0 to 9.9.9 with `npm install -g edstem-cli@latest`."
      );
    } finally {
      write.mockRestore();
    }

    expect(stdout).toEqual([]);
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it("installs the release once the mutation is confirmed", async () => {
    const { runtime, stdout } = makeRuntime("9.9.9");
    spawnSync.mockReturnValue({ status: 0 });

    expect(await run(["node", "edstem", "update", "--yes", "--json"], runtime)).toBe(0);

    expect(spawnSync).toHaveBeenCalledWith(
      "npm",
      ["install", "-g", "edstem-cli@latest"],
      { stdio: "inherit" }
    );
    expect(JSON.parse(stdout.join(""))).toMatchObject({
      latestVersion: "9.9.9",
      ranCommand: "npm install -g edstem-cli@latest",
    });
  });
});
