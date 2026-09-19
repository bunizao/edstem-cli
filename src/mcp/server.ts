import { McpServer, type AuthInfo } from "@modelcontextprotocol/server";
import { z } from "zod";

import { EdApiError, EdAuthExpiredError, type EdClient } from "../ed/client.js";
import { listLessonFiles, listThreadFiles } from "../ed/files.js";
import type { LessonFile } from "../ed/models.js";
import {
  EdInputError,
  listCurrentActivity,
  listLessons,
  listThreads,
  parseSinceValue,
  readLessons,
  resolveCourseId,
} from "../ed/operations.js";
import {
  compactActivity,
  projectCourse,
  projectIdentity,
  projectLessonDetail,
  projectLessonSummary,
  projectQuestion,
  projectQuestionResponse,
  projectSlide,
  projectThreadDetail,
  projectThreadSummary,
} from "../ed/projections.js";
import { lessonToMarkdown, slideToMarkdown, threadToMarkdown } from "../markdown.js";
import { VERSION } from "../version.js";
import { toolDescription } from "./catalog.js";

const READ_ONLY = { destructiveHint: false, readOnlyHint: true } as const;
const WRITES_PROGRESS = { destructiveHint: false, readOnlyHint: false } as const;
const WRITE = { destructiveHint: true, readOnlyHint: false } as const;
const COURSE_REFERENCE = z.union([
  z.number().int().positive(),
  z.string().trim().min(1),
]).describe('Ed course ID or exact course code, for example 38435 or "FIT2014".');
const THREAD_LIST_SHAPE = {
  answered: z.boolean().optional(),
  category: z.string().trim().min(1).optional().describe(
    'Exact top-level category, for example "Applied".'
  ),
  courseId: COURSE_REFERENCE,
  limit: z.number().int().positive().max(100).optional().default(30),
  offset: z.number().int().min(0).optional().default(0).describe(
    "Threads to skip in the unfiltered Ed stream before filtering."
  ),
  since: z.string().trim().min(1).optional().describe(
    'Only threads created at or after this time: an ISO date such as "2026-09-01", an ISO datetime such as "2026-09-01T10:00:00Z", or a relative offset such as "7d", "12h", or "2w".'
  ),
  sort: z.enum(["new", "old", "top", "hot"]).optional().default("new").describe(
    'Ed sort order. Defaults to "new"; Ed may keep pinned threads ahead of that order.'
  ),
  subcategory: z.string().trim().min(1).optional().describe(
    'Exact second-level subcategory, for example "MiniTests".'
  ),
  threadType: z.string().trim().min(1).optional().describe(
    'Exact thread type, for example "question" or "post".'
  ),
};

export interface McpToolContext {
  http?: {
    authInfo?: AuthInfo;
  };
}

export interface EdMcpRuntime {
  authErrorExtra?: (context: McpToolContext) => Record<string, unknown>;
  canWrite: (context: McpToolContext) => boolean;
  getClient: (context: McpToolContext) => EdClient | Promise<EdClient>;
  mapError?: (
    error: unknown,
    context: McpToolContext
  ) => { extra?: Record<string, unknown>; message: string; type: string } | undefined;
  onAuthExpired?: (context: McpToolContext) => void | Promise<void>;
}

