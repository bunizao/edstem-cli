import { mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { isMainModule } from "../src/main.js";

describe("main module detection", () => {
  it("resolves npm-style executable symlinks", async () => {
    const directory = await mkdtemp(join(tmpdir(), "edstem-main-"));
    const target = join(directory, "edstem.js");
    const link = join(directory, "edstem");
    await writeFile(target, "", "utf8");
    await symlink(target, link);

    expect(isMainModule(pathToFileURL(target).href, link)).toBe(true);
  });
});
