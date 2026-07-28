import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createProgram } from "../src/cli.js";
import { generateSkillMarkdown, writeGeneratedSkill } from "../src/skills.js";

describe("generated skill", () => {
  it("includes CLI commands and MCP tools from canonical metadata", () => {
    const markdown = generateSkillMarkdown(createProgram());

    expect(markdown).toContain("edstem threads read");
    expect(markdown).toContain("get_course_thread");
    expect(markdown).toContain("mark_lessons_read");
    expect(markdown).toContain("--fields");
    expect(markdown).toContain("https://edstem.tuuhub.com/mcp");
    expect(markdown).toContain("Successful piped output is JSON by default");
    expect(markdown).toContain("require explicit user intent");
    expect(markdown).toContain("edstem commands --json");
    expect(markdown).toContain("| edstem lessons mark-read");
  });

  it("writes the generated skill deterministically", async () => {
    const directory = await mkdtemp(join(tmpdir(), "edstem-skill-"));
    const target = join(directory, "SKILL.md");
    const program = createProgram();

    writeGeneratedSkill(program, target);
    const first = await readFile(target, "utf8");
    writeGeneratedSkill(program, target);

    expect(await readFile(target, "utf8")).toBe(first);
  });
});