export function createEdMcpServer(runtime: EdMcpRuntime): McpServer {
  const server = new McpServer({ name: "edstem", version: VERSION });

  server.registerTool(
    "get_user",
    { annotations: READ_ONLY, description: toolDescription("get_user") },
    async (extra) => runTool(runtime, extra, false, async (client) => {
      const identity = projectIdentity(await client.fetchUser());
      return { ...(identity.user as Record<string, unknown>), courses: identity.courses };
    })
  );

  server.registerTool(
    "list_courses",
    {
      annotations: READ_ONLY,
      description: toolDescription("list_courses"),
      inputSchema: z.object({ includeArchived: z.boolean().optional().default(false) }),
    },
    async ({ includeArchived }, extra) => runTool(runtime, extra, false, async (client) => {
      const { courses } = await client.fetchUser();
      return courses
        .filter((course) => includeArchived || course.status.toLowerCase() !== "archived")
        .map(projectCourse);
    })
  );

  server.registerTool(
    "list_lessons",
    {
      annotations: READ_ONLY,
      description: toolDescription("list_lessons"),
      inputSchema: z.object({
        courseId: COURSE_REFERENCE,
        lessonType: z.string().trim().min(1).optional().describe(
          'Exact lesson type, for example "general". Use "all" or omit to include every type.'
        ),
        module: z.string().trim().min(1).optional().describe(
          'Module ID or case-insensitive text from the module name, for example "Week 5". Use "all" or omit to include every module.'
        ),
        state: z.string().trim().min(1).optional().describe(
          'Exact availability state, for example "active" or "scheduled". Use "all" or omit to include every state.'
        ),
        status: z.string().trim().min(1).optional().describe(
          'Exact progress status: "unattempted", "attempted", or "completed". Use "all" or omit to include every status.'
        ),
      }),
    },
    async ({ courseId, lessonType, module, state, status }, extra) =>
      runTool(runtime, extra, false, async (client) =>
        (await listLessons(client, courseId, { lessonType, module, state, status }))
          .map(projectLessonSummary)
      )
  );

  server.registerTool(
    "get_lesson",
    {
      annotations: READ_ONLY,
      description: toolDescription("get_lesson"),
      inputSchema: z.object({ lessonId: z.number().int().positive() }),
    },
    async ({ lessonId }, extra) => runTool(runtime, extra, false, async (client) =>
      projectLessonDetail(await client.fetchLesson(lessonId))
    )
  );

  server.registerTool(
    "list_lesson_files",
    {
      annotations: READ_ONLY,
      description: toolDescription("list_lesson_files"),
      inputSchema: z.object({ lessonId: z.number().int().positive() }),
    },
    async ({ lessonId }, extra) => runTool(runtime, extra, false, async (client) =>
      fileLinksResult(listLessonFiles(await client.fetchLesson(lessonId)))
    )
  );

  server.registerTool(
    "list_thread_files",
    {
      annotations: READ_ONLY,
      description: toolDescription("list_thread_files"),
      inputSchema: z.object({ threadId: z.number().int().positive() }),
    },
    async ({ threadId }, extra) => runTool(runtime, extra, false, async (client) =>
      fileLinksResult(listThreadFiles(await client.fetchThread(threadId)))
    )
  );

  server.registerTool(
    "list_slide_questions",
    {
      annotations: READ_ONLY,
      description: toolDescription("list_slide_questions"),
      inputSchema: z.object({ slideId: z.number().int().positive() }),
    },
    async ({ slideId }, extra) => runTool(runtime, extra, false, async (client) =>
      (await client.fetchSlideQuestions(slideId)).map(projectQuestion)
    )
  );

  server.registerTool(
    "list_slide_responses",
    {
      annotations: READ_ONLY,
      description: toolDescription("list_slide_responses"),
      inputSchema: z.object({ slideId: z.number().int().positive() }),
    },
    async ({ slideId }, extra) => runTool(runtime, extra, false, async (client) =>
      (await client.fetchSlideQuestionResponses(slideId)).map(projectQuestionResponse)
    )
  );

  server.registerTool(
    "get_slide",
    {
      annotations: READ_ONLY,
      description: toolDescription("get_slide"),
      inputSchema: z.object({ slideId: z.number().int().positive() }),
    },
    async ({ slideId }, extra) => runTool(runtime, extra, false, async (client) =>
      projectSlide(await client.fetchSlide(slideId))
    )
  );

  server.registerTool(
    "list_threads",
    {
      annotations: READ_ONLY,
      description: toolDescription("list_threads"),
      inputSchema: z.object(THREAD_LIST_SHAPE),
    },
    async ({ since, ...input }, extra) => runTool(runtime, extra, false, async (client) =>
      (await listThreads(client, { ...input, since: since ? parseSinceValue(since) : undefined }))
        .map(projectThreadSummary)
    )
  );

  server.registerTool(
    "search_threads",
    {
      annotations: READ_ONLY,
      description: toolDescription("search_threads"),
      inputSchema: z.object({
        ...THREAD_LIST_SHAPE,
        query: z.string().trim().min(1).describe(
          "Words that must all appear, case-insensitively, in the thread title or body."
        ),
      }),
    },
    async ({ since, ...input }, extra) => runTool(runtime, extra, false, async (client) =>
      (await listThreads(client, { ...input, since: since ? parseSinceValue(since) : undefined }))
        .map(projectThreadSummary)
    )
  );

  server.registerTool(
    "get_thread",
    {
      annotations: READ_ONLY,
      description: toolDescription("get_thread"),
      inputSchema: z.object({
        includeHtml: z.boolean().optional().default(false),
        threadId: z.number().int().positive(),
      }),
    },
    async ({ includeHtml, threadId }, extra) => runTool(runtime, extra, false, async (client) =>
      projectThreadDetail(await client.fetchThread(threadId), { includeHtml })
    )
  );

  server.registerTool(
    "get_course_thread",
    {
      annotations: READ_ONLY,
      description: toolDescription("get_course_thread"),
      inputSchema: z.object({
        courseId: COURSE_REFERENCE,
        includeHtml: z.boolean().optional().default(false),
        number: z.number().int().positive(),
      }),
    },
    async ({ courseId, includeHtml, number }, extra) =>
      runTool(runtime, extra, false, async (client) =>
        projectThreadDetail(
          await client.fetchCourseThread(await resolveCourseId(client, courseId), number),
          { includeHtml }
        )
      )
  );

  server.registerTool(
    "list_activity",
    {
      annotations: READ_ONLY,
      description: toolDescription("list_activity"),
      inputSchema: z.object({
        courseId: COURSE_REFERENCE.optional(),
        filterType: z.enum(["all", "thread", "answer", "comment"]).optional().default("all"),
        limit: z.number().int().positive().max(50).optional().default(30),
      }),
    },
    async ({ courseId, filterType, limit }, extra) => runTool(runtime, extra, false, async (client) =>
      compactActivity(await listCurrentActivity(client, { courseId, filterType, limit }))
    )
  );

  server.registerTool(
    "read_thread",
    {
      annotations: READ_ONLY,
      description: toolDescription("read_thread"),
      inputSchema: z.object({
        courseId: COURSE_REFERENCE.optional(),
        number: z.number().int().positive().optional().describe(
          "Course-local thread number; requires courseId."
        ),
        threadId: z.number().int().positive().optional().describe(
          "Global Ed thread ID; use instead of courseId and number."
        ),
      }).refine(
        ({ courseId, number, threadId }) => threadId === undefined
          ? courseId !== undefined && number !== undefined
          : courseId === undefined && number === undefined,
        { message: "Provide either threadId, or both courseId and number." }
      ),
    },
    async ({ courseId, number, threadId }, extra) =>
      runTool(runtime, extra, false, async (client) => {
        // The schema refinement guarantees exactly one of the two lookup forms.
        const thread = courseId !== undefined && number !== undefined
          ? await client.fetchCourseThread(await resolveCourseId(client, courseId), number)
          : await client.fetchThread(threadId!);
        return textResult(threadToMarkdown(thread));
      })
  );

  server.registerTool(
    "read_lesson",
    {
      annotations: READ_ONLY,
      description: toolDescription("read_lesson"),
      inputSchema: z.object({
        lessonId: z.number().int().positive().describe("Ed lesson ID."),
      }),
    },
    async ({ lessonId }, extra) => runTool(runtime, extra, false, async (client) =>
      textResult(lessonToMarkdown(await client.fetchLesson(lessonId)))
    )
  );

  server.registerTool(
    "read_slide",
    {
      annotations: READ_ONLY,
      description: toolDescription("read_slide"),
      inputSchema: z.object({
        slideId: z.number().int().positive().describe("Ed lesson slide ID."),
      }),
    },
    async ({ slideId }, extra) => runTool(runtime, extra, false, async (client) =>
      textResult(slideToMarkdown(await client.fetchSlide(slideId)))
    )
  );

  server.registerTool(
    "mark_lessons_read",
    {
      annotations: WRITES_PROGRESS,
      description: toolDescription("mark_lessons_read"),
      inputSchema: z.object({
        all: z.boolean().optional().default(false)
          .describe("Mark every lesson in the course; required when queries is empty."),
        courseId: COURSE_REFERENCE,
        delaySeconds: z.number().min(0).max(10).optional().default(0),
        queries: z.array(z.string().trim().min(1)).max(10).optional().default([]),
      }),
    },
    async ({ all, courseId, delaySeconds, queries }, extra) =>
      runTool(runtime, extra, true, (client) =>
        readLessons(client, courseId, queries, { all, delaySeconds })
      )
  );

  server.registerTool(
    "submit_slide_answer",
    {
      annotations: WRITE,
      description: toolDescription("submit_slide_answer"),
      inputSchema: z.object({
        amend: z.boolean().optional().default(false),
        choices: z.array(z.number().int().positive()).min(1),
        questionId: z.number().int().positive(),
      }),
    },
    async ({ amend, choices, questionId }, extra) => runTool(runtime, extra, true, (client) =>
      client.submitSlideAnswer(questionId, choices.map((choice) => choice - 1), { amend })
    )
  );

  server.registerTool(
    "submit_slide",
    {
      annotations: WRITE,
      description: toolDescription("submit_slide"),
      inputSchema: z.object({ slideId: z.number().int().positive() }),
    },
    async ({ slideId }, extra) => runTool(runtime, extra, true, (client) => client.submitSlide(slideId))
  );

  return server;
}

