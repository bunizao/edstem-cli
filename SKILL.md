---
name: edstem-cli
description: Read and update Ed Discussion (units, threads, lessons, files, quizzes, activity) through the edstem CLI, a local stdio MCP server, or the hosted MCP server. Start from what the user said, not from ids.
---

# edstem-cli

Choose the narrowest surface that fits the environment:

- Use `edstem` for shell access, scripts, and deterministic automation.
- Use `edstem-mcp` when a local MCP client can launch a stdio server with `EDSTEM_TOKEN`.
- Use `https://edstem.tuuhub.com/mcp` when the client needs hosted Streamable HTTP and OAuth.

## What the user says, and what to run

`UNIT` is the unit's Ed course ID or its code exactly as Ed shows it. Do not assume what
a code looks like; `edstem units` is the vocabulary for this site. If one code matches
several enrolments, use the numeric ID shown by `edstem units --archived`. Never ask the
user for numeric ids when a code or a `UNIT#N` thread number will do.

| The user says | Run | Notes |
| --- | --- | --- |
| which units am I in / how are units named here | `edstem units` | shows id, code, name; copy the code as shown |
| what's being discussed / any questions about X / latest in UNIT | `edstem threads UNIT --max 20` | add `--unanswered`, `--category`, `--subcategory` |
| what does thread #N say / read that thread | `edstem threads read UNIT#N` | a global thread id also works |
| my posts / did anyone reply to me | `edstem activity [UNIT]` |  |
| which lessons, weeks or modules exist / what's unfinished | `edstem lessons UNIT` | then `--status unattempted` or `--module <text>` |
| what's in a lesson / the slides | `edstem lessons show <lesson id>` | lesson id from `edstem lessons UNIT` |
| download the slides / files | `edstem files get <lesson id> --dest DIR` | `files list` first to see what exists |
| quiz questions / what did I answer | `edstem slides show <slide id> --section questions` | `--section responses` for saved answers |
| mark lessons as read or complete (only when asked) | `edstem lessons mark-read UNIT [words...] --dry-run` | then repeat with `--yes` |
| answer or submit a quiz (only when asked) | `edstem slides submit <slide id> --question ID --choice N` | then `edstem slides submit <slide id>` to finalise |
| is my token working | `edstem auth status` |  |

MCP clients use the tool with the same noun: `list_threads`, `get_course_thread`,
`list_lessons`, `list_lesson_files`, `list_slide_questions`. Every `courseId` accepts
the same `UNIT` reference, so no `list_courses` call is needed first.

## Agent rules

- Run the narrowest command or tool that answers the request; one call per intent.
- Successful piped output is JSON by default. Use `--fields` to retain only needed top-level fields.
- Use `--json`, `--yaml`, or `--table` only when overriding TTY-based format selection.
- The `read` verb prints Markdown and never mutates upstream state.
- Commands marked as mutating require explicit user intent and either an interactive confirmation or `--yes`.
- Use `--dry-run` to inspect a mutation plan without changing Ed state.
- Category, subcategory, module and type filters must be spelled as Ed shows them; an invalid filter lists the values available in that unit.
- Treat Ed API tokens as passwords. Never print, log, or persist them in project files.
- `edstem commands --json` is the source of truth for this command tree; the published `@bunizao/cli-kit` npm package (`^0.1.0`) defines the shared CLI contract.

## Setup

```bash
npm install -g edstem-cli
export EDSTEM_TOKEN="your-token"
edstem units
```

## CLI reference

| Command | Description | Arguments | Options | Mutating |
| --- | --- | --- | --- | --- |
| edstem auth | Inspect Ed authentication. |  |  | no |
| edstem auth status | Verify the configured Ed token. |  |  | no |
| edstem user | Show the current Ed identity and enrolled units. |  |  | no |
| edstem units | List or show enrolled units. |  |  | no |
| edstem units list | List enrolled units. |  | --archived | no |
| edstem units show | Show one enrolled unit. | <unit> |  | no |
| edstem threads | List, show, or read Ed threads. |  |  | no |
| edstem threads list | List threads in a unit. | <unit> | -n, --max <count><br>-s, --sort <order><br>-c, --category <category><br>--subcategory <subcategory><br>-t, --type <type><br>--answered<br>--unanswered | no |
| edstem threads show | Show a thread by ID or unit ID/code plus #number. | <reference> | --include-html | no |
| edstem threads read | Read a thread body as Markdown. | <reference> |  | no |
| edstem lessons | List, show, or mark lessons as read. |  |  | no |
| edstem lessons list | List lessons in a unit. | <unit> | --module <module><br>--type <type><br>--state <state><br>--status <status> | no |
| edstem lessons show | Show one lesson and its slides. | <lesson> |  | no |
| edstem lessons mark-read | Mark matching lessons and slides as read. | <unit> [queries...] | --delay <seconds> | yes |
| edstem slides | Inspect or submit lesson slides. |  |  | no |
| edstem slides show | Show slide content, questions, responses, or quiz context. | <slide> | --section <section> | no |
| edstem slides submit | Save one answer or submit all saved answers for a slide. | <slide> | --question <question><br>--choice <number><br>--amend | yes |
| edstem files | List or download Ed-hosted lesson files. |  |  | no |
| edstem files list | List Ed-hosted downloadable files in one lesson. | <lesson> |  | no |
| edstem files get | Download Ed-hosted files from one lesson. | <lesson> | --dest <directory><br>--slide <slide><br>--force | no |
| edstem activity | List current-user activity. | [unit] | -n, --max <count><br>-f, --filter <type> | no |
| edstem commands | Describe the complete command tree. |  |  | no |
| edstem skills | Generate the agent skill. |  |  | no |
| edstem skills generate | Regenerate SKILL.md from command metadata. |  |  | no |

