import { McpServer, type AuthInfo } from "@modelcontextprotocol/server";
import { z } from "zod";

import { EdApiError, EdAuthExpiredError, type EdClient } from "../ed/client.js";
import { listLessonFiles, listThreadFiles } from "../ed/files.js";
import { markdownToEdDocument } from "../ed/document.js";
import type { LessonFile } from "../ed/models.js";
import {
  assertCommentInThread,
  defaultReplyType,
  EdInputError,
  listCurrentActivity,
  listLessons,
  listThreads,
  parseSinceValue,
  readLessons,
  resolveCourseId,
} from "../ed/operations.js";
import {
  projectActivity,
  projectComment,
  projectCourse,
  projectIdentity,
  projectLessonDetail,
  projectLessonSummary,
  projectModule,
  projectQuestion,
  projectQuestionResponse,
  projectSlide,
  projectThreadDetail,
  projectThreadSummary,
} from "../ed/projections.js";
import { lessonToMarkdown, slideToMarkdown, threadToMarkdown } from "../markdown.js";
import { VERSION } from "../version.js";
import { toolDescription } from "./catalog.js";

// This server only talks to Ed, so openWorldHint is false everywhere.
const READ_ONLY = {
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
  readOnlyHint: true,
} as const;
const WRITES_PROGRESS = {
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
  readOnlyHint: false,
} as const;
const WRITE = {
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
  readOnlyHint: false,
} as const;
const COURSE_REFERENCE = z.union([
  z.number().int().positive(),
  z.string().trim().min(1),
]).describe("Ed course ID, the unit code as Ed shows it, or part of the unit name (see list_courses). Do not assume a code format.");
const THREAD_LIST_SHAPE = {
  answered: z.boolean().optional().describe("Keep answered threads when true, unanswered when false; omit for both."),
  category: z.string().trim().min(1).optional().describe(
    'Exact top-level category as Ed shows it.'
  ),
  courseId: COURSE_REFERENCE,
  limit: z.number().int().positive().max(100).optional().default(30).describe("Maximum threads to return, capped at 100; defaults to 30."),
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
    'Exact second-level subcategory as Ed shows it.'
  ),
  threadType: z.string().trim().min(1).optional().describe(
    'Exact thread type, for example "question" or "post".'
  ),
};
const INCLUDE_HTML = z.boolean().optional().default(false).describe(
  "Also return Ed's XML content; the plain-text document is always returned."
);
const LESSON_ID = z.number().int().positive().describe(
  "Ed lesson ID as returned by list_lessons."
);
const SLIDE_ID = z.number().int().positive().describe(
  "Ed slide ID as returned by get_lesson."
);

export interface McpToolContext {
  http?: {
    authInfo?: AuthInfo;
  };
}

