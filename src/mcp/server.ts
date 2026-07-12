import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { z } from "zod";

import { EdApiError, EdAuthExpiredError, type EdClient } from "../ed/client.js";
import { listCurrentActivity, listLessons, listThreads, readLessons } from "../ed/operations.js";
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

const READ_ONLY = { destructiveHint: false, readOnlyHint: true } as const;
const WRITES_PROGRESS = { destructiveHint: false, readOnlyHint: false } as const;
const WRITE = { destructiveHint: true, readOnlyHint: false } as const;

export interface McpToolContext {
  authInfo?: AuthInfo;
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
    { annotations: READ_ONLY, description: "Get the current Ed identity and enrolled courses." },
    async (extra) => runTool(runtime, extra, false, async (client) => {
      const identity = projectIdentity(await client.fetchUser());
      return { ...(identity.user as Record<string, unknown>), courses: identity.courses };
    })
  );

  server.registerTool(
    "list_courses",
    {
      annotations: READ_ONLY,
      description: "List enrolled courses; archived courses are omitted by default.",
      inputSchema: { includeArchived: z.boolean().optional().default(false) },
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
      description: "List compact lesson summaries for one course.",
      inputSchema: {
        courseId: z.number().int().positive(),
        lessonType: z.string().trim().min(1).optional(),
        module: z.string().trim().min(1).optional(),
        state: z.string().trim().min(1).optional(),
        status: z.string().trim().min(1).optional(),
      },
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
      description: "Get one lesson with slide content.",
      inputSchema: { lessonId: z.number().int().positive() },
    },
    async ({ lessonId }, extra) => runTool(runtime, extra, false, async (client) =>
      projectLessonDetail(await client.fetchLesson(lessonId))
    )
  );

  server.registerTool(
    "list_slide_questions",
    {
      annotations: READ_ONLY,
      description: "List quiz questions for one lesson slide.",
      inputSchema: { slideId: z.number().int().positive() },
    },
    async ({ slideId }, extra) => runTool(runtime, extra, false, async (client) =>
      (await client.fetchSlideQuestions(slideId)).map(projectQuestion)
    )
  );

  server.registerTool(
    "list_slide_responses",
    {
      annotations: READ_ONLY,
      description: "List saved quiz responses for one lesson slide.",
      inputSchema: { slideId: z.number().int().positive() },
    },
    async ({ slideId }, extra) => runTool(runtime, extra, false, async (client) =>
      (await client.fetchSlideQuestionResponses(slideId)).map(projectQuestionResponse)
    )
  );

  server.registerTool(
    "list_threads",
    {
      annotations: READ_ONLY,
      description: "List compact thread summaries for one course.",
      inputSchema: {
        answered: z.boolean().optional(),
        category: z.string().trim().min(1).optional(),
        courseId: z.number().int().positive(),
        limit: z.number().int().positive().max(100).optional().default(30),
        sort: z.enum(["new", "old", "top", "hot"]).optional().default("new"),
        threadType: z.string().trim().min(1).optional(),
      },
    },
    async ({ answered, category, courseId, limit, sort, threadType }, extra) =>
      runTool(runtime, extra, false, async (client) =>
        (await listThreads(client, { answered, category, courseId, limit, sort, threadType }))
          .map(projectThreadSummary)
      )
  );

  server.registerTool(
    "get_thread",
    {
      annotations: READ_ONLY,
      description: "Get a compact thread detail by global thread ID.",
      inputSchema: {
        includeHtml: z.boolean().optional().default(false),
        threadId: z.number().int().positive(),
      },
    },
    async ({ includeHtml, threadId }, extra) => runTool(runtime, extra, false, async (client) =>
      projectThreadDetail(await client.fetchThread(threadId), { includeHtml })
    )
  );

  server.registerTool(
    "get_course_thread",
    {
      annotations: READ_ONLY,
      description: "Get a compact thread detail by course ID and course-local number.",
      inputSchema: {
        courseId: z.number().int().positive(),
        includeHtml: z.boolean().optional().default(false),
        number: z.number().int().positive(),
      },
    },
    async ({ courseId, includeHtml, number }, extra) =>
      runTool(runtime, extra, false, async (client) =>
        projectThreadDetail(await client.fetchCourseThread(courseId, number), { includeHtml })
      )
  );

  server.registerTool(
    "list_activity",
    {
      annotations: READ_ONLY,
      description: "List compact current-user activity, optionally for one course.",
      inputSchema: {
        courseId: z.number().int().positive().optional(),
        filterType: z.enum(["all", "thread", "answer", "comment"]).optional().default("all"),
        limit: z.number().int().positive().max(50).optional().default(30),
      },
    },
    async ({ courseId, filterType, limit }, extra) => runTool(runtime, extra, false, async (client) =>
      compactActivity(await listCurrentActivity(client, { courseId, filterType, limit }))
    )
  );

  server.registerTool(
    "mark_lessons_read",
    {
      annotations: WRITES_PROGRESS,
      description: "Mark matching lessons and slides as read for the current Ed user.",
      inputSchema: {
        courseId: z.number().int().positive(),
        delaySeconds: z.number().min(0).max(10).optional().default(0),
        queries: z.array(z.string().trim().min(1)).max(10).optional().default([]),
      },
    },
    async ({ courseId, delaySeconds, queries }, extra) =>
      runTool(runtime, extra, true, (client) => readLessons(client, courseId, queries, delaySeconds))
  );

  server.registerTool(
    "submit_slide_answer",
    {
      annotations: WRITE,
      description: "Submit one-based quiz choices for one question.",
      inputSchema: {
        amend: z.boolean().optional().default(false),
        choices: z.array(z.number().int().positive()).optional().default([]),
        questionId: z.number().int().positive(),
      },
    },
    async ({ amend, choices, questionId }, extra) => runTool(runtime, extra, true, (client) =>
      client.submitSlideAnswer(questionId, choices.map((choice) => choice - 1), { amend })
    )
  );

  server.registerTool(
    "submit_slide",
    {
      annotations: WRITE,
      description: "Submit all saved answers for one quiz slide.",
      inputSchema: { slideId: z.number().int().positive() },
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
    return jsonResult(await action(await runtime.getClient(context)));
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
    if (error instanceof EdApiError) {
      return jsonError("EDSTEM_API_ERROR", error.message, { statusCode: error.statusCode });
    }
    const message = error instanceof Error ? error.message : String(error);
    return jsonError("EDSTEM_UPSTREAM_ERROR", message);
  }
}

type ToolResult = {
  content: Array<{ text: string; type: "text" }>;
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
