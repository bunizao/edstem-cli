import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { McpServer } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { saveToken } from "../src/auth.js";
import { run } from "../src/cli.js";
import { startStdioServer } from "../src/mcp.js";
import * as mcpServer from "../src/mcp/server.js";
import { ED_REGIONS } from "../src/regions.js";

const paths = vi.hoisted(() => ({ directory: "", tokenFile: "" }));
vi.mock("node:os", async (original) => ({
  ...await original<typeof import("node:os")>(),
  homedir: () => paths.directory,
}));

describe("saved region in the default runtimes", () => {
  let directory: string;
  const identity = JSON.parse(readFileSync(new URL("fixtures/user_info.json", import.meta.url), "utf8"));
  const fetch = vi.fn();

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "edstem-auth-runtime-"));
    paths.directory = directory;
    paths.tokenFile = join(directory, ".config", "edstem-cli", "token");
    vi.stubEnv("EDSTEM_TOKEN", "");
    vi.stubEnv("EDSTEM_REGION", "");
    vi.stubEnv("EDSTEM_BASE_URL", "");
    vi.stubEnv("EDSTEM_CONFIG", join(directory, "missing.yaml"));
    fetch.mockReset().mockImplementation(async () => new Response(JSON.stringify(identity)));
    vi.stubGlobal("fetch", fetch);
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
});
