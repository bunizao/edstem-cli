import {
  CliError,
  commandsJson,
  confirm,
  createProgram as createCliProgram,
  insertDefaultVerb,
  mutating,
  render,
  reportError,
  resolveFormat,
  writeOutput,
  type FormatOptions,
  type NounSpec,
  type OutputFormat,
} from "@bunizao/cli-kit";
import type { Command } from "commander";

import { loadToken } from "./auth.js";
import { loadConfig } from "./config.js";
import { downloadLessonFiles } from "./download.js";
import { EdClient } from "./ed/client.js";
import { listLessonFiles } from "./ed/files.js";
import {
  listCurrentActivity,
  listLessons,
  listThreads,
  readLessons,
  resolveThread,
} from "./ed/operations.js";
import {
  compactActivity,
  projectCourse,
  projectIdentity,
  projectLessonDetail,
  projectLessonSummary,
  projectQuestion,
  projectQuestionResponse,
  projectThreadDetail,
  projectThreadSummary,
} from "./ed/projections.js";
import { normalizeEdError } from "./errors.js";
import { lessonToMarkdown, threadToMarkdown } from "./markdown.js";
import { isMainModule } from "./main.js";
import { writeGeneratedSkill } from "./skills.js";
import { VERSION } from "./version.js";

const SORT_OPTIONS = ["new", "old", "top", "hot"] as const;
const SLIDE_SECTIONS = ["slide", "questions", "responses", "quiz"] as const;

const NOUNS: readonly NounSpec[] = [
  {
    name: "units",
    aliases: ["courses", "projects"],
    verbs: ["list", "show"],
    defaultByArity: { 0: "list", 1: "show" },
  },
  {
    name: "threads",
    verbs: ["list", "show", "read"],
    defaultByArity: { 1: "list" },
    valueFlags: [
      "-n",
      "--max",
      "-s",
      "--sort",
      "-c",
      "--category",
      "--subcategory",
      "-t",
      "--type",
    ],
  },
  {
    name: "lessons",
    verbs: ["list", "show", "mark-read"],
    defaultByArity: { 1: "list" },
    valueFlags: ["--module", "--type", "--state", "--status", "--delay"],
  },
  {
    name: "slides",
    verbs: ["show", "submit"],
    defaultByArity: { 1: "show" },
    valueFlags: ["--section", "--question", "--choice"],
  },
  {
    name: "files",
    verbs: ["list", "get"],
    defaultByArity: { 1: "list" },
    valueFlags: ["--dest", "--slide"],
  },
];

export interface CliRuntime {
  createClient: () => Promise<EdClient>;
  defaultFetchCount: () => Promise<number>;
  interactive: boolean;
  isTTY: boolean;
  writeStderr: (text: string) => void;
  writeOutput?: (text: string, output?: string) => Promise<void>;
  writeStdout: (text: string) => void;
}

interface GlobalOptions extends FormatOptions {
  dryRun?: boolean;
  output?: string;
  yes?: boolean;
}

