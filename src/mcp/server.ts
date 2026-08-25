import { McpServer, type AuthInfo } from "@modelcontextprotocol/server";
import { z } from "zod";

import { EdApiError, EdAuthExpiredError, type EdClient } from "../ed/client.js";
import { listLessonFiles } from "../ed/files.js";
import type { LessonFile } from "../ed/models.js";
import {
  EdInputError,
  listCurrentActivity,
  listLessons,
  listThreads,
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
  projectThreadDetail,
  projectThreadSummary,
} from "../ed/projections.js";
import { VERSION } from "../version.js";
import { toolDescription } from "./catalog.js";

const READ_ONLY = { destructiveHint: false, readOnlyHint: true } as const;
const WRITES_PROGRESS = { destructiveHint: false, readOnlyHint: false } as const;
const WRITE = { destructiveHint: true, readOnlyHint: false } as const;
const COURSE_REFERENCE = z.union([
  z.number().int().positive(),
  z.string().trim().min(1),
]).describe('Ed course ID or exact course code, for example 38435 or "FIT2014".');

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
    "list_threads",
    {
      annotations: READ_ONLY,
      description: toolDescription("list_threads"),
      inputSchema: z.object({
        answered: z.boolean().optional(),
        category: z.string().trim().min(1).optional().describe(
          'Exact top-level category, for example "Applied".'
        ),
        courseId: COURSE_REFERENCE,
        limit: z.number().int().positive().max(100).optional().default(30),
        sort: z.enum(["new", "old", "top", "hot"]).optional().default("new").describe(
          'Ed sort order. Defaults to "new"; Ed may keep pinned threads ahead of that order.'
        ),
        subcategory: z.string().trim().min(1).optional().describe(
          'Exact second-level subcategory, for example "MiniTests".'
        ),
        threadType: z.string().trim().min(1).optional().describe(
          'Exact thread type, for example "question" or "post".'
        ),
      }),
    },
    async ({ answered, category, courseId, limit, sort, subcategory, threadType }, extra) =>
      runTool(runtime, extra, false, async (client) =>
        (await listThreads(client, {
          answered,
          category,
          courseId,
          limit,
          sort,
          subcategory,
          threadType,
        }))
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
    "mark_lessons_read",
    {
      annotations: WRITES_PROGRESS,
      description: toolDescription("mark_lessons_read"),
      inputSchema: z.object({
        courseId: COURSE_REFERENCE,
        delaySeconds: z.number().min(0).max(10).optional().default(0),
        queries: z.array(z.string().trim().min(1)).max(10).optional().default([]),
      }),
    },
    async ({ courseId, delaySeconds, queries }, extra) =>
      runTool(runtime, extra, true, (client) => readLessons(client, courseId, queries, delaySeconds))
  );

  server.registerTool(
    "submit_slide_answer",
    {
      annotations: WRITE,
      description: toolDescription("submit_slide_answer"),
      inputSchema: z.object({
        amend: z.boolean().optional().default(false),
        choices: z.array(z.number().int().positive()).optional().default([]),
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
        description: file.slideTitle || `Lesson ${file.lessonId} file`,
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
