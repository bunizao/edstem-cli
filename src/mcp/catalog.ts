// One description per tool, shared by the MCP server and the generated SKILL.md.
// Shape: what it returns / use when / not for / refs accepted / then / cost.
// Shipped text is institution-neutral: no real course codes, names, or hosts.
export const MCP_TOOL_CATALOG = [
  [
    "get_user",
    "Who is signed in and the courses they can see. Use when a request is vague or you need to learn how this Ed site names its courses. Not for course details beyond id, code, name and status (same list as list_courses). Then pass a course id or code to any courseId argument. Cost: small.",
  ],
  [
    "list_courses",
    "Enrolled courses with id, code, name and status; archived courses omitted unless includeArchived. Use when the user asks what they are enrolled in, or names a course you cannot resolve. Then use the id or the code exactly as returned as courseId. Cost: small.",
  ],
  [
    "list_lessons",
    "Compact lesson summaries for one course: id, title, module, type, state, progress. Use when the user asks which lessons, modules or weeks exist, or what is unfinished. Call without filters first; an empty list means the course has no Ed Lessons. Filters are case-insensitive; pass all or omit a filter to include every value. courseId accepts a numeric ID or the course code exactly as Ed shows it. Then get_lesson for slides, list_lesson_files for downloads, mark_lessons_read to update progress. Cost: about 100 bytes per lesson.",
  ],
  [
    "get_lesson",
    "One lesson with its slides and slide content. Use when the user asks what a lesson says or you need a slide id. Not for downloadable files (list_lesson_files) or quiz questions (list_slide_questions). lessonId comes from list_lessons. Cost: large for long lessons.",
  ],
  [
    "list_lesson_files",
    "Ed-hosted downloadable files and direct resource links for one lesson, returned as resource links. Use when the user wants slides, PDFs or attachments. Not for external links inside lesson text (get_lesson). lessonId comes from list_lessons. Cost: small.",
  ],
  [
    "list_slide_questions",
    "Quiz questions for one lesson slide with one-based choice numbers. Use when the user wants to see or answer a quiz. slideId comes from get_lesson. Then submit_slide_answer per question, then submit_slide. Cost: small.",
  ],
  [
    "list_slide_responses",
    "Saved quiz responses for one lesson slide. Use when the user asks what they answered or whether a quiz is submitted. slideId comes from get_lesson. Cost: small.",
  ],
  [
    "list_threads",
    "Compact thread summaries for one course: id, number, title, category, answered state. Use when the user asks what is being discussed or wants a thread by title. Categories are hierarchical: category is top-level and subcategory is second-level, spelled as Ed shows them. Sort defaults to new; Ed may keep pinned threads first. Not for thread bodies (get_thread) or the user's own posts (list_activity). courseId accepts a numeric ID or course code. Cost: about 150 bytes per thread; use limit.",
  ],
  [
    "get_thread",
    "One thread with its answers and comments, compact. Use when the user wants what a thread says. threadId is the global id from list_threads or list_activity; for a course-local number such as #42 use get_course_thread. Cost: proportional to replies.",
  ],
  [
    "get_course_thread",
    "One thread addressed by course and course-local number (the #N Ed shows), compact. Use when the user gives a thread number rather than a global id. courseId accepts a numeric ID or course code. Cost: as get_thread.",
  ],
  [
    "list_activity",
    "The signed-in user's recent threads, answers and comments, optionally within one course. Use when the user asks what they posted or whether anyone replied. Not for other people's activity (list_threads). courseId is optional and accepts a numeric ID or course code. Cost: small.",
  ],
  [
    "mark_lessons_read",
    "Mark lessons and their slides as read; writes progress. Use only when the user explicitly asks to mark lessons read or complete. queries are words that must appear in lesson or module names; no queries means every lesson in the course. courseId accepts a numeric ID or course code. Cost: one write per slide.",
  ],
  [
    "submit_slide_answer",
    "Save one-based choices for one quiz question; writes. Use only when the user has chosen the answer. questionId comes from list_slide_questions. Then submit_slide to finalise the slide. Cost: one write.",
  ],
  [
    "submit_slide",
    "Submit all saved answers for one quiz slide; writes and is usually final. Use only with explicit user intent after answers are saved. slideId comes from get_lesson. Cost: one write.",
  ],
  [
    "get_slide",
    "One lesson slide with its content as structured data. Use when you already have a slide id and need only that slide rather than the whole lesson. slideId comes from get_lesson. For prose, prefer read_slide. Cost: small to medium.",
  ],
  [
    "read_thread",
    "One thread with its answers and comments as Markdown. Use when the user wants to read a thread rather than inspect its fields. Pass either threadId, or courseId plus the course-local number (the #N Ed shows). Cost: proportional to replies.",
  ],
  [
    "read_lesson",
    "One lesson and its slides as Markdown. Use when the user wants to read or summarise a lesson. lessonId comes from list_lessons. Not for files (list_lesson_files) or quiz questions (list_slide_questions). Cost: large for long lessons.",
  ],
  [
    "read_slide",
    "One lesson slide as Markdown. Use when the user wants to read a single slide. slideId comes from get_lesson. Cost: small to medium.",
  ],
  [
    "list_thread_files",
    "Ed-hosted downloadable files and direct resource links attached to one thread, including its answers and comments, returned as resource links. Use when the user wants attachments from a thread. threadId is the global id from list_threads. Cost: small.",
  ],
  [
    "search_threads",
    "Threads in one course whose title or body contains every query word, case-insensitively. Use when the user asks about a topic rather than a thread number. Ed is paged client-side until limit threads match; accepts the same filters as list_threads. courseId accepts a numeric ID or course code. Then get_thread or read_thread for the body. Cost: several Ed pages for rare words; use limit and since.",
  ],
  [
    "list_modules",
    "Lesson modules of one course with the number of lessons in each. Use when the user asks which weeks or modules exist, or to pick a module value for list_lessons. courseId accepts a numeric ID or course code. Cost: small.",
  ],
  [
    "create_thread",
    "Create a thread in one course; posts publicly as the token owner and cannot be removed from here. Use only when the user explicitly asks to post and has approved the title and body. body is Markdown and is converted to Ed's document format. courseId accepts a numeric ID or course code. Cost: one write.",
  ],
  [
    "reply_thread",
    "Reply to one thread, or to one comment inside it; posts publicly as the token owner and cannot be removed from here. Use only when the user explicitly asks to reply and has approved the body. body is Markdown and is converted to Ed's document format. threadId is the global id. Cost: one write.",
  ],
] as const;

export type McpToolName = typeof MCP_TOOL_CATALOG[number][0];

export function toolDescription(name: McpToolName): string {
  return MCP_TOOL_CATALOG.find(([candidate]) => candidate === name)?.[1] ?? name;
}