export function createProgram(runtime: CliRuntime = createDefaultRuntime()): Command {
  const program = createCliProgram({
    name: "edstem",
    version: VERSION,
    description: "CLI for Ed Discussion.",
  });

  program.command("auth")
    .description("Inspect Ed authentication.")
    .command("status")
    .description("Verify the configured Ed token.")
    .action(outputAction(runtime, async (client) => {
      const identity = projectIdentity(await client.fetchUser());
      return { authenticated: true, user: identity.user };
    }));

  program.command("user")
    .description("Show the current Ed identity and enrolled units.")
    .action(outputAction(runtime, async (client) => {
      const identity = projectIdentity(await client.fetchUser());
      return { ...(identity.user as Record<string, unknown>), units: identity.courses };
    }));

  const units = program.command("units")
    .aliases(["courses", "projects"])
    .description("List or show enrolled units.");
  units.command("list")
    .description("List enrolled units.")
    .option("--archived", "Include archived units.")
    .action(outputAction(runtime, async (client, command) => {
      const { courses } = await client.fetchUser();
      const includeArchived = Boolean(command.opts().archived);
      return courses
        .filter((course) => includeArchived || course.status.toLowerCase() !== "archived")
        .map(projectCourse);
    }));
  units.command("show")
    .description("Show one enrolled unit.")
    .argument("<unit>", "Unit ID or code", unitIdentifier)
    .action(outputAction(runtime, async (client, _command, unit: string) => {
      const { courses } = await client.fetchUser();
      const course = courses.find((candidate) =>
        String(candidate.id) === unit || candidate.code.toLowerCase() === unit.toLowerCase()
      );
      if (!course) throw new CliError("not_found", `Unit ${unit} was not found.`);
      return projectCourse(course);
    }));

  const threads = program.command("threads").description("List, show, or read Ed threads.");
  threads.command("list")
    .description("List threads in a unit.")
    .argument("<unit>", "Unit ID", positiveInteger)
    .option("-n, --max <count>", "Maximum threads to fetch", positiveInteger)
    .addOption(program.createOption(
      "-s, --sort <order>",
      "Ed sort order; defaults to new and pinned threads may remain first."
    ).choices([...SORT_OPTIONS]).default("new"))
    .option("-c, --category <category>", "Filter by exact top-level category.")
    .option("--subcategory <subcategory>", "Filter by exact second-level subcategory.")
    .option("-t, --type <type>", "Filter by thread type.")
    .option("--answered", "Only answered threads.")
    .option("--unanswered", "Only unanswered threads.")
    .action(outputAction(runtime, async (client, command, unit: number) => {
      const options = command.opts();
      if (options.answered && options.unanswered) {
        throw new CliError("usage", "Use only one of --answered or --unanswered.");
      }
      const limit = options.max ?? await runtime.defaultFetchCount();
      const values = await listThreads(client, {
        answered: options.answered ? true : options.unanswered ? false : undefined,
        category: options.category,
        courseId: unit,
        limit,
        sort: options.sort,
        subcategory: options.subcategory,
        threadType: options.type,
      });
      return values.map(projectThreadSummary);
    }));
  threads.command("show")
    .description("Show a thread by ID or unit_id#number.")
    .argument("<reference>", "Thread ID or unit_id#number")
    .option("--include-html", "Include Ed XML content.")
    .action(outputAction(runtime, async (client, command, reference: string) => {
      const thread = await resolveThread(client, reference);
      return projectThreadDetail(thread, { includeHtml: command.opts().includeHtml });
    }));
  threads.command("read")
    .description("Read a thread body as Markdown.")
    .argument("<reference>", "Thread ID or unit_id#number")
    .action(textAction(runtime, async (client, _command, reference: string) =>
      threadToMarkdown(await resolveThread(client, reference))
    ));

  const lessons = program.command("lessons").description("List, show, or mark lessons as read.");
  lessons.command("list")
    .description("List lessons in a unit.")
    .argument("<unit>", "Unit ID", positiveInteger)
    .option("--module <module>", "Module ID or name text; use all to disable.")
    .option("--type <type>", "Exact lesson type, such as general; use all to disable.")
    .option("--state <state>", "Exact state, such as active or scheduled; use all to disable.")
    .option("--status <status>", "Progress: unattempted, attempted, completed, or all.")
    .action(outputAction(runtime, async (client, command, unit: number) =>
      (await listLessons(client, unit, command.opts())).map(projectLessonSummary)
    ));
  lessons.command("show")
    .description("Show one lesson and its slides.")
    .argument("<lesson>", "Lesson ID", positiveInteger)
    .action(outputAction(runtime, async (client, _command, lesson: number) =>
      projectLessonDetail(await client.fetchLesson(lesson))
    ));
  mutating(lessons.command("mark-read")
    .description("Mark matching lessons and slides as read.")
    .argument("<unit>", "Unit ID", positiveInteger)
    .argument("[queries...]", "Words required in lesson or module names")
    .option("--delay <seconds>", "Delay between slide updates", nonNegativeNumber, 0)
    .action(mutationAction(runtime,
      (command, unit: number, queries: string[]) => ({
        summary: `Mark lessons as read in unit ${unit}${queries.length ? ` matching: ${queries.join(", ")}` : ""}.`,
      }),
      async (client, command, unit: number, queries: string[]) =>
        readLessons(client, unit, queries, command.opts().delay)
    )));

  const slides = program.command("slides").description("Inspect or submit lesson slides.");
  slides.command("show")
    .description("Show slide content, questions, responses, or quiz context.")
    .argument("<slide>", "Slide ID", positiveInteger)
    .addOption(program.createOption("--section <section>", "Slide section").choices([...SLIDE_SECTIONS]).default("slide"))
    .action(outputAction(runtime, async (client, command, slide: number) => {
      const section = command.opts().section as typeof SLIDE_SECTIONS[number];
      if (section === "questions" || section === "quiz") {
        return (await client.fetchSlideQuestions(slide)).map(projectQuestion);
      }
      if (section === "responses") {
        return (await client.fetchSlideQuestionResponses(slide)).map(projectQuestionResponse);
      }
      return client.fetchSlide(slide);
    }));
  mutating(slides.command("submit")
    .description("Save one answer or submit all saved answers for a slide.")
    .argument("<slide>", "Slide ID", positiveInteger)
    .option("--question <question>", "Question ID to answer", positiveInteger)
    .option("--choice <number>", "One-based choice; repeat for multi-select", collectPositiveInteger, [])
    .option("--amend", "Amend an existing response.")
    .action(mutationAction(runtime,
      (command, slide: number) => {
        const options = command.opts();
        if (options.choice.length > 0 && options.question === undefined) {
          throw new CliError("usage", "--choice requires --question.");
        }
        if (options.amend && options.question === undefined) {
          throw new CliError("usage", "--amend requires --question.");
        }
        return {
          summary: options.question
            ? `Save an answer for question ${options.question} on slide ${slide}.`
            : `Submit all saved answers for slide ${slide}.`,
        };
      },
      async (client, command, slide: number) => {
        const options = command.opts();
        if (options.question !== undefined) {
          return client.submitSlideAnswer(
            options.question,
            options.choice.map((choice: number) => choice - 1),
            { amend: options.amend }
          );
        }
        return client.submitSlide(slide);
      }
    )));

  const files = program.command("files").description("List or download lesson files.");
  files.command("list")
    .description("List downloadable files in one lesson.")
    .argument("<lesson>", "Lesson ID", positiveInteger)
    .action(outputAction(runtime, async (client, _command, lesson: number) =>
      listLessonFiles(await client.fetchLesson(lesson))
    ));
  files.command("get")
    .description("Download files from one lesson.")
    .argument("<lesson>", "Lesson ID", positiveInteger)
    .option("--dest <directory>", "Destination directory", ".")
    .option("--slide <slide>", "Download only one slide file", positiveInteger)
    .option("--force", "Replace existing files.")
    .action(outputAction(runtime, async (client, command, lessonId: number) => {
      const options = command.opts();
      const available = listLessonFiles(await client.fetchLesson(lessonId));
      const selected = options.slide === undefined
        ? available
        : available.filter((file) => file.slideId === options.slide);
      if (options.slide !== undefined && selected.length === 0) {
        throw new CliError(
          "not_found",
          `No downloadable file was found for slide ${options.slide} in lesson ${lessonId}.`
        );
      }
      return {
        lessonId,
        downloads: await downloadLessonFiles(client, selected, {
          destination: options.dest,
          force: options.force,
        }),
      };
    }));

  program.command("activity")
    .description("List current-user activity.")
    .argument("[unit]", "Unit ID", positiveInteger)
    .option("-n, --max <count>", "Maximum activity items", positiveInteger)
    .option("-f, --filter <type>", "Activity type", "all")
    .action(outputAction(runtime, async (client, command, unit?: number) => {
      const limit = command.opts().max ?? await runtime.defaultFetchCount();
      return compactActivity(await listCurrentActivity(client, {
        courseId: unit,
        filterType: command.opts().filter,
        limit,
      }));
    }));

  program.command("commands")
    .description("Describe the complete command tree.")
    .action(async (_options: unknown, command: Command) => {
      await writeValue(runtime, command, commandsJson(program));
    });

  program.command("skills")
    .description("Generate the agent skill.")
    .command("generate")
    .description("Regenerate SKILL.md from command metadata.")
    .action(async (_options: unknown, command: Command) => {
      writeGeneratedSkill(program);
      await writeValue(runtime, command, { generated: "SKILL.md" });
    });

  return program as Command;
}