async function runTool(
  runtime: EdMcpRuntime,
  context: McpToolContext,
  writes: boolean,
  action: (client: EdClient) => Promise<unknown>
): Promise<ToolResult> {
  if (writes && !runtime.canWrite(context)) {
    return jsonError("INSUFFICIENT_SCOPE", "Write access is required for this tool.");
  }
  try {
    const result = await action(await runtime.getClient(context));
    return isToolResult(result) ? result : jsonResult(result);
  } catch (error) {
    const mapped = runtime.mapError?.(error, context);
    if (mapped) {
      return jsonError(mapped.type, mapped.message, mapped.extra);
    }
    if (error instanceof EdAuthExpiredError) {
      await runtime.onAuthExpired?.(context);
      return jsonError(
        "EDSTEM_REAUTH_REQUIRED",
        error.message,
        runtime.authErrorExtra?.(context)
      );
    }
    if (error instanceof EdInputError) {
      return jsonError("INVALID_ARGUMENT", error.message);
    }
    if (error instanceof EdApiError) {
      return jsonError("EDSTEM_API_ERROR", error.message, { statusCode: error.statusCode });
    }
    const message = error instanceof Error ? error.message : String(error);
    return jsonError("EDSTEM_UPSTREAM_ERROR", message);
  }
}

type ToolResult = {
  content: Array<
    | { text: string; type: "text" }
    | {
      description?: string;
      mimeType?: string;
      name: string;
      type: "resource_link";
      uri: string;
    }
  >;
  isError?: boolean;
};

function jsonResult(payload: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

function jsonError(type: string, message: string, extra: Record<string, unknown> = {}): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: { ...extra, message, type } }) }],
    isError: true,
  };
}

function fileLinksResult(files: LessonFile[]): ToolResult {
  return {
    content: [
      { type: "text", text: JSON.stringify(files) },
      ...files.map((file) => ({
        description: file.slideTitle ||
          (file.threadId ? `Thread ${file.threadId} file` : `Lesson ${file.lessonId} file`),
        ...(file.mediaType ? { mimeType: file.mediaType } : {}),
        name: file.filename,
        type: "resource_link" as const,
        uri: file.url,
      })),
    ],
  };
}

function isToolResult(value: unknown): value is ToolResult {
  return Boolean(value && typeof value === "object" && Array.isArray((value as ToolResult).content));
}
