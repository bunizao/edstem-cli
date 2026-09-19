export const MCP_TOOL_CATALOG = [
  ["get_user", "Get the current Ed identity and enrolled courses."],
  ["list_courses", "List enrolled courses; archived courses are omitted by default."],
  [
    "list_lessons",
    "List compact lesson summaries for one course. courseId accepts a numeric ID or course code. Call without filters first: an empty list means the course has no Ed Lessons. Filters are case-insensitive; use all or omit a filter to include every value.",
  ],
  ["get_lesson", "Get one lesson with slide content."],
  ["list_lesson_files", "List Ed-hosted downloadable files and direct resource links for one lesson."],
  ["list_slide_questions", "List quiz questions for one lesson slide."],
  ["list_slide_responses", "List saved quiz responses for one lesson slide."],
  [
    "list_threads",
    "List compact thread summaries for one course. courseId accepts a numeric ID or course code. Categories are hierarchical: category is top-level and subcategory is second-level. Sort defaults to new; Ed may keep pinned threads first.",
  ],
  ["get_thread", "Get a compact thread detail by global thread ID."],
  ["get_course_thread", "Get a compact thread detail by course ID or code and course-local number."],
  ["list_activity", "List compact current-user activity, optionally filtered by course ID or code."],
  ["mark_lessons_read", "Mark matching lessons and slides as read using a course ID or code."],
  ["submit_slide_answer", "Submit one-based quiz choices for one question."],
  ["submit_slide", "Submit all saved answers for one quiz slide."],
  ["get_slide", "Get one lesson slide with its content."],
  [
    "read_thread",
    "Read one thread as Markdown. Pass either threadId, or courseId plus the course-local number.",
  ],
  ["read_lesson", "Read one lesson and its slides as Markdown."],
  ["read_slide", "Read one lesson slide as Markdown."],
  [
    "list_thread_files",
    "List Ed-hosted downloadable files and direct resource links attached to one thread, including its answers and comments.",
  ],
  [
    "search_threads",
    "Search threads in one course. Every query word must appear, case-insensitively, in the thread title or body; Ed is paged client-side until limit threads match. Accepts the same filters as list_threads.",
  ],
  [
    "list_modules",
    "List the lesson modules of one course with the number of lessons in each. courseId accepts a numeric ID or course code. Use it to pick a module value for list_lessons.",
  ],
] as const;

export type McpToolName = typeof MCP_TOOL_CATALOG[number][0];

export function toolDescription(name: McpToolName): string {
  return MCP_TOOL_CATALOG.find(([candidate]) => candidate === name)?.[1] ?? name;
}