Global options: `--json`, `--yaml`, `--table`, `--fields a,b`, `--output FILE`, `--quiet`, `--verbose`, `--no-color`, `--yes`, and `--dry-run`.

Run `edstem commands --json` for machine-readable metadata, including aliases, enum values, and mutation markers.

## MCP tools

| Tool | Description |
| --- | --- |
| get_user | Who is signed in and the courses they can see. Use when a request is vague or you need to learn how this Ed site names its courses. Not for course details beyond id, code, name and status (same list as list_courses). Then pass a course id or code to any courseId argument. Cost: small. |
| list_courses | Enrolled courses with id, code, name and status; archived courses omitted unless includeArchived. Use when the user asks what they are enrolled in, or names a course you cannot resolve. Then use the id or the code exactly as returned as courseId. Cost: small. |
| list_lessons | Compact lesson summaries for one course: id, title, module, type, state, progress. Use when the user asks which lessons, modules or weeks exist, or what is unfinished. Call without filters first; an empty list means the course has no Ed Lessons. Filters are case-insensitive; pass all or omit a filter to include every value. courseId accepts a numeric ID or the course code exactly as Ed shows it. Then get_lesson for slides, list_lesson_files for downloads, mark_lessons_read to update progress. Cost: about 100 bytes per lesson. |
| get_lesson | One lesson with its slides and slide content. Use when the user asks what a lesson says or you need a slide id. Not for downloadable files (list_lesson_files) or quiz questions (list_slide_questions). lessonId comes from list_lessons. Cost: large for long lessons. |
| list_lesson_files | Ed-hosted downloadable files and direct resource links for one lesson, returned as resource links. Use when the user wants slides, PDFs or attachments. Not for external links inside lesson text (get_lesson). lessonId comes from list_lessons. Cost: small. |
| list_slide_questions | Quiz questions for one lesson slide with one-based choice numbers. Use when the user wants to see or answer a quiz. slideId comes from get_lesson. Then submit_slide_answer per question, then submit_slide. Cost: small. |
| list_slide_responses | Saved quiz responses for one lesson slide. Use when the user asks what they answered or whether a quiz is submitted. slideId comes from get_lesson. Cost: small. |
| list_threads | Compact thread summaries for one course: id, number, title, category, answered state. Use when the user asks what is being discussed or wants a thread by title. Categories are hierarchical: category is top-level and subcategory is second-level, spelled as Ed shows them. Sort defaults to new; Ed may keep pinned threads first. Not for thread bodies (get_thread) or the user's own posts (list_activity). courseId accepts a numeric ID or course code. Cost: about 150 bytes per thread; use limit. |
| get_thread | One thread with its answers and comments, compact. Use when the user wants what a thread says. threadId is the global id from list_threads or list_activity; for a course-local number such as #42 use get_course_thread. Cost: proportional to replies. |
| get_course_thread | One thread addressed by course and course-local number (the #N Ed shows), compact. Use when the user gives a thread number rather than a global id. courseId accepts a numeric ID or course code. Cost: as get_thread. |
| list_activity | The signed-in user's recent threads, answers and comments, optionally within one course. Use when the user asks what they posted or whether anyone replied. Not for other people's activity (list_threads). courseId is optional and accepts a numeric ID or course code. Cost: small. |
| mark_lessons_read | Mark lessons and their slides as read; writes progress. Use only when the user explicitly asks to mark lessons read or complete. queries are words that must appear in lesson or module names; no queries means every lesson in the course. courseId accepts a numeric ID or course code. Cost: one write per slide. |
| submit_slide_answer | Save one-based choices for one quiz question; writes. Use only when the user has chosen the answer. questionId comes from list_slide_questions. Then submit_slide to finalise the slide. Cost: one write. |
| submit_slide | Submit all saved answers for one quiz slide; writes and is usually final. Use only with explicit user intent after answers are saved. slideId comes from get_lesson. Cost: one write. |

## Errors

Errors are rendered exactly once on stderr. Exit codes: 0 success, 1 network/config/unexpected, 2 usage, 3 auth, 4 not found, 5 upstream, 130 cancelled.
