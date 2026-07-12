import { Command, Option } from "commander";

import { loadToken } from "./auth.js";
import { loadConfig } from "./config.js";
import { EdClient } from "./ed/client.js";
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
import { serializeThread } from "./ed/serialization.js";
import { CliError, normalizeError } from "./errors.js";
import { lessonToMarkdown, threadToMarkdown } from "./markdown.js";
import { writeError, writeJson, writeText } from "./output.js";
import { addSkill, formatSkillSummary, writeGeneratedSkill } from "./skills.js";
import { applyUpdate, checkForUpdate } from "./update.js";
import { VERSION } from "./version.js";

const SORT_OPTIONS = new Set(["new", "old", "top"]);

export interface CliRuntime {
  createClient: () => Promise<EdClient>;
  defaultFetchCount: () => Promise<number>;
  isTTY: boolean;
  writeStderr: (text: string) => void;
  writeStdout: (text: string) => void;
}

interface GlobalOutputOptions {
  fields?: string;
  json?: boolean;
  output?: string;
  pretty?: boolean;
}

export function createProgram(runtime: CliRuntime = createDefaultRuntime()): Command {
  const program = new Command("edstem")
    .description("Agent-first CLI for Ed Discussion.")
    .version(VERSION)
    .option("--json", "Emit JSON. Kept for compatibility; JSON is the default.")
    .option("--pretty", "Pretty-print JSON.")
    .option("--fields <fields>", "Comma-separated top-level fields to keep.")
    .option("-o, --output <file>", "Write output to a file.");

  program.command("user").description("Show the current Ed identity and enrolled courses.").action(
    withOutput(runtime, async (client) => {
      const identity = projectIdentity(await client.fetchUser());
      const user = identity.user as Record<string, unknown>;
      return { ...user, courses: identity.courses };
    })
  );

  program.command("courses")
    .description("List enrolled courses.")
    .option("--archived", "Include archived courses.")
    .action(withOutput(runtime, async (client, command) => {
      const { courses } = await client.fetchUser();
      const includeArchived = Boolean(command.opts().archived);
      return courses
        .filter((course) => includeArchived || course.status.toLowerCase() !== "archived")
        .map(projectCourse);
    }));

  program.command("threads")
    .description("List threads in a course.")
    .argument("<course-id>", "Course ID", positiveInteger)
    .option("-n, --max <count>", "Maximum threads to fetch", positiveInteger)
    .addOption(new Option("-s, --sort <order>", "Sort order").choices([...SORT_OPTIONS]).default("new"))
    .option("-c, --category <category>", "Filter by category.")
    .option("-t, --type <type>", "Filter by thread type.")
    .option("--answered", "Only answered threads.")
    .option("--unanswered", "Only unanswered threads.")
    .action(withOutput(runtime, async (client, command, courseId: number) => {
      const options = command.opts();
      if (options.answered && options.unanswered) {
        throw new CliError("input", "Use only one of --answered or --unanswered", 2);
      }
      const limit = options.max ?? await runtime.defaultFetchCount();
      const threads = await listThreads(client, {
        answered: options.answered ? true : options.unanswered ? false : undefined,
        category: options.category,
        courseId,
        limit,
        sort: options.sort,
        threadType: options.type,
      });
      return threads.map(projectThreadSummary);
    }));

  program.command("thread")
    .description("Show a thread by ID or course_id#number.")
    .argument("<reference>", "Thread ID or course_id#number")
    .option("--md", "Emit Markdown.")
    .addOption(new Option("--format <format>", "Output format").choices(["json", "md"]))
    .option("--include-html", "Include Ed XML content.")
    .option("--legacy-json", "Use the previous verbose JSON shape.")
    .action(async (reference: string, _options: unknown, command: Command) => {
      const client = await runtime.createClient();
      const thread = await resolveThread(client, reference);
      const options = command.opts();
      const projected = options.legacyJson
        ? serializeThread(thread)
        : projectThreadDetail(thread, { includeHtml: options.includeHtml });
      await writeDomainOutput(runtime, command, projected, () => threadToMarkdown(thread));
    });

  const lessons = program.command("lessons")
    .description("List or update course lessons.")
    .argument("[course-id]", "Course ID", positiveInteger)
    .option("--module <module>", "Filter by module ID or exact module name.")
    .option("--type <type>", "Filter by lesson type.")
    .option("--state <state>", "Filter by lesson state.")
    .option("--status <status>", "Filter by lesson status.")
    .action(withOutput(runtime, async (client, command, courseId?: number) => {
      if (courseId === undefined) {
        throw new CliError("input", "Course ID is required", 2);
      }
      const items = await listLessons(client, courseId, command.opts());
      return items.map(projectLessonSummary);
    }));

  lessons.command("list")
    .description("List lessons in a course.")
    .argument("<course-id>", "Course ID", positiveInteger)
    .option("--module <module>", "Filter by module ID or exact module name.")
    .option("--type <type>", "Filter by lesson type.")
    .option("--state <state>", "Filter by lesson state.")
    .option("--status <status>", "Filter by lesson status.")
    .action(withOutput(runtime, async (client, command, courseId: number) => {
      const items = await listLessons(client, courseId, command.opts());
      return items.map(projectLessonSummary);
    }));

  lessons.command("read")
    .description("Mark matching lessons and slides as read.")
    .argument("<course-id>", "Course ID", positiveInteger)
    .argument("[queries...]", "Words required in lesson or module names")
    .option("--delay <seconds>", "Delay between slide updates", nonNegativeNumber, 0)
    .action(withOutput(runtime, async (client, command, courseId: number, queries: string[]) =>
      readLessons(client, courseId, queries, command.opts().delay)
    ));

  lessons.command("questions")
    .description("List quiz questions for a slide.")
    .argument("<slide-id>", "Slide ID", positiveInteger)
    .action(withOutput(runtime, async (client, _command, slideId: number) =>
      (await client.fetchSlideQuestions(slideId)).map(projectQuestion)
    ));

  lessons.command("responses")
    .description("List saved quiz responses for a slide.")
    .argument("<slide-id>", "Slide ID", positiveInteger)
    .action(withOutput(runtime, async (client, _command, slideId: number) =>
      (await client.fetchSlideQuestionResponses(slideId)).map(projectQuestionResponse)
    ));

  lessons.command("quiz")
    .description("Inspect or answer one quiz slide.")
    .argument("<slide-id>", "Slide ID", positiveInteger)
    .option("--responses", "Show saved responses.")
    .option("--answer <question-id>", "Submit an answer for a question", positiveInteger)
    .option("--choice <number>", "One-based choice; repeat for multi-select", collectPositiveInteger, [])
    .option("--submit", "Submit all saved slide answers.")
    .option("--amend", "Amend an existing response.")
    .action(withOutput(runtime, async (client, command, slideId: number) => {
      const options = command.opts();
      const actionCount = [options.responses, options.answer !== undefined, options.submit].filter(Boolean).length;
      if (actionCount > 1) {
        throw new CliError("input", "Use only one of --responses, --answer, or --submit", 2);
      }
      if (options.choice.length > 0 && options.answer === undefined) {
        throw new CliError("input", "--choice requires --answer", 2);
      }
      if (options.answer !== undefined) {
        return client.submitSlideAnswer(
          options.answer,
          options.choice.map((choice: number) => choice - 1),
          { amend: options.amend }
        );
      }
      if (options.submit) {
        return client.submitSlide(slideId);
      }
      if (options.responses) {
        return (await client.fetchSlideQuestionResponses(slideId)).map(projectQuestionResponse);
      }
      return (await client.fetchSlideQuestions(slideId)).map(projectQuestion);
    }));

  hideCommand(lessons.command("answer")
    .description("Submit an answer for one quiz question."))
    .argument("<question-id>", "Question ID", positiveInteger)
    .option("--choice <number>", "One-based choice; repeat for multi-select", collectPositiveInteger, [])
    .option("--amend", "Amend an existing response.")
    .action(withOutput(runtime, async (client, command, questionId: number) =>
      submitAnswer(client, questionId, command.opts().choice, command.opts().amend)
    ));

  hideCommand(lessons.command("submit")
    .description("Submit all saved answers for one quiz slide."))
    .argument("<slide-id>", "Slide ID", positiveInteger)
    .action(withOutput(runtime, (client, _command, slideId: number) => client.submitSlide(slideId)));

  const slides = hideCommand(
    program.command("slides").description("Compatibility aliases for lesson slide commands.")
  );
  slides.command("questions").argument("<slide-id>", "Slide ID", positiveInteger).action(
    withOutput(runtime, async (client, _command, slideId: number) =>
      (await client.fetchSlideQuestions(slideId)).map(projectQuestion)
    )
  );
  slides.command("responses").argument("<slide-id>", "Slide ID", positiveInteger).action(
    withOutput(runtime, async (client, _command, slideId: number) =>
      (await client.fetchSlideQuestionResponses(slideId)).map(projectQuestionResponse)
    )
  );
  slides.command("answer")
    .argument("<question-id>", "Question ID", positiveInteger)
    .option("--choice <number>", "One-based choice; repeat for multi-select", collectPositiveInteger, [])
    .option("--amend", "Amend an existing response.")
    .action(withOutput(runtime, async (client, command, questionId: number) =>
      submitAnswer(client, questionId, command.opts().choice, command.opts().amend)
    ));
  slides.command("submit").argument("<slide-id>", "Slide ID", positiveInteger).action(
    withOutput(runtime, (client, _command, slideId: number) => client.submitSlide(slideId))
  );

  program.command("lesson")
    .description("Show a lesson and its slides.")
    .argument("<lesson-id>", "Lesson ID", positiveInteger)
    .option("--md", "Emit Markdown.")
    .addOption(new Option("--format <format>", "Output format").choices(["json", "md"]))
    .action(async (lessonId: number, _options: unknown, command: Command) => {
      const client = await runtime.createClient();
      const lesson = await client.fetchLesson(lessonId);
      await writeDomainOutput(runtime, command, projectLessonDetail(lesson), () => lessonToMarkdown(lesson));
    });

  program.command("activity")
    .description("List current-user activity.")
    .argument("[course-id]", "Course ID", positiveInteger)
    .option("-n, --max <count>", "Maximum activity items", positiveInteger)
    .option("-f, --filter <type>", "Activity type", "all")
    .action(withOutput(runtime, async (client, command, courseId?: number) => {
      const limit = command.opts().max ?? await runtime.defaultFetchCount();
      const items = await listCurrentActivity(client, {
        courseId,
        filterType: command.opts().filter,
        limit,
      });
      return compactActivity(items);
    }));

  program.command("update")
    .description("Check for an npm update or apply it.")
    .option("--apply", "Install the latest npm package globally.")
    .action(async (_options: unknown, command: Command) => {
      const value = command.opts().apply
        ? { applied: true, command: applyUpdate() }
        : await checkForUpdate();
      await writeCommandJson(runtime, command, value);
    });

  const skills = program.command("skills").description("Show, generate, or install the agent skill.");
  skills.action(async (_options: unknown, command: Command) => {
    await writeCommandJson(runtime, command, formatSkillSummary());
  });
  skills.command("generate").description("Regenerate SKILL.md from CLI and MCP metadata.").action(
    async (_options: unknown, command: Command) => {
      writeGeneratedSkill(program);
      await writeCommandJson(runtime, command, { generated: "SKILL.md" });
    }
  );
  skills.command("add")
    .description("Install the skill through the shared skills CLI.")
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .action(async (_options: unknown, command: Command) => {
      const invoked = addSkill(command.args);
      await writeCommandJson(runtime, command, { command: invoked });
    });

  return program;
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
    isTTY: Boolean(process.stdout.isTTY),
    writeStderr: (text) => process.stderr.write(text),
    writeStdout: (text) => process.stdout.write(text),
  };
}