export interface EdMcpRuntime {
  authErrorExtra?: (context: McpToolContext) => Record<string, unknown>;
  /** Gate for tools that publish content to a course; defaults to canWrite. */
  canPost?: (context: McpToolContext) => boolean;
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
    { annotations: READ_ONLY, description: toolDescription("get_user"), title: "Get current user" },
    async (extra) => runTool(runtime, extra, "read", async (client) => {
      const identity = projectIdentity(await client.fetchUser());
      return { ...(identity.user as Record<string, unknown>), courses: identity.courses };
    })
  );

  server.registerTool(
    "list_courses",
    {
      annotations: READ_ONLY,
      description: toolDescription("list_courses"),
      inputSchema: z.object({
        includeArchived: z.boolean().optional().default(false).describe(
          "Also return courses Ed marks as archived; defaults to false."
        ),
      }),
      title: "List courses",
    },
    async ({ includeArchived }, extra) => runTool(runtime, extra, "read", async (client) => {
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
          'Module ID or case-insensitive text from the module name as Ed shows it. Use "all" or omit to include every module.'
        ),
        state: z.string().trim().min(1).optional().describe(
          'Exact availability state, for example "active" or "scheduled". Use "all" or omit to include every state.'
        ),
        status: z.string().trim().min(1).optional().describe(
          'Exact progress status: "unattempted", "attempted", or "completed". Use "all" or omit to include every status.'
        ),
      }),
      title: "List lessons",
    },
    async ({ courseId, lessonType, module, state, status }, extra) =>
      runTool(runtime, extra, "read", async (client) =>
        (await listLessons(client, courseId, { lessonType, module, state, status }))
          .map(projectLessonSummary)
      )
  );

  server.registerTool(
    "get_lesson",
    {
      annotations: READ_ONLY,
      description: toolDescription("get_lesson"),
      inputSchema: z.object({ lessonId: LESSON_ID }),
      title: "Get lesson",
    },
    async ({ lessonId }, extra) => runTool(runtime, extra, "read", async (client) =>
      projectLessonDetail(await client.fetchLesson(lessonId))
    )
  );

  server.registerTool(
    "list_lesson_files",
    {
      annotations: READ_ONLY,
      description: toolDescription("list_lesson_files"),
      inputSchema: z.object({ lessonId: LESSON_ID }),
      title: "List lesson files",
    },
    async ({ lessonId }, extra) => runTool(runtime, extra, "read", async (client) =>
      fileLinksResult(listLessonFiles(await client.fetchLesson(lessonId)))
    )
  );

  server.registerTool(
    "list_thread_files",
    {
      annotations: READ_ONLY,
      description: toolDescription("list_thread_files"),
      title: "List thread files",
      inputSchema: z.object({ threadId: z.number().int().positive().describe("Global thread ID as returned by list_threads.") }),
    },
    async ({ threadId }, extra) => runTool(runtime, extra, "read", async (client) =>
      fileLinksResult(listThreadFiles(await client.fetchThread(threadId)))
    )
  );

  server.registerTool(
    "list_slide_questions",
    {
      annotations: READ_ONLY,
      description: toolDescription("list_slide_questions"),
      inputSchema: z.object({ slideId: SLIDE_ID }),
      title: "List slide questions",
    },
    async ({ slideId }, extra) => runTool(runtime, extra, "read", async (client) =>
      (await client.fetchSlideQuestions(slideId)).map(projectQuestion)
    )
  );

  server.registerTool(
    "list_slide_responses",
    {
      annotations: READ_ONLY,
      description: toolDescription("list_slide_responses"),
      inputSchema: z.object({ slideId: SLIDE_ID }),
      title: "List slide responses",
    },
    async ({ slideId }, extra) => runTool(runtime, extra, "read", async (client) =>
      (await client.fetchSlideQuestionResponses(slideId)).map(projectQuestionResponse)
    )
  );

  server.registerTool(
    "get_slide",
    {
      annotations: READ_ONLY,
      description: toolDescription("get_slide"),
      title: "Get slide",
      inputSchema: z.object({ slideId: SLIDE_ID }),
    },
    async ({ slideId }, extra) => runTool(runtime, extra, "read", async (client) =>
      projectSlide(await client.fetchSlide(slideId))
    )
  );

  server.registerTool(
    "list_threads",
    {
      annotations: READ_ONLY,
      description: toolDescription("list_threads"),
      title: "List threads",
      inputSchema: z.object(THREAD_LIST_SHAPE),
    },
    async ({ since, ...input }, extra) => runTool(runtime, extra, "read", async (client) =>
      (await listThreads(client, { ...input, since: since ? parseSinceValue(since) : undefined }))
        .map(projectThreadSummary)
    )
  );

  server.registerTool(
    "search_threads",
    {
      annotations: READ_ONLY,
      description: toolDescription("search_threads"),
      title: "Search threads",
      inputSchema: z.object({
        ...THREAD_LIST_SHAPE,
        query: z.string().trim().min(1).describe(
          "Words that must all appear, case-insensitively, in the thread title or body."
        ),
      }),
    },
    async ({ since, ...input }, extra) => runTool(runtime, extra, "read", async (client) =>
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
        includeHtml: INCLUDE_HTML,
        threadId: z.number().int().positive().describe(
          "Global Ed thread ID as returned by list_threads; for the number shown inside a course use get_course_thread."
        ),
      }),
      title: "Get thread",
    },
    async ({ includeHtml, threadId }, extra) => runTool(runtime, extra, "read", async (client) =>
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
        includeHtml: INCLUDE_HTML,
        number: z.number().int().positive().describe(
          "One-based thread number as shown inside the course, the #N in the Ed thread list."
        ),
      }),
      title: "Get thread by course number",
    },
    async ({ courseId, includeHtml, number }, extra) =>
      runTool(runtime, extra, "read", async (client) =>
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
        courseId: COURSE_REFERENCE.optional().describe(
          "Ed course ID, or the course code exactly as Ed shows it, to filter by. Omit for every course."
        ),
        filterType: z.enum(["all", "thread", "answer", "comment"]).optional().default("all").describe(
          'Kind of activity to keep. Defaults to "all".'
        ),
        limit: z.number().int().positive().max(50).optional().default(30).describe(
          "Maximum items, capped at 50; defaults to 30."
        ),
      }),
      title: "List my activity",
    },
    async ({ courseId, filterType, limit }, extra) => runTool(runtime, extra, "read", async (client) =>
      projectActivity(await listCurrentActivity(client, { courseId, filterType, limit }))
    )
  );

  server.registerTool(
    "read_thread",
    {
      annotations: READ_ONLY,
      description: toolDescription("read_thread"),
      title: "Read thread",
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
      runTool(runtime, extra, "read", async (client) => {
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
      title: "Read lesson",
      inputSchema: z.object({
        lessonId: z.number().int().positive().describe("Ed lesson ID."),
      }),
    },
    async ({ lessonId }, extra) => runTool(runtime, extra, "read", async (client) =>
      textResult(lessonToMarkdown(await client.fetchLesson(lessonId)))
    )
  );

  server.registerTool(
    "read_slide",
    {
      annotations: READ_ONLY,
      description: toolDescription("read_slide"),
      title: "Read slide",
      inputSchema: z.object({
        slideId: z.number().int().positive().describe("Ed lesson slide ID."),
      }),
    },
    async ({ slideId }, extra) => runTool(runtime, extra, "read", async (client) =>
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
        delaySeconds: z.number().min(0).max(10).optional().default(0).describe(
          "Seconds to pause after each slide, 0 to 10; defaults to 0. Raise it to go easy on Ed."
        ),
        queries: z.array(z.string().trim().min(1)).max(10).optional().default([]).describe(
          "Case-insensitive substrings that must all appear in the lesson title or module name; at most 10. When queries is empty, all must be true to mark every lesson of the course."
        ),
      }),
      title: "Mark lessons read",
    },
    async ({ all, courseId, delaySeconds, queries }, extra) =>
      runTool(runtime, extra, "write", (client) =>
        readLessons(client, courseId, queries, { all, delaySeconds })
      )
  );

  server.registerTool(
    "submit_slide_answer",
    {
      annotations: WRITE,
      description: toolDescription("submit_slide_answer"),
      inputSchema: z.object({
        amend: z.boolean().optional().default(false).describe(
          "Overwrite an answer already saved for this question; defaults to false."
        ),
        choices: z.array(z.number().int().positive()).min(1).describe(
          "One-based answer indexes as shown by list_slide_questions; pass several for multiple-selection questions."
        ),
        questionId: z.number().int().positive().describe(
          "Ed question ID as returned by list_slide_questions."
        ),
      }),
      title: "Submit slide answer",
    },
    async ({ amend, choices, questionId }, extra) => runTool(runtime, extra, "write", (client) =>
      client.submitSlideAnswer(questionId, choices.map((choice) => choice - 1), { amend })
    )
  );

  server.registerTool(
    "submit_slide",
    {
      annotations: WRITE,
      description: toolDescription("submit_slide"),
      inputSchema: z.object({
        slideId: SLIDE_ID.describe(
          "Ed slide ID whose saved answers are submitted, as returned by get_lesson."
        ),
      }),
      title: "Submit slide",
    },
    async ({ slideId }, extra) => runTool(runtime, extra, "write", (client) => client.submitSlide(slideId))
  );

  server.registerTool(
    "create_thread",
    {
      annotations: WRITE,
      description: toolDescription("create_thread"),
      title: "Create thread",
      inputSchema: z.object({
        anonymous: z.boolean().optional().default(false).describe(
          "Hide the author name from other students. Staff can still see it."
        ),
        body: z.string().trim().min(1).describe(
          "Post body in Markdown. It is converted to Ed's document format before posting."
        ),
        category: z.string().trim().min(1).optional().describe(
          'Exact top-level category for the course as Ed shows it.'
        ),
        courseId: COURSE_REFERENCE,
        private: z.boolean().optional().default(false).describe(
          "Post privately to course staff instead of the whole course."
        ),
        title: z.string().trim().min(1).describe("Thread title shown in the course thread list."),
        type: z.enum(["question", "post", "announcement"]).describe(
          'Ed thread type. Use "question" to ask, "post" to discuss; "announcement" needs staff rights.'
        ),
      }),
    },
    async ({ anonymous, body, category, courseId, private: isPrivate, title, type }, extra) =>
      runTool(runtime, extra, "post", async (client) =>
        projectThreadDetail(await client.createThread(
          await resolveCourseId(client, courseId),
          {
            anonymous,
            category,
            content: markdownToEdDocument(body),
            private: isPrivate,
            title,
            type,
          }
        ))
      )
  );

  server.registerTool(
    "reply_thread",
    {
      annotations: WRITE,
      description: toolDescription("reply_thread"),
      title: "Reply to thread",
      inputSchema: z.object({
        anonymous: z.boolean().optional().default(false).describe(
          "Hide the author name from other students. Staff can still see it."
        ),
        as: z.enum(["answer", "comment"]).optional().describe(
          'Reply kind. Defaults to "answer" on question threads and "comment" elsewhere.'
        ),
        body: z.string().trim().min(1).describe(
          "Reply body in Markdown. It is converted to Ed's document format before posting."
        ),
        private: z.boolean().optional().default(false).describe(
          "Post privately to course staff instead of the whole course."
        ),
        threadId: z.number().int().positive().describe("Global Ed thread ID to reply to."),
        toCommentId: z.number().int().positive().optional().describe(
          "Reply under this comment of the thread instead of at the top level. "
          + "The comment must belong to threadId."
        ),
      }),
    },
    async ({ anonymous, as, body, private: isPrivate, threadId, toCommentId }, extra) =>
      runTool(runtime, extra, "post", async (client) => {
        const thread = await client.fetchThread(threadId);
        if (toCommentId !== undefined) {
          assertCommentInThread(thread, toCommentId);
        }
        const input = {
          anonymous,
          content: markdownToEdDocument(body),
          private: isPrivate,
          type: as ?? defaultReplyType(thread.type),
        };
        const comment = toCommentId === undefined
          ? await client.createThreadReply(threadId, input)
          : await client.createCommentReply(toCommentId, input);
        return { ...projectComment(comment), threadId };
      })
  );

  server.registerTool(
    "list_modules",
    {
      annotations: READ_ONLY,
      description: toolDescription("list_modules"),
      inputSchema: z.object({ courseId: COURSE_REFERENCE }),
      title: "List lesson modules",
    },
    async ({ courseId }, extra) => runTool(runtime, extra, "read", async (client) => {
      const { lessons, modules } = await client.fetchLessons(await resolveCourseId(client, courseId));
      return modules.map((module) =>
        projectModule(module, lessons.filter((lesson) => lesson.moduleId === module.id).length)
      );
    })
  );

  server.registerPrompt(
    "triage_unanswered",
    {
      argsSchema: z.object({
        courseId: z.string().describe(
          "Ed course ID, or the course code exactly as Ed shows it (see list_courses)."
        ),
        limit: z.string().optional().describe(
          "Maximum threads to triage, capped at 100; defaults to 30."
        ),
      }),
      description: "Triage the unanswered threads of one course into a table of next steps.",
      title: "Triage unanswered threads",
    },
    ({ courseId, limit }) => ({
      messages: [{
        content: { text: triagePrompt(courseId, limit), type: "text" as const },
        role: "user" as const,
      }],
    })
  );

  return server;
}

