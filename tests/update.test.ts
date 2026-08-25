import { describe, expect, it } from "vitest";

import type { FetchLike } from "../src/ed/client.js";
import { checkForUpdate, compareVersions } from "../src/update.js";

describe("update checks", () => {
  it("compares semantic versions", () => {
    expect(compareVersions("0.5.0", "0.4.9")).toBe(1);
    expect(compareVersions("0.4.0", "0.4.0")).toBe(0);
  });

  it("returns a stable npm upgrade command", async () => {
    const fetch: FetchLike = async () => new Response(JSON.stringify({ version: "0.6.0" }), { status: 200 });

    await expect(checkForUpdate(fetch)).resolves.toMatchObject({
      currentVersion: "0.5.0",
      latestVersion: "0.6.0",
      updateAvailable: true,
      upgradeCommand: "npm install -g edstem-cli@latest",
    });
  });
});
