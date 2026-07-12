import { Command } from "commander";

import { VERSION } from "./version.js";

export function createProgram(): Command {
  return new Command("edstem")
    .description("Agent-first CLI for Ed Discussion.")
    .version(VERSION);
}

async function main(): Promise<void> {
  await createProgram().parseAsync(process.argv);
}

if (import.meta.url === new URL(process.argv[1] ?? "", "file:").href) {
  void main();
}
