import { beforeEach, describe, expect, it, vi } from "vitest";

import { openTokenPage } from "../src/browser.js";
import { ED_REGIONS } from "../src/regions.js";

const execFile = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFile }));

describe("opening the Ed token page", () => {
  beforeEach(() => {
    execFile.mockReset().mockImplementation((_command, _args, _options, callback) => callback(null));
  });

  it.each([
    ["darwin", "/usr/bin/open", []],
    ["win32", "rundll32.exe", ["url.dll,FileProtocolHandler"]],
    ["linux", "xdg-open", []],
  ] as const)("uses the system default browser on %s for every region", async (platform, command, prefix) => {
    for (const region of ["au", "us", "eu"] as const) {
      await expect(openTokenPage(region, platform)).resolves.toBeUndefined();
      expect(execFile).toHaveBeenLastCalledWith(
        command, [...prefix, ED_REGIONS[region].tokenUrl],
        { timeout: 5_000, windowsHide: true }, expect.any(Function),
      );
    }
    expect(execFile).toHaveBeenCalledTimes(3);
  });

  it("reports launcher failures so login can show the manual link", async () => {
    execFile.mockImplementation((_command, _args, _options, callback) => callback(new Error("Launcher failed")));
    await expect(openTokenPage("au", "linux")).rejects.toThrow("Launcher failed");
  });
});