function createDefaultRuntime(): CliRuntime {
  let client: Promise<EdClient> | undefined;
  return {
    createClient: () => {
      client ??= Promise.all([loadToken(), loadConfig()]).then(([token, config]) =>
        new EdClient({ apiBaseUrl: config.apiBaseUrl, token })
      );
      return client;
    },
    defaultFetchCount: async () => (await loadConfig()).fetchCount,
    interactive: Boolean(process.stdin.isTTY),
    isTTY: Boolean(process.stdout.isTTY),
    writeStderr: (text) => process.stderr.write(text),
    writeOutput: (text, output) => writeOutput(text, { output }),
    writeStdout: (text) => process.stdout.write(text),
  };
}

function outputAction<Arguments extends unknown[]>(
  runtime: CliRuntime,
  action: (client: EdClient, command: Command, ...args: Arguments) => Promise<unknown>
): (...args: [...Arguments, Command]) => Promise<void> {
  return async (...args): Promise<void> => {
    const command = args.at(-1) as Command;
    const result = await action(await runtime.createClient(), command, ...args.slice(0, -1) as Arguments);
    await writeValue(runtime, command, result);
  };
}

function textAction<Arguments extends unknown[]>(
  runtime: CliRuntime,
  action: (client: EdClient, command: Command, ...args: Arguments) => Promise<string>
): (...args: [...Arguments, Command]) => Promise<void> {
  return async (...args): Promise<void> => {
    const command = args.at(-1) as Command;
    const text = await action(await runtime.createClient(), command, ...args.slice(0, -1) as Arguments);
    await writeText(runtime, text, outputOptions(command).output);
  };
}

