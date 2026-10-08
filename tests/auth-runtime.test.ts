import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { McpServer } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as cliKit from "@bunizao/cli-kit";

import { saveToken } from "../src/auth.js";
import { openTokenPage } from "../src/browser.js";
import { run } from "../src/cli.js";
import { startStdioServer } from "../src/mcp.js";
import * as mcpServer from "../src/mcp/server.js";
import { ED_REGIONS } from "../src/regions.js";

const paths = vi.hoisted(() => ({ directory: "", tokenFile: "" }));
vi.mock("node:os", async (original) => ({
  ...await original<typeof import("node:os")>(),
  homedir: () => paths.directory,
}));
vi.mock("../src/browser.js", () => ({ openTokenPage: vi.fn() }));
vi.mock("@bunizao/cli-kit", async (original) => {
  const actual = await original<typeof import("@bunizao/cli-kit")>();
  return { ...actual, createUi: vi.fn(actual.createUi) };
});
const actualCliKit = await vi.importActual<typeof import("@bunizao/cli-kit")>("@bunizao/cli-kit");

describe("saved region in the default runtimes", () => {
  let directory: string;
  const identity = JSON.parse(readFileSync(new URL("fixtures/user_info.json", import.meta.url), "utf8"));
  const fetch = vi.fn();

  beforeEach(async () => {
    vi.mocked(cliKit.createUi).mockReset().mockImplementation(actualCliKit.createUi);
    directory = await mkdtemp(join(tmpdir(), "edstem-auth-runtime-"));
    paths.directory = directory;
    paths.tokenFile = join(directory, ".config", "edstem-cli", "token");
    vi.stubEnv("EDSTEM_TOKEN", "");
    vi.stubEnv("EDSTEM_REGION", "");
    vi.stubEnv("EDSTEM_BASE_URL", "");
    vi.stubEnv("EDSTEM_CONFIG", join(directory, "missing.yaml"));
    fetch.mockReset().mockImplementation(async () => new Response(JSON.stringify(identity)));
    vi.stubGlobal("fetch", fetch);
    vi.mocked(openTokenPage).mockReset().mockResolvedValue(undefined);
    vi.spyOn(process.stdout, "write").mockImplementation((...args: unknown[]) => {
      const callback = args.at(-1);
      if (typeof callback === "function") callback();
      return true;
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    await rm(directory, { recursive: true, force: true });
  });

  it.each(["au", "us", "eu"] as const)("routes subsequent CLI requests to saved region %s", async (region) => {
    await saveToken("saved-token", paths.tokenFile, region);
    expect(await run(["node", "edstem", "user", "--json"])).toBe(0);
    expect(String(fetch.mock.calls[0]?.[0])).toBe(`${ED_REGIONS[region].apiBaseUrl}user`);
    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: "Bearer saved-token" });
  });

  it.each(["us", "eu"] as const)("routes stdio MCP requests to saved region %s", async (region) => {
    await saveToken("mcp-token", paths.tokenFile, region);
    vi.spyOn(McpServer.prototype, "connect").mockResolvedValue(undefined);
    const createServer = vi.spyOn(mcpServer, "createEdMcpServer");
    await startStdioServer();
    const runtime = createServer.mock.calls[0]![0];
    const client = await runtime.getClient({});
    await client.fetchUser();
    expect(String(fetch.mock.calls[0]?.[0])).toBe(`${ED_REGIONS[region].apiBaseUrl}user`);
    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: "Bearer mcp-token" });
  });

  it("uses EDSTEM_REGION with an environment token", async () => {
    await saveToken("saved-au-token", paths.tokenFile, "au");
    vi.stubEnv("EDSTEM_TOKEN", "env-token");
    vi.stubEnv("EDSTEM_REGION", "eu");
    expect(await run(["node", "edstem", "auth", "status", "--json"])).toBe(0);
    expect(String(fetch.mock.calls[0]?.[0])).toBe(`${ED_REGIONS.eu.apiBaseUrl}user`);
    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: "Bearer env-token" });
  });

  it("retains the explicit base URL override", async () => {
    await saveToken("saved-eu-token", paths.tokenFile, "eu");
    vi.stubEnv("EDSTEM_BASE_URL", "https://proxy.example/api/");
    expect(await run(["node", "edstem", "user", "--json"])).toBe(0);
    expect(String(fetch.mock.calls[0]?.[0])).toBe("https://proxy.example/api/user");
  });

  it("uses the recovery flow during first-run onboarding and saves only the successful region", async () => {
    const select = vi.fn().mockResolvedValueOnce("au").mockResolvedValueOnce("region")
      .mockResolvedValueOnce("us").mockResolvedValueOnce("retry");
    const password = vi.fn().mockResolvedValueOnce("wrong-token").mockResolvedValueOnce("us-token");
    const error = vi.fn();
    const ui = {
      ...cliKit.createUi({ interactive: false }), interactive: true, select, password,
      note: vi.fn(), info: vi.fn(), warn: vi.fn(), banner: vi.fn(),
      spinner: () => ({ start: vi.fn(), stop: vi.fn(), error, message: vi.fn() }),
    };
    vi.mocked(cliKit.createUi).mockReturnValue(ui);
    fetch.mockResolvedValueOnce(new Response('{"code":"bad_token"}', { status: 401 }))
      .mockRejectedValueOnce(new Error("Connection interrupted"));
    expect(await run(["node", "edstem", "user", "--json"])).toBe(0);
    expect(password).toHaveBeenCalledTimes(2);
    expect(vi.mocked(openTokenPage).mock.calls).toEqual([["au"], ["us"]]);
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      "https://edstem.org/api/user", "https://us.edstem.org/api/user",
      "https://us.edstem.org/api/user", "https://us.edstem.org/api/user",
    ]);
    expect(error.mock.calls.map(([message]) => message)).toEqual([
      "Ed did not accept this token in AU. Check the token and region.",
      "Could not reach Ed. Check your connection; the token has not been rejected.",
    ]);
    expect(JSON.parse(await readFile(paths.tokenFile, "utf8")))
      .toEqual({ token: "us-token", region: "us" });
  });

  it("exits with cancellation when first-run recovery is cancelled", async () => {
    const ui = {
      ...cliKit.createUi({ interactive: false }), interactive: true,
      select: vi.fn().mockResolvedValueOnce("eu").mockResolvedValueOnce("cancel"),
      password: vi.fn().mockResolvedValue("bad-token"),
      note: vi.fn(), info: vi.fn(), warn: vi.fn(), banner: vi.fn(),
      spinner: () => ({ start: vi.fn(), stop: vi.fn(), error: vi.fn(), message: vi.fn() }),
    };
    vi.mocked(cliKit.createUi).mockReturnValue(ui);
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
    fetch.mockResolvedValueOnce(new Response('{"code":"bad_token"}', { status: 401 }));
    expect(await run(["node", "edstem", "user", "--json"])).toBe(130);
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(readFile(paths.tokenFile, "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
  });
});
