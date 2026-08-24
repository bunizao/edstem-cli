export const MCP_TOOL_CATALOG = [
  ["get_user", "Get the current Ed identity and enrolled courses."],
  ["list_courses", "List enrolled courses; archived courses are omitted by default."],
  ["list_lessons", "List compact lesson summaries for one course."],
  ["get_lesson", "Get one lesson with slide content."],
  ["list_lesson_files", "List Ed-hosted downloadable files and direct resource links for one lesson."],
  ["list_slide_questions", "List quiz questions for one lesson slide."],
  ["list_slide_responses", "List saved quiz responses for one lesson slide."],
  ["list_threads", "List compact thread summaries for one course."],
  ["get_thread", "Get a compact thread detail by global thread ID."],
  ["get_course_thread", "Get a compact thread detail by course ID and course-local number."],
  ["list_activity", "List compact current-user activity, optionally for one course."],
  ["mark_lessons_read", "Mark matching lessons and slides as read for the current Ed user."],
  ["submit_slide_answer", "Submit one-based quiz choices for one question."],
  ["submit_slide", "Submit all saved answers for one quiz slide."],
] as const;

export type McpToolName = typeof MCP_TOOL_CATALOG[number][0];

export function toolDescription(name: McpToolName): string {
  return MCP_TOOL_CATALOG.find(([candidate]) => candidate === name)?.[1] ?? name;
}
