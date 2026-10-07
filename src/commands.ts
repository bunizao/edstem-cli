import { mutating as markMutating, type CommandDescription, type ProgramDescription } from "@bunizao/cli-kit";
import type { Command } from "commander";

const mutations = new WeakSet<Command>();

export function mutating(command: Command): Command {
  mutations.add(command);
  return markMutating(command);
}

// cli-kit restricts metadata to its fixed verb list; Ed also has paired thread actions.
export function commandsJson(program: Command): ProgramDescription {
  const describe = (command: Command, noun?: string): CommandDescription => ({
    name: command.name(),
    noun: noun ?? command.name(),
    ...(noun && noun !== "auth" && noun !== "skills" ? { verb: command.name() } : {}),
    aliases: command.aliases(),
    description: command.description(),
    positionals: command.registeredArguments.map((argument) => ({
      name: argument.name(),
      description: argument.description,
      required: argument.required,
      variadic: argument.variadic,
      ...(argument.argChoices ? { enumValues: argument.argChoices } : {}),
    })),
    options: command.options.filter((option) => !option.hidden).map((option) => ({
      flags: option.flags,
      description: option.description,
      required: option.required,
      variadic: option.variadic,
      ...(option.argChoices ? { enumValues: option.argChoices } : {}),
    })),
    mutating: mutations.has(command),
    commands: command.commands.filter((child) => child.name() !== "help")
      .map((child) => describe(child, noun ?? command.name())),
  });
  return {
    name: program.name(),
    version: program.version() ?? "",
    description: program.description(),
    commands: program.commands.filter((command) => command.name() !== "help")
      .map((command) => describe(command)),
  };
}
