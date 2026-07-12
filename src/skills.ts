import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

import type { Command } from "commander";

import { MCP_TOOL_CATALOG } from "./mcp/catalog.js";

export const SKILL_SOURCE = "https://github.com/bunizao/edstem-cli";
export const SKILL_DESCRIPTION =
  "Inspect Ed Discussion with the edstem CLI or MCP server. Use for courses, lessons, threads, activity, quiz responses, and lesson progress. Prefer narrow commands and compact output.";

export function formatSkillSummary(): Record<string, unknown> {
  return {
    name: "edstem-cli",
    description: SKILL_DESCRIPTION,
    source: SKILL_SOURCE,
    install: `npx skills add ${SKILL_SOURCE}`,
    generate: "edstem skills generate",
  };
}

export function addSkill(extraArgs: string[] = []): string[] {
  const command = ["npx", "skills", "add", SKILL_SOURCE, ...extraArgs];
  const result = spawnSync(command[0], command.slice(1), { stdio: "inherit" });
  if (result.error) {
    throw new Error(`Failed to launch ${command.join(" ")}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${command.join(" ")} exited with status ${result.status ?? "unknown"}`);
  }
  return command;
}

export function writeGeneratedSkill(program: Command, target = "SKILL.md"): void {
  writeFileSync(target, generateSkillMarkdown(program), "utf8");
}

export function generateSkillMarkdown(program: Command): string {
  const cliRows = collectCommands(program)
    .map((command) => [
      `edstem ${command.path.join(" ")}`,
      command.description,
      command.arguments,
      command.options,
    ]);
  const mcpRows = MCP_TOOL_CATALOG.map(([name, description]) => [name, description]);
  return `---
name: edstem-cli
description: ${SKILL_DESCRIPTION}
---

# edstem-cli

Use \`edstem\` for Ed Discussion access or \`edstem-mcp\` as a local stdio MCP server.

## Agent rules

- Run the narrowest command that answers the request.
- JSON is the default. Add \`--fields\` to keep only needed top-level fields.
- List commands return summaries. Fetch one lesson or thread only when its detail is needed.
- Use \`--include-html\` only when raw Ed XML matters.
- Treat \`ED_API_TOKEN\` as a password. Never print, log, or persist it in project files.
- \`lessons read\`, \`mark_lessons_read\`, and quiz submission tools change the current user's Ed state.

## Setup

\`\`\`bash
npm install -g edstem-cli
export ED_API_TOKEN="your-token"
edstem user --fields id,name,courses
\`\`\`

## CLI reference

${markdownTable(["Command", "Description", "Arguments", "Options"], cliRows)}

Global output options: \`--json\`, \`--pretty\`, \`--fields a,b\`, and \`--output FILE\`.

## MCP tools

${markdownTable(["Tool", "Description"], mcpRows)}

## Errors

CLI failures are one compact JSON line on stderr with \`error.code\` and \`error.message\`. Exit codes: 0 success, 1 unexpected, 2 input/config, 3 auth, 4 not found, 5 upstream.
`;
}

interface CommandRow {
  arguments: string;
  description: string;
  options: string;
  path: string[];
}

function collectCommands(command: Command, parent: string[] = []): CommandRow[] {
  return command.commands.filter((child) => !isHidden(child)).flatMap((child) => {
    const path = [...parent, child.name()];
    const row: CommandRow = {
      arguments: readArguments(child),
      description: child.description(),
      options: child.options.map((option) => option.flags).join("<br>"),
      path,
    };
    return [row, ...collectCommands(child, path)];
  });
}

function isHidden(command: Command): boolean {
  return Boolean((command as unknown as { _hidden?: boolean })._hidden);
}

function readArguments(command: Command): string {
  const registered = (command as unknown as { registeredArguments?: Array<Record<string, unknown>> })
    .registeredArguments ?? [];
  return registered.map((argument) => {
    const name = typeof argument.name === "function"
      ? String(argument.name.call(argument))
      : String(argument.name ?? "");
    const variadic = argument.variadic ? "..." : "";
    return argument.required ? `<${name}${variadic}>` : `[${name}${variadic}]`;
  }).join(" ");
}

function markdownTable(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(escapeCell).join(" | ")} |`),
  ].join("\n");
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}