async function writeDomainOutput(
  runtime: CliRuntime,
  command: Command,
  json: unknown,
  markdown: () => string
): Promise<void> {
  const local = command.opts();
  const global = command.optsWithGlobals() as GlobalOutputOptions;
  const format = local.format ?? (local.md ? "md" : "json");
  if (format === "md") {
    if (global.fields) {
      throw new CliError("input", "--fields is only available with JSON output", 2);
    }
    await writeText(markdown(), global.output, runtime.writeStdout);
    return;
  }
  await writeJson(json, {
    fields: global.fields,
    output: global.output,
    pretty: Boolean(global.pretty || (runtime.isTTY && !global.json)),
  }, runtime.writeStdout);
}

async function writeCommandJson(runtime: CliRuntime, command: Command, value: unknown): Promise<void> {
  const options = command.optsWithGlobals() as GlobalOutputOptions;
  await writeJson(value, {
    fields: options.fields,
    output: options.output,
    pretty: Boolean(options.pretty || (runtime.isTTY && !options.json)),
  }, runtime.writeStdout);
}

function withOutput<Arguments extends unknown[]>(
  runtime: CliRuntime,
  action: (client: EdClient, command: Command, ...args: Arguments) => Promise<unknown>
): (...args: [...Arguments, Command]) => Promise<void> {
  return async (...args: [...Arguments, Command]): Promise<void> => {
    const command = args.at(-1) as unknown as Command;
    const client = await runtime.createClient();
    const actionArguments = args.slice(0, -1) as Arguments;
    const result = await action(client, command, ...actionArguments);
    const options = command.optsWithGlobals() as GlobalOutputOptions;
    await writeJson(result, {
      fields: options.fields,
      output: options.output,
      pretty: Boolean(options.pretty || (runtime.isTTY && !options.json)),
    }, runtime.writeStdout);
  };
}

function positiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new CliError("input", "Value must be a positive integer", 2);
  }
  return parsed;
}

function nonNegativeNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new CliError("input", "Value must be greater than or equal to 0", 2);
  }
  return parsed;
}

function collectPositiveInteger(value: string, previous: number[]): number[] {
  return [...previous, positiveInteger(value)];
}

function submitAnswer(
  client: EdClient,
  questionId: number,
  choices: number[],
  amend: boolean
) {
  return client.submitSlideAnswer(questionId, choices.map((choice) => choice - 1), { amend });
}

function hideCommand(command: Command): Command {
  (command as unknown as { _hidden: boolean })._hidden = true;
  return command;
}

export async function run(argv = process.argv, runtime?: CliRuntime): Promise<number> {
  try {
    await createProgram(runtime).parseAsync(argv);
    return 0;
  } catch (error) {
    const normalized = normalizeError(error);
    writeError(normalized, runtime?.writeStderr);
    return normalized.exitCode;
  }
}

if (import.meta.url === new URL(process.argv[1] ?? "", "file:").href) {
  void run().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
