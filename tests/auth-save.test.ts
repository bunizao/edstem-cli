import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { saveToken } from "../src/auth.js";

const filesystem = vi.hoisted(() => ({ open: vi.fn(), rename: vi.fn() }));
vi.mock("node:fs/promises", async (original) => ({
  ...await original<typeof import("node:fs/promises")>(), ...filesystem,
}));
const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");

describe("atomic credential saves", () => {
  let directory: string;
  let tokenFile: string;
  const original = '{"token":"previous-token","region":"au"}\n';

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "edstem-atomic-save-"));
    tokenFile = join(directory, "token");
    await writeFile(tokenFile, original, { mode: 0o644 });
    filesystem.open.mockReset().mockImplementation(actual.open);
    filesystem.rename.mockReset().mockImplementation(actual.rename);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  it("keeps old credentials readable until the complete private file replaces them", async () => {
    filesystem.rename.mockImplementationOnce(async (from, to) => {
      expect(await readFile(tokenFile, "utf8")).toBe(original);
      expect(JSON.parse(await readFile(from, "utf8"))).toEqual({ token: "new-token", region: "eu" });
      expect((await stat(from)).mode & 0o777).toBe(0o600);
      expect((await stat(directory)).dev).toBe((await stat(from)).dev);
      await actual.rename(from, to);
    });
    await saveToken("new-token", tokenFile, "eu");
    expect(JSON.parse(await readFile(tokenFile, "utf8"))).toEqual({ token: "new-token", region: "eu" });
    expect((await stat(tokenFile)).mode & 0o777).toBe(0o600);
    expect(await readdir(directory)).toEqual(["token"]);
  });

  it.each(["writeFile", "sync", "rename"] as const)("preserves the previous file and cleans up when %s fails", async (operation) => {
    const failure = new Error("Simulated disk failure");
    if (operation === "rename") filesystem.rename.mockRejectedValueOnce(failure);
    else filesystem.open.mockImplementationOnce(async (...args: Parameters<typeof actual.open>) => {
      const file = await actual.open(...args);
      vi.spyOn(file, operation).mockRejectedValueOnce(failure);
      return file;
    });
    await expect(saveToken("new-token", tokenFile, "eu")).rejects.toThrow("Simulated disk failure");
    expect(await readFile(tokenFile, "utf8")).toBe(original);
    expect(await readdir(directory)).toEqual(["token"]);
  });

  it("keeps token and region paired across concurrent saves", async () => {
    await Promise.all([
      saveToken("us-token", tokenFile, "us"),
      saveToken("eu-token", tokenFile, "eu"),
    ]);
    const saved = JSON.parse(await readFile(tokenFile, "utf8"));
    expect(["us", "eu"]).toContain(saved.region);
    expect(saved.token).toBe(`${saved.region}-token`);
    expect(await readdir(directory)).toEqual(["token"]);
  });
});
