import { writeFileSync } from "node:fs";

import { commandsJson, type CommandDescription } from "@bunizao/cli-kit";
import type { Command } from "commander";

import { MCP_TOOL_CATALOG } from "./mcp/catalog.js";

export const SKILL_SOURCE = "https://github.com/bunizao/edstem-cli";
export const SKILL_DESCRIPTION =
  "Read and update Ed Discussion (units, threads, lessons, files, quizzes, activity) through the edstem CLI, a local stdio MCP server, or the hosted MCP server. Start from what the user said, not from ids.";

// Rows are what a person says, mapped to the one command that answers it.
// UNIT is the unit's Ed course ID or its code exactly as Ed shows it.
const INTENTS: readonly (readonly [string, string, string])[] = [
  ["which units am I in / how are units named here", "`edstem units`", "shows id, code, name; copy the code as shown"],
  ["what's being discussed / any questions about X / latest in UNIT", "`edstem threads UNIT --limit 20`", "add `--unanswered`, `--category`, `--subcategory`"],
  ["any threads about <topic> in UNIT", "`edstem threads search UNIT <words...>`", "every word must match title or body; add `--since 7d`"],
  ["what does thread #N say / read that thread", "`edstem threads read UNIT#N`", "a global thread id also works"],
  ["my posts / did anyone reply to me", "`edstem activity [UNIT]`", ""],
  ["which lessons, weeks or modules exist / what's unfinished", "`edstem lessons UNIT`", "then `--status unattempted` or `--module <text>`"],
  ["what's in a lesson / the slides", "`edstem lessons show <lesson id>`", "lesson id from `edstem lessons UNIT`"],
  ["download the slides / files", "`edstem files get <lesson id> --dest DIR`", "`files list` first to see what exists"],
  ["quiz questions / what did I answer", "`edstem slides show <slide id> --section questions`", "`--section responses` for saved answers"],
  ["mark lessons as read or complete (only when asked)", "`edstem lessons mark-read UNIT [words...] --dry-run`", "then repeat with `--yes`"],
  ["answer or submit a quiz (only when asked)", "`edstem slides submit <slide id> --question ID --choice N`", "then `edstem slides submit <slide id>` to finalise"],
  ["post a thread or reply (only when asked)", "`edstem threads send UNIT --title T --body-file F --dry-run`", "`edstem replies send UNIT#N --body-file F --dry-run`; repeat with `--yes` after the user approves"],
  ["is my token working", "`edstem auth status`", ""],
];

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

## What the user says, and what to run

\`UNIT\` is the unit's Ed course ID or its code exactly as Ed shows it. Do not assume what
a code looks like; \`edstem units\` is the vocabulary for this site. If one code matches
several enrolments, use the numeric ID shown by \`edstem units --archived\`. Never ask the
user for numeric ids when a code or a \`UNIT#N\` thread number will do.

${markdownTable(["The user says", "Run", "Notes"], INTENTS.map((row) => [...row]))}

MCP clients use the tool with the same noun: \`list_threads\`, \`get_course_thread\`,
\`list_lessons\`, \`list_lesson_files\`, \`list_slide_questions\`. Every \`courseId\` accepts
the same \`UNIT\` reference, so no \`list_courses\` call is needed first.

## Agent rules

- Run the narrowest command or tool that answers the request; one call per intent.
- Successful piped output is JSON by default. Use \`--fields\` to retain only needed top-level fields.
- Use \`--json\`, \`--yaml\`, or \`--table\` only when overriding TTY-based format selection.
- The \`read\` verb prints Markdown and never mutates upstream state.
- Commands marked as mutating require explicit user intent and either an interactive confirmation or \`--yes\`.
- Use \`--dry-run\` to inspect a mutation plan without changing Ed state.
- Category, subcategory, module and type filters must be spelled as Ed shows them; an invalid filter lists the values available in that unit.
- Treat Ed API tokens as passwords. Never print, log, or persist them in project files.
- \`edstem commands --json\` is the source of truth for this command tree; the published \`@bunizao/cli-kit\` npm package (\`^0.1.0\`) defines the shared CLI contract.

## Setup

\`\`\`bash
npm install -g edstem-cli
export EDSTEM_TOKEN="your-token"
edstem units
\`\`\`

## CLI reference

${markdownTable(["Command", "Description", "Arguments", "Options", "Mutating"], cliRows)}

Global options: \`--json\`, \`--yaml\`, \`--table\`, \`--fields a,b\`, \`--output FILE\`, \`--verbose\`, \`--no-color\`, \`--yes\`, and \`--dry-run\`.

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
    // cli-kit's description has no hidden bit; a hidden alias is the only option without help text.
    command.options.filter((option) => option.description).map((option) => option.flags).join("<br>"),
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