function mutationAction<Arguments extends unknown[]>(
  runtime: CliRuntime,
  plan: (command: Command, ...args: Arguments) => { summary: string },
  action: (client: EdClient, command: Command, ...args: Arguments) => Promise<unknown>
): (...args: [...Arguments, Command]) => Promise<void> {
  return async (...args): Promise<void> => {
    const command = args.at(-1) as Command;
    const actionArgs = args.slice(0, -1) as Arguments;
    const options = outputOptions(command);
    const accepted = await confirm(plan(command, ...actionArgs), {
      yes: Boolean(options.yes),
      dryRun: Boolean(options.dryRun),
      interactive: runtime.interactive,
    });
    if (!accepted) return;
    await writeValue(runtime, command, await action(await runtime.createClient(), command, ...actionArgs));
  };
}

async function writeValue(runtime: CliRuntime, command: Command, value: unknown): Promise<void> {
  const options = outputOptions(command);
  const format = resolveFormat(options, runtime.isTTY);
  const fields = options.fields?.split(",").map((field) => field.trim()).filter(Boolean);
  await writeText(runtime, render(value, { format, fields }), options.output);
}

async function writeText(runtime: CliRuntime, text: string, output?: string): Promise<void> {
  const normalized = text.endsWith("\n") ? text : `${text}\n`;
  if (runtime.writeOutput) {
    await runtime.writeOutput(normalized, output);
    return;
  }
  if (output) {
    await writeOutput(normalized, { output });
    return;
  }
  runtime.writeStdout(normalized);
}

function outputOptions(command: Command): GlobalOptions {
  return command.optsWithGlobals() as GlobalOptions;
}

function positiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new CliError("usage", "Value must be a positive integer.");
  }
  return parsed;
}

function unitIdentifier(value: string): string {
  if (/^\d+$/.test(value) || /^[a-z]{2,}\d{3,}[a-z0-9_-]*$/i.test(value)) return value;
  throw new CliError("usage", "Unit must be a numeric ID or unit code.");
}

function nonNegativeNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new CliError("usage", "Value must be greater than or equal to 0.");
  }
  return parsed;
}

function collectPositiveInteger(value: string, previous: number[]): number[] {
  return [...previous, positiveInteger(value)];
}

export async function run(argv = process.argv, runtime?: CliRuntime): Promise<number> {
  const selectedRuntime = runtime ?? createDefaultRuntime();
  const args = insertDefaultVerb(argv.slice(2), NOUNS);
  const program = createProgram(selectedRuntime);
  try {
    await program.parseAsync(args, { from: "user" });
    return 0;
  } catch (error) {
    if (isCommanderSuccess(error)) return 0;
    const normalized = normalizeEdError(error);
    const format = safeErrorFormat(program, selectedRuntime.isTTY);
    const reported = reportError(normalized, format);
    selectedRuntime.writeStderr(reported.text);
    return reported.exitCode;
  }
}

function isCommanderSuccess(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return (error as { exitCode?: unknown }).exitCode === 0;
}

function safeErrorFormat(program: Command, isTTY: boolean): OutputFormat {
  try {
    return resolveFormat(program.opts() as FormatOptions, isTTY);
  } catch {
    return isTTY ? "table" : "json";
  }
}

if (isMainModule(import.meta.url)) {
  void run().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
