import { writeFileSync } from "node:fs";

import { commandsJson, type CommandDescription } from "@bunizao/cli-kit";
import type { Command } from "commander";

import { MCP_TOOL_CATALOG } from "./mcp/catalog.js";

export const SKILL_SOURCE = "https://github.com/bunizao/edstem-cli";
export const SKILL_DESCRIPTION =
  "Inspect Ed Discussion through its CLI, local stdio MCP server, or hosted MCP server. Use for units, lessons, threads, activity, quiz responses, and lesson progress. Prefer narrow queries and compact output.";

export function writeGeneratedSkill(program: Command, target = "SKILL.md"): void {
  writeFileSync(target, generateSkillMarkdown(program), "utf8");
}

export function generateSkillMarkdown(program: Command): string {
  const metadata = commandsJson(program);
  const cliRows = metadata.commands.flatMap((command) => collectCommands(command));
  const mcpRows = MCP_TOOL_CATALOG.map(([name, description]) => [name, description]);
  return `---
name: edstem-cli
description: ${SKILL_DESCRIPTION}
---

# edstem-cli

Choose the narrowest surface that fits the environment:

- Use \`edstem\` for shell access, scripts, and deterministic automation.
- Use \`edstem-mcp\` when a local MCP client can launch a stdio server with \`EDSTEM_TOKEN\`.
- Use \`https://edstem.tuuhub.com/mcp\` when the client needs hosted Streamable HTTP and OAuth.

## Agent rules

- Run the narrowest command or tool that answers the request.
- Successful piped output is JSON by default. Use \`--fields\` to retain only needed top-level fields.
- Use \`--json\`, \`--yaml\`, or \`--table\` only when overriding TTY-based format selection.
- Use the \`read\` verb only for Markdown output. It never mutates upstream state.
- Commands marked as mutating require explicit user intent and either an interactive confirmation or \`--yes\`.
- Use \`--dry-run\` to inspect a mutation plan without changing Ed state.
- Treat Ed API tokens as passwords. Never print, log, or persist them in project files.

## Setup

\`\`\`bash
npm install -g edstem-cli
export EDSTEM_TOKEN="your-token"
edstem units --fields id,code,name
\`\`\`

## CLI reference

${markdownTable(["Command", "Description", "Arguments", "Options", "Mutating"], cliRows)}

Global options: \`--json\`, \`--yaml\`, \`--table\`, \`--fields a,b\`, \`--output FILE\`, \`--quiet\`, \`--verbose\`, \`--no-color\`, \`--yes\`, and \`--dry-run\`.

Run \`edstem commands --json\` for machine-readable metadata, including aliases, enum values, and mutation markers.

## MCP tools

${markdownTable(["Tool", "Description"], mcpRows)}

## Errors

Errors are rendered exactly once on stderr. Exit codes: 0 success, 1 network/config/unexpected, 2 usage, 3 auth, 4 not found, 5 upstream, 130 cancelled.
`;
}

function collectCommands(command: CommandDescription, parent: string[] = []): string[][] {
  const path = [...parent, command.name];
  const row = [
    `edstem ${path.join(" ")}`,
    command.description,
    command.positionals.map((argument) => {
      const suffix = argument.variadic ? "..." : "";
      return argument.required ? `<${argument.name}${suffix}>` : `[${argument.name}${suffix}]`;
    }).join(" "),
    command.options.map((option) => option.flags).join("<br>"),
    command.mutating ? "yes" : "no",
  ];
  return [row, ...command.commands.flatMap((child) => collectCommands(child, path))];
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
