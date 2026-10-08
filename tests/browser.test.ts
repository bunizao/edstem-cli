import { beforeEach, describe, expect, it, vi } from "vitest";

import { openTokenPage } from "../src/browser.js";

const execFile = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFile }));

describe("opening the Ed token page", () => {
  beforeEach(() => {
    execFile.mockReset().mockImplementation((_command, _args, _options, callback) => callback(null, "none\n"));
  });

  it("opens a tab in the existing Ed window before using the default browser", async () => {
    execFile.mockImplementation((_command, _args, _options, callback) => callback(null, "opened\n"));
    expect(await openTokenPage("us", "darwin")).toBe("Google Chrome");
    expect(execFile).toHaveBeenCalledTimes(1);
    const [command, args] = execFile.mock.calls[0]!;
    expect(command).toBe("/usr/bin/osascript");
    expect(args.slice(-2)).toEqual(["https://edstem.org/us/settings/api-tokens", "https://edstem.org/us/"]);
    expect(args[1]).toContain('application id "com.google.Chrome" is not running');
    expect(args[1]).toContain('repeat with prefix in {regionPrefix, "https://edstem.org/"}');
    expect(args[1]).toContain("make new tab at end of tabs of edWindow");
    expect(args[1]).not.toMatch(/cookie|authToken|localStorage|user-data-dir|incognito/i);
  });

  it("tries Safari when Chromium browsers have no Ed window", async () => {
    execFile.mockImplementation((_command, args, _options, callback) => {
      callback(null, args[1].includes("com.apple.Safari") ? "opened\n" : "none\n");
    });
    expect(await openTokenPage("au", "darwin")).toBe("Safari");
    expect(execFile).toHaveBeenCalledTimes(4);
    expect(execFile.mock.calls[3]?.[1]?.[1]).toContain("set current tab of edWindow to newTab");
  });

  it("uses the default browser when existing window detection is unavailable", async () => {
    execFile.mockImplementation((command, _args, _options, callback) => {
      callback(command === "/usr/bin/osascript" ? new Error("Automation denied") : null, "");
    });
    expect(await openTokenPage("eu", "darwin")).toBeUndefined();
    expect(execFile.mock.calls.at(-1)?.slice(0, 3)).toEqual([
      "/usr/bin/open", ["https://edstem.org/eu/settings/api-tokens"], { timeout: 5_000, windowsHide: true },
    ]);
  });

  it.each([
    ["win32", "rundll32.exe", ["url.dll,FileProtocolHandler", "https://edstem.org/eu/settings/api-tokens"]],
    ["linux", "xdg-open", ["https://edstem.org/eu/settings/api-tokens"]],
  ] as const)("uses the regular browser on %s", async (platform, command, args) => {
    expect(await openTokenPage("eu", platform)).toBeUndefined();
    expect(execFile).toHaveBeenCalledWith(command, [...args], { timeout: 5_000, windowsHide: true }, expect.any(Function));
    expect(execFile).toHaveBeenCalledTimes(1);
  });

  it("reports launcher failures to the login flow", async () => {
    execFile.mockImplementation((_command, _args, _options, callback) => callback(new Error("Launcher failed")));
    await expect(openTokenPage("au", "linux")).rejects.toThrow("Launcher failed");
  });
});
