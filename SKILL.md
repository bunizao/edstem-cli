---
name: edstem-cli
description: Inspect Ed Discussion through its CLI, local stdio MCP server, or hosted MCP server. Use for units, lessons, threads, activity, quiz responses, and lesson progress. Prefer narrow queries and compact output.
---

# edstem-cli

Choose the narrowest surface that fits the environment:

- Use `edstem` for shell access, scripts, and deterministic automation.
- Use `edstem-mcp` when a local MCP client can launch a stdio server with `EDSTEM_TOKEN`.
- Use `https://edstem.tuuhub.com/mcp` when the client needs hosted Streamable HTTP and OAuth.

## Agent rules

- Treat `edstem commands --json` as the source of truth for this tool's command tree; the published `@bunizao/cli-kit` npm package (`^0.1.0`) defines the shared CLI contract.
- Run the narrowest command or tool that answers the request.
- Successful piped output is JSON by default. Use `--fields` to retain only needed top-level fields.
- Use `--json`, `--yaml`, or `--table` only when overriding TTY-based format selection.
- Use the `read` verb only for Markdown output. It never mutates upstream state.
- Commands marked as mutating require explicit user intent and either an interactive confirmation or `--yes`.
- Use `--dry-run` to inspect a mutation plan without changing Ed state.
- Treat Ed API tokens as passwords. Never print, log, or persist them in project files.

## Setup

```bash
npm install -g edstem-cli
export EDSTEM_TOKEN="your-token"
edstem units --fields id,code,name
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
| edstem files | List or download lesson files. |  |  | no |
| edstem files list | List downloadable files in one lesson. | <lesson> |  | no |
| edstem files get | Download files from one lesson. | <lesson> | --dest <directory><br>--slide <slide><br>--force | no |
| edstem activity | List current-user activity. | [unit] | -n, --max <count><br>-f, --filter <type> | no |
| edstem commands | Describe the complete command tree. |  |  | no |
| edstem skills | Generate the agent skill. |  |  | no |
| edstem skills generate | Regenerate SKILL.md from command metadata. |  |  | no |

Global options: `--json`, `--yaml`, `--table`, `--fields a,b`, `--output FILE`, `--quiet`, `--verbose`, `--no-color`, `--yes`, and `--dry-run`.

Run `edstem commands --json` for machine-readable metadata, including aliases, enum values, and mutation markers.

## MCP tools

| Tool | Description |
| --- | --- |
| get_user | Get the current Ed identity and enrolled courses. |
| list_courses | List enrolled courses; archived courses are omitted by default. |
| list_lessons | List compact lesson summaries for one course. courseId accepts a numeric ID or course code. Call without filters first: an empty list means the course has no Ed Lessons. Filters are case-insensitive; use all or omit a filter to include every value. |
| get_lesson | Get one lesson with slide content. |
| list_lesson_files | List downloadable files and direct resource links for one lesson. |
| list_slide_questions | List quiz questions for one lesson slide. |
| list_slide_responses | List saved quiz responses for one lesson slide. |
| list_threads | List compact thread summaries for one course. courseId accepts a numeric ID or course code. Categories are hierarchical: category is top-level and subcategory is second-level. Sort defaults to new; Ed may keep pinned threads first. |
| get_thread | Get a compact thread detail by global thread ID. |
| get_course_thread | Get a compact thread detail by course ID or code and course-local number. |
| list_activity | List compact current-user activity, optionally filtered by course ID or code. |
| mark_lessons_read | Mark matching lessons and slides as read using a course ID or code. |
| submit_slide_answer | Submit one-based quiz choices for one question. |
| submit_slide | Submit all saved answers for one quiz slide. |

## Errors

Errors are rendered exactly once on stderr. Exit codes: 0 success, 1 network/config/unexpected, 2 usage, 3 auth, 4 not found, 5 upstream, 130 cancelled.
