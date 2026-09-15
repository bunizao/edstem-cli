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
import { readFile } from "node:fs/promises";

import {
  defaultTokenFile,
  loadToken,
  loadTokenWithSource,
  promptHiddenToken,
  removeToken,
  saveToken,
} from "./auth.js";
import { loadConfig } from "./config.js";
import { downloadLessonFiles } from "./download.js";
import { EdClient, type FetchLike } from "./ed/client.js";
import { listLessonFiles, listThreadFiles } from "./ed/files.js";
import { markdownToEdDocument } from "./ed/document.js";
import {
  assertCommentInThread,
  defaultReplyType,
  listCurrentActivity,
  listLessons,
  listThreads,
  parseSinceValue,
  readLessons,
  resolveCourse,
  resolveCourseId,
  resolveThread,
  type ThreadListOptions,
} from "./ed/operations.js";
import {
  projectActivity,
  projectComment,
  projectCourse,
  projectIdentity,
  projectLessonDetail,
  projectLessonSummary,
  projectQuestion,
  projectQuestionResponse,
  projectSlide,
  projectThreadDetail,
  projectThreadSummary,
} from "./ed/projections.js";
import { normalizeEdError } from "./errors.js";
import { lessonToMarkdown, slideToMarkdown, threadToMarkdown } from "./markdown.js";
import { isMainModule } from "./main.js";
import { writeGeneratedSkill } from "./skills.js";
import { applyUpdate, checkForUpdate } from "./update.js";
import { VERSION } from "./version.js";

const SORT_OPTIONS = ["new", "old", "top", "hot"] as const;
const SLIDE_SECTIONS = ["slide", "questions", "responses", "quiz"] as const;
const FILE_TARGET_HELP =
  "Lesson ID, or a thread as thread:<id> or thread:<unit>#<number>";

export type FileTarget =
  | { kind: "lesson"; id: number }
  | { kind: "thread"; reference: string };
const THREAD_TYPES = ["question", "post"] as const;
const REPLY_TYPES = ["answer", "comment"] as const;