function triagePrompt(courseId: string, limit: string | undefined): string {
  return [
    `Triage the unanswered Ed threads of course ${courseId}.`,
    "",
    `1. Call list_threads with courseId=${courseId}, answered=false, sort="new"`
      + `, limit=${limit ?? "30"}.`,
    "2. Call get_thread on every thread returned, using its id.",
    "3. Produce a Markdown table with one row per thread and these columns:",
    "   thread number, title, age (how long since createdAt), staff replied"
      + " (yes or no, from endorsement.hasStaffAnswer), suggested next step.",
    "",
    "Order the rows oldest first, keep each suggested next step to one short sentence,"
      + " and say so plainly if nothing needs attention.",
  ].join("\n");
}

async function runTool(
  runtime: EdMcpRuntime,
  context: McpToolContext,
  mode: ToolMode,
  action: (client: EdClient) => Promise<unknown>
): Promise<ToolResult> {
  if (mode !== "read" && !runtime.canWrite(context)) {
    return jsonError("INSUFFICIENT_SCOPE", "Write access is required for this tool.");
  }
  if (mode === "post" && !(runtime.canPost ?? runtime.canWrite)(context)) {
    return jsonError(
      "INSUFFICIENT_SCOPE",
      "Posting is disabled; set EDSTEM_ALLOW_POSTING=1 for edstem-mcp."
    );
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

type ToolMode = "read" | "write" | "post";

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