const NOUNS: readonly NounSpec[] = [
  {
    name: "units",
    aliases: ["courses", "projects"],
    verbs: ["list", "show"],
    defaultByArity: { 0: "list", 1: "show" },
  },
  {
    name: "threads",
    verbs: ["list", "search", "show", "read", "send"],
    defaultByArity: { 1: "list" },
    valueFlags: [
      "-n",
      "--limit",
      "-s",
      "--sort",
      "-c",
      "--category",
      "--subcategory",
      "-t",
      "--type",
      "--offset",
      "--since",
      "--title",
      "--body",
      "--body-file",
    ],
  },
  {
    name: "replies",
    verbs: ["send"],
    defaultByArity: {},
    valueFlags: ["--body", "--body-file", "--as", "--to"],
  },
  {
    name: "lessons",
    verbs: ["list", "show", "read", "mark-read"],
    defaultByArity: { 1: "list" },
    valueFlags: ["--module", "--type", "--state", "--status", "--delay"],
  },
  {
    name: "slides",
    verbs: ["show", "read", "submit"],
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
  createClientForToken: (token: string) => Promise<EdClient>;
  defaultFetchCount: () => Promise<number>;
  fetch?: FetchLike;
  interactive: boolean;
  isTTY: boolean;
  readStdinLine: () => Promise<string>;
  tokenFile: string;
  /** Terminal width tables have to fit into. A pty without a size reports 0. */
  columns?: number;
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

  const auth = program.command("auth").description("Manage Ed authentication.");
  auth.command("login")
    .description("Verify an Ed token and save it for later commands.")
    .option("--token-stdin", "Read the token from the first line of stdin.")
    .action(async (_options: unknown, command: Command) => {
      const shadowed = Boolean(process.env.EDSTEM_TOKEN?.trim());
      // Entering a token is already explicit, so only --dry-run short-circuits the login.
      const accepted = await confirm(
        {
          summary: `Verify an Ed token and save it to ${runtime.tokenFile}.${
            shadowed ? " EDSTEM_TOKEN is set and takes precedence." : ""
          }`,
        },
        {
          dryRun: Boolean(outputOptions(command).dryRun),
          interactive: runtime.interactive,
          yes: true,
        }
      );
      if (!accepted) return;

      const token = command.opts().tokenStdin
        ? (await runtime.readStdinLine()).trim()
        : (await promptHiddenToken()).trim();
      if (!token) throw new CliError("auth", "No Ed token provided.");

      const client = await runtime.createClientForToken(token);
      const identity = projectIdentity(await client.fetchUser());
      await saveToken(token, runtime.tokenFile);
      if (shadowed) {
        runtime.writeStderr(
          `Saved ${runtime.tokenFile}, but EDSTEM_TOKEN is set and takes precedence.\n`
        );
      }
      await writeValue(runtime, command, {
        authenticated: true,
        user: identity.user,
        tokenFile: runtime.tokenFile,
      });
    });
  mutating(auth.command("logout")
    .description("Remove the saved Ed token file.")
    .action(mutationAction(runtime,
      () => ({ summary: `Remove the saved Ed token at ${runtime.tokenFile}.` }),
      async () => ({
        removed: await removeToken(runtime.tokenFile),
        tokenFile: runtime.tokenFile,
        ...(process.env.EDSTEM_TOKEN?.trim() ? { environment: true } : {}),
      })
    )));
  auth.command("status")
    .description("Verify the configured Ed token.")
    .action(outputAction(runtime, async (client) => {
      const identity = projectIdentity(await client.fetchUser());
      const { source, tokenFile } = await loadTokenWithSource({
        interactive: false,
        tokenFile: runtime.tokenFile,
      });
      return { authenticated: true, source, tokenFile, user: identity.user };
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
    .action(outputAction(runtime, async (client, _command, unit: string) =>
      projectCourse(await resolveCourse(client, unit))
    ));

  const threads = program.command("threads")
    .description("List, search, show, or read Ed threads.");
  withThreadFilters(
    threads.command("list")
      .description("List threads in a unit.")
      .argument("<unit>", "Unit ID or code", unitIdentifier)
  ).action(outputAction(runtime, async (client, command, unit: string) =>
    (await listThreads(client, await threadListOptions(runtime, command, unit)))
      .map(projectThreadSummary)
  ));
  withThreadFilters(
    threads.command("search")
      .description("Search threads in a unit by words in the title and body.")
      .argument("<unit>", "Unit ID or code", unitIdentifier)
      .argument("<query...>", "Words that must all appear in the title or body")
  ).action(outputAction(runtime, async (client, command, unit: string, query: string[]) =>
    (await listThreads(client, {
      ...await threadListOptions(runtime, command, unit),
      query: query.join(" "),
    })).map(projectThreadSummary)
  ));
  threads.command("show")
    .description("Show a thread by ID or unit ID/code plus #number.")
    .argument("<reference>", "Thread ID or unit ID/code plus #number")
    .option("--include-html", "Include Ed XML content.")
    .action(outputAction(runtime, async (client, command, reference: string) => {
      const thread = await resolveThread(client, reference);
      return projectThreadDetail(thread, { includeHtml: command.opts().includeHtml });
    }));
  threads.command("read")
    .description("Read a thread body as Markdown.")
    .argument("<reference>", "Thread ID or unit ID/code plus #number")
    .action(textAction(runtime, async (client, _command, reference: string) =>
      threadToMarkdown(await resolveThread(client, reference))
    ));

  mutating(threads.command("send")
    .description("Post a new thread in a unit.")
    .argument("<unit>", "Unit ID or code", unitIdentifier)
    .requiredOption("--title <title>", "Thread title.")
    .option("--body <markdown>", "Thread body as Markdown.")
    .option("--body-file <path>", "Read the Markdown body from a file, or - for stdin.")
    .addOption(program.createOption("--type <type>", "Thread type.")
      .choices([...THREAD_TYPES]).default("question"))
    .option("-c, --category <category>", "Ed category for the thread.")
    .option("--private", "Post privately to staff.")
    .option("--anonymous", "Post anonymously.")
    .action(mutationAction(runtime,
      async (command, unit: string) => {
        const options = command.opts();
        const document = markdownToEdDocument(await readMarkdownBody(options));
        return {
          details: document,
          document,
          summary: `Post a ${options.type} ${JSON.stringify(options.title)} in unit ${unit}.`,
        };
      },
      async (command, plan, unit: string) => {
        const client = await runtime.createClient();
        const options = command.opts();
        const courseId = await resolveCourseId(client, unit);
        return projectThreadDetail(await client.createThread(courseId, {
          anonymous: Boolean(options.anonymous),
          category: options.category,
          content: plan.document,
          private: Boolean(options.private),
          title: options.title,
          type: options.type,
        }));
      }
    )));

  const replies = program.command("replies").description("Post replies to Ed threads.");
  mutating(replies.command("send")
    .description("Post a reply to a thread or to one of its comments.")
    .argument("<reference>", "Thread ID or unit ID/code plus #number")
    .option("--body <markdown>", "Reply body as Markdown.")
    .option("--body-file <path>", "Read the Markdown body from a file, or - for stdin.")
    .addOption(program.createOption(
      "--as <kind>",
      "Reply kind; defaults to answer on question threads and comment elsewhere."
    ).choices([...REPLY_TYPES]))
    .option(
      "--to <commentId>",
      "Reply to one comment of the thread instead of the thread itself.",
      positiveInteger("--to")
    )
    .option("--private", "Post privately to staff.")
    .option("--anonymous", "Post anonymously.")
    .action(mutationAction(runtime,
      async (command, reference: string) => {
        const options = command.opts();
        const document = markdownToEdDocument(await readMarkdownBody(options));
        const thread = await resolveThread(await runtime.createClient(), reference);
        if (options.to !== undefined) {
          assertCommentInThread(thread, options.to);
        }
        const type = options.as ?? defaultReplyType(thread.type);
        return {
          details: document,
          document,
          summary: options.to === undefined
            ? `Post a ${type} on thread ${thread.id}.`
            : `Post a ${type} under comment ${options.to} on thread ${thread.id}.`,
          thread,
          type,
        };
      },
      async (command, plan) => {
        const client = await runtime.createClient();
        const options = command.opts();
        const input = {
          anonymous: Boolean(options.anonymous),
          content: plan.document,
          private: Boolean(options.private),
          type: plan.type,
        };
        const comment = options.to === undefined
          ? await client.createThreadReply(plan.thread.id, input)
          : await client.createCommentReply(options.to, input);
        return { ...projectComment(comment), threadId: plan.thread.id };
      }
    )));

  const lessons = program.command("lessons").description("List, show, read, or mark lessons as read.");
  lessons.command("list")
    .description("List lessons in a unit.")
    .argument("<unit>", "Unit ID or code", unitIdentifier)
    .option("--module <module>", "Module ID or name text; use all to disable.")
    .option("--type <type>", "Exact lesson type, such as general; use all to disable.")
    .option("--state <state>", "Exact state, such as active or scheduled; use all to disable.")
    .option("--status <status>", "Progress: unattempted, attempted, completed, or all.")
    .action(outputAction(runtime, async (client, command, unit: string) => {
      const options = command.opts();
      return (await listLessons(client, unit, {
        lessonType: options.type,
        module: options.module,
        state: options.state,
        status: options.status,
      })).map(projectLessonSummary);
    }));
  lessons.command("show")
    .description("Show one lesson and its slides.")
    .argument("<lesson>", "Lesson ID", positiveInteger("<lesson>"))
    .action(outputAction(runtime, async (client, _command, lesson: number) =>
      projectLessonDetail(await client.fetchLesson(lesson))
    ));
  lessons.command("read")
    .description("Read a lesson and its slides as Markdown.")
    .argument("<lesson>", "Lesson ID", positiveInteger("<lesson>"))
    .action(textAction(runtime, async (client, _command, lesson: number) =>
      lessonToMarkdown(await client.fetchLesson(lesson))
    ));
  mutating(lessons.command("mark-read")
    .description("Mark matching lessons and slides as read.")
    .argument("<unit>", "Unit ID or code", unitIdentifier)
    .argument("[queries...]", "Words required in lesson or module names")
    .option("--all", "Mark every lesson in the unit; required when no queries are given")
    .option("--delay <seconds>", "Delay between slide updates", nonNegativeNumber("--delay"), 0)
    .action(mutationAction(runtime,
      (command, unit: string, queries: string[]) => {
        const selected = queries.filter((query) => query.trim());
        if (selected.length === 0 && !command.opts().all) {
          throw new CliError("usage", "Provide at least one query or pass --all.");
        }
        return {
          summary: selected.length
            ? `Mark lessons as read in unit ${unit} matching: ${selected.join(", ")}.`
            : `Mark ALL lessons as read in unit ${unit}.`,
        };
      },
      async (command, _plan, unit: string, queries: string[]) =>
        readLessons(await runtime.createClient(), unit, queries, {
          all: Boolean(command.opts().all),
          delaySeconds: command.opts().delay,
        })
    )));

  const slides = program.command("slides").description("Show, read, or submit lesson slides.");
  slides.command("show")
    .description("Show slide content, questions, responses, or quiz context.")
    .argument("<slide>", "Slide ID", positiveInteger("<slide>"))
    .addOption(program.createOption("--section <section>", "Slide section").choices([...SLIDE_SECTIONS]).default("slide"))
    .action(outputAction(runtime, async (client, command, slide: number) => {
      const section = command.opts().section as typeof SLIDE_SECTIONS[number];
      if (section === "questions" || section === "quiz") {
        return (await client.fetchSlideQuestions(slide)).map(projectQuestion);
      }
      if (section === "responses") {
        return (await client.fetchSlideQuestionResponses(slide)).map(projectQuestionResponse);
      }
      return projectSlide(await client.fetchSlide(slide));
    }));
  slides.command("read")
    .description("Read one slide as Markdown.")
    .argument("<slide>", "Slide ID", positiveInteger("<slide>"))
    .action(textAction(runtime, async (client, _command, slide: number) =>
      slideToMarkdown(await client.fetchSlide(slide))
    ));
  mutating(slides.command("submit")
    .description("Save one answer or submit all saved answers for a slide.")
    .argument("<slide>", "Slide ID", positiveInteger("<slide>"))
    .option("--question <question>", "Question ID to answer", positiveInteger("--question"))
    .option("--choice <number>", "One-based choice; repeat for multi-select", collectPositiveInteger("--choice"), [])
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
        if (options.question !== undefined && options.choice.length === 0) {
          throw new CliError("usage", "--question requires at least one --choice.");
        }
        return {
          summary: options.question
            ? `Save an answer for question ${options.question} on slide ${slide}.`
            : `Submit all saved answers for slide ${slide}.`,
        };
      },
      async (command, _plan, slide: number) => {
        const options = command.opts();
        const client = await runtime.createClient();
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

  const files = program.command("files")
    .description("List or download Ed-hosted lesson and thread files.");
  files.command("list")
    .description("List Ed-hosted downloadable files in one lesson or thread.")
    .argument("<target>", FILE_TARGET_HELP, parseFileTarget)
    .action(outputAction(runtime, async (client, _command, target: FileTarget) =>
      target.kind === "lesson"
        ? listLessonFiles(await client.fetchLesson(target.id))
        : listThreadFiles(await resolveThread(client, target.reference))
    ));
  files.command("get")
    .description("Download Ed-hosted files from one lesson or thread.")
    .argument("<target>", FILE_TARGET_HELP, parseFileTarget)
    .option("--dest <directory>", "Destination directory", ".")
    .option("--slide <slide>", "Download only one slide file", positiveInteger("--slide"))
    .option("--force", "Replace existing files.")
    .action(outputAction(runtime, async (client, command, target: FileTarget) => {
      const options = command.opts();
      const download = (selected: Parameters<typeof downloadLessonFiles>[1]) =>
        downloadLessonFiles(client, selected, {
          destination: options.dest,
          force: options.force,
        });

      if (target.kind === "thread") {
        if (options.slide !== undefined) {
          throw new CliError("usage", "--slide only applies to lesson targets.");
        }
        const thread = await resolveThread(client, target.reference);
        return { threadId: thread.id, downloads: await download(listThreadFiles(thread)) };
      }

      const lessonId = target.id;
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
      return { lessonId, downloads: await download(selected) };
    }));

  program.command("activity")
    .description("List current-user activity.")
    .argument("[unit]", "Unit ID or code", unitIdentifier)
    .option("-n, --limit <count>", "Maximum activity items", positiveInteger("--limit"))
    .option("-f, --filter <type>", "Activity type", "all")
    .action(outputAction(runtime, async (client, command, unit?: string) => {
      const limit = command.opts().limit ?? await runtime.defaultFetchCount();
      return projectActivity(await listCurrentActivity(client, {
        courseId: unit,
        filterType: command.opts().filter,
        limit,
      }));
    }));

  mutating(program.command("update")
    .description("Report or install the latest edstem-cli release.")
    .option("--check", "Only report the latest release.")
    .action(async (_options: unknown, command: Command) => {
      // The plan summary needs the registry result, so fetch it once and close over it.
      const info = await checkForUpdate(runtime.fetch);
      if (command.opts().check || !info.updateAvailable) {
        await writeValue(runtime, command, info);
        return;
      }
      await mutationAction(runtime,
        () => ({
          summary: `Upgrade edstem-cli from ${info.currentVersion} to ${info.latestVersion} ` +
            `with \`${info.upgradeCommand}\`.`,
        }),
        async () => ({ ...info, ranCommand: applyUpdate() })
      )(command);
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
  const tokenFile = defaultTokenFile();
  let client: Promise<EdClient> | undefined;
  return {
    createClient: () => {
      client ??= Promise.all([loadToken({ tokenFile }), loadConfig()]).then(([token, config]) =>
        new EdClient({
          apiBaseUrl: config.apiBaseUrl,
          maxRetries: config.maxRetries,
          retryBaseDelayMs: config.retryBaseDelayMs,
          token,
          // --verbose is the flag you reach for when a command feels slow, so it
          // reports the requests and their timings. Never the token: it is a header.
          trace: process.argv.includes("--verbose")
            ? (entry) => process.stderr.write(`${entry.method} ${entry.url} ${entry.status} ${entry.ms}ms\n`)
            : undefined,
        })
      );
      return client;
    },
    createClientForToken: async (token) =>
      new EdClient({ apiBaseUrl: (await loadConfig()).apiBaseUrl, token }),
    defaultFetchCount: async () => (await loadConfig()).fetchCount,
    interactive: Boolean(process.stdin.isTTY),
    isTTY: Boolean(process.stdout.isTTY),
    readStdinLine,
    tokenFile,
    // A pty that will not report its size still needs a table narrow enough to read.
    columns: process.stdout.columns || (process.stdout.isTTY ? 80 : undefined),
    writeStderr: (text) => process.stderr.write(text),
    writeOutput: (text, output) => writeOutput(text, { output }),
    writeStdout: (text) => process.stdout.write(text),
  };
}

async function readStdinLine(): Promise<string> {
  process.stdin.setEncoding("utf8");
  let buffered = "";
  for await (const chunk of process.stdin) {
    buffered += chunk;
    const newline = buffered.indexOf("\n");
    if (newline >= 0) return buffered.slice(0, newline);
  }
  return buffered;
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

interface MutationPlan {
  /** Extra context printed on stderr for --dry-run, such as generated Ed XML. */
  details?: string;
  summary: string;
}

function mutationAction<Plan extends MutationPlan, Arguments extends unknown[]>(
  runtime: CliRuntime,
  plan: (command: Command, ...args: Arguments) => Plan | Promise<Plan>,
  action: (
    command: Command,
    plan: Plan,
    ...args: Arguments
  ) => Promise<unknown>
): (...args: [...Arguments, Command]) => Promise<void> {
  return async (...args): Promise<void> => {
    const command = args.at(-1) as Command;
    const actionArgs = args.slice(0, -1) as Arguments;
    const options = outputOptions(command);
    const prepared = await plan(command, ...actionArgs);
    const accepted = await confirm(prepared, {
      yes: Boolean(options.yes),
      dryRun: Boolean(options.dryRun),
      interactive: runtime.interactive,
    });
    if (options.dryRun && prepared.details) {
      runtime.writeStderr(`${prepared.details}\n`);
    }
    if (!accepted) return;
    await writeValue(
      runtime,
      command,
      await action(command, prepared, ...actionArgs)
    );
  };
}

async function readMarkdownBody(options: { body?: string; bodyFile?: string }): Promise<string> {
  if (options.body !== undefined && options.bodyFile !== undefined) {
    throw new CliError("usage", "Use only one of --body or --body-file.");
  }
  if (options.body === undefined && options.bodyFile === undefined) {
    throw new CliError("usage", "Provide the post body with --body or --body-file.");
  }
  const body = options.body ?? (options.bodyFile === "-"
    ? await readStdin()
    : await readFile(options.bodyFile as string, "utf8"));
  if (!body.trim()) {
    throw new CliError("usage", "The post body must not be empty.");
  }
  return body;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * What a person wants to see per row. Every field stays in --json; a table that
 * carries eleven columns has to shave them all down to nothing to fit a terminal,
 * so the human format picks the few that identify the row.
 */
const TABLE_COLUMNS: Readonly<Record<string, readonly [string, string][]>> = {
  "threads list": [["number", "#"], ["title", "title"], ["category", "category"], ["flags", "flags"], ["createdAt", "created"]],
  "threads search": [["number", "#"], ["title", "title"], ["category", "category"], ["flags", "flags"], ["createdAt", "created"]],
  "lessons list": [["number", "#"], ["title", "title"], ["moduleName", "module"], ["status", "status"], ["dueAt", "due"]],
  "units list": [["id", "id"], ["code", "code"], ["name", "name"], ["status", "status"]],
  activity: [["kind", "kind"], ["courseCode", "unit"], ["title", "title"], ["createdAt", "created"]],
};

function commandPath(command: Command): string {
  const names: string[] = [];
  for (let current: Command | null = command; current?.parent; current = current.parent) {
    names.unshift(current.name());
  }
  return names.join(" ");
}

async function writeValue(runtime: CliRuntime, command: Command, value: unknown): Promise<void> {
  const options = outputOptions(command);
  const format = resolveFormat(options, runtime.isTTY);
  const fields = options.fields?.split(",").map((field) => field.trim()).filter(Boolean);
  // Pretty JSON is for a person reading it; a pipe only pays for the whitespace.
  await writeText(
    runtime,
    render(value, {
      format,
      fields,
      columns: fields?.length ? undefined : TABLE_COLUMNS[commandPath(command)],
      width: runtime.columns,
      pretty: runtime.isTTY,
    }),
    options.output,
  );
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

function withThreadFilters(command: Command): Command {
  return command
    .option("-n, --limit <count>", "Maximum threads to return", positiveInteger("--limit"))
    .addOption(command.createOption(
      "-s, --sort <order>",
      "Ed sort order; defaults to new and pinned threads may remain first."
    ).choices([...SORT_OPTIONS]).default("new"))
    .option("-c, --category <category>", "Filter by exact top-level category.")
    .option("--subcategory <subcategory>", "Filter by exact second-level subcategory.")
    .option("-t, --type <type>", "Filter by thread type.")
    .option("--answered", "Only answered threads.")
    .option("--unanswered", "Only unanswered threads.")
    .option("--offset <count>", "Skip this many threads before filtering.", nonNegativeInteger, 0)
    .option(
      "--since <when>",
      "Only threads created at or after an ISO date or a relative offset such as 7d.",
      parseSinceValue
    );
}

async function threadListOptions(
  runtime: CliRuntime,
  command: Command,
  unit: string
): Promise<ThreadListOptions> {
  const options = command.opts();
  if (options.answered && options.unanswered) {
    throw new CliError("usage", "Use only one of --answered or --unanswered.");
  }
  return {
    answered: options.answered ? true : options.unanswered ? false : undefined,
    category: options.category,
    courseId: unit,
    limit: options.limit ?? await runtime.defaultFetchCount(),
    offset: options.offset,
    since: options.since,
    sort: options.sort,
    subcategory: options.subcategory,
    threadType: options.type,
  };
}

function positiveInteger(name: string): (value: string) => number {
  return (value) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new CliError("usage", `${name} must be a positive integer.`);
    }
    return parsed;
  };
}

export function parseFileTarget(value: string): FileTarget {
  const normalized = value.trim();
  if (!/^thread:/i.test(normalized)) {
    return { kind: "lesson", id: positiveInteger("<target>")(normalized) };
  }
  const reference = normalized.slice("thread:".length).trim();
  if (!reference) {
    throw new CliError("usage", "Thread target must be thread:<id> or thread:<unit>#<number>.");
  }
  return { kind: "thread", reference };
}

function nonNegativeInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new CliError("usage", "Value must be an integer greater than or equal to 0.");
  }
  return parsed;
}

function unitIdentifier(value: string): string {
  const normalized = value.trim();
  if (normalized) return normalized;
  throw new CliError("usage", "Unit ID or code must not be empty.");
}

function nonNegativeNumber(name: string): (value: string) => number {
  return (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new CliError("usage", `${name} must be greater than or equal to 0.`);
    }
    return parsed;
  };
}

function collectPositiveInteger(name: string): (value: string, previous: number[]) => number[] {
  const parse = positiveInteger(name);
  return (value, previous) => [...previous, parse(value)];
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
