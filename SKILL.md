---
name: edstem-cli
description: Inspect Ed Discussion through its CLI, local stdio MCP server, or hosted MCP server. Use for courses, lessons, threads, activity, quiz responses, and lesson progress. Prefer narrow queries and compact output.
---

# edstem-cli

Choose the narrowest surface that fits the environment:

- Use `edstem` for shell access, scripts, and deterministic automation.
- Use `edstem-mcp` when a local MCP client can launch a stdio server with `ED_API_TOKEN`.
- Use `https://edstem.tuuhub.com/mcp` when the client needs hosted Streamable HTTP and OAuth.

## Agent rules

- Run the narrowest command or tool that answers the request.
- For CLI automation, pass `--json` explicitly and add `--fields` to retain only needed top-level fields.
- List commands return summaries. Fetch one lesson or thread only when its detail is needed.
- Use `--include-html` only when raw Ed XML matters.
- Treat Ed API tokens as passwords. Never print, log, or persist them in project files.
- `lessons read`, `mark_lessons_read`, and quiz submission tools change the current user's Ed state. Require explicit user intent before calling them.

## Setup

```bash
npm install -g edstem-cli
export ED_API_TOKEN="your-token"
edstem user --fields id,name,courses
```

## CLI reference

| Command | Description | Arguments | Options |
| --- | --- | --- | --- |
| edstem user | Show the current Ed identity and enrolled courses. |  |  |
| edstem courses | List enrolled courses. |  | --archived |
| edstem threads | List threads in a course. | <course-id> | -n, --max <count><br>-s, --sort <order><br>-c, --category <category><br>-t, --type <type><br>--answered<br>--unanswered |
| edstem thread | Show a thread by ID or course_id#number. | <reference> | --md<br>--format <format><br>--include-html<br>--legacy-json |
| edstem lessons | List or update course lessons. | [course-id] | --module <module><br>--type <type><br>--state <state><br>--status <status> |
| edstem lessons list | List lessons in a course. | <course-id> | --module <module><br>--type <type><br>--state <state><br>--status <status> |
| edstem lessons read | Mark matching lessons and slides as read. | <course-id> [queries...] | --delay <seconds> |
| edstem lessons questions | List quiz questions for a slide. | <slide-id> |  |
| edstem lessons responses | List saved quiz responses for a slide. | <slide-id> |  |
| edstem lessons quiz | Inspect or answer one quiz slide. | <slide-id> | --responses<br>--answer <question-id><br>--choice <number><br>--submit<br>--amend |
| edstem lesson | Show a lesson and its slides. | <lesson-id> | --md<br>--format <format> |
| edstem activity | List current-user activity. | [course-id] | -n, --max <count><br>-f, --filter <type> |
| edstem update | Check for an npm update or apply it. |  | --apply |
| edstem skills | Show, generate, or install the agent skill. |  |  |
| edstem skills generate | Regenerate SKILL.md from CLI and MCP metadata. |  |  |
| edstem skills add | Install the skill through the shared skills CLI. |  |  |

Global output options: `--json`, `--pretty`, `--fields a,b`, and `--output FILE`.

## MCP tools

| Tool | Description |
| --- | --- |
| get_user | Get the current Ed identity and enrolled courses. |
| list_courses | List enrolled courses; archived courses are omitted by default. |
| list_lessons | List compact lesson summaries for one course. |
| get_lesson | Get one lesson with slide content. |
| list_slide_questions | List quiz questions for one lesson slide. |
| list_slide_responses | List saved quiz responses for one lesson slide. |
| list_threads | List compact thread summaries for one course. |
| get_thread | Get a compact thread detail by global thread ID. |
| get_course_thread | Get a compact thread detail by course ID and course-local number. |
| list_activity | List compact current-user activity, optionally for one course. |
| mark_lessons_read | Mark matching lessons and slides as read for the current Ed user. |
| submit_slide_answer | Submit one-based quiz choices for one question. |
| submit_slide | Submit all saved answers for one quiz slide. |

## Errors

CLI failures are one compact JSON line on stderr with `error.code` and `error.message`. Exit codes: 0 success, 1 unexpected, 2 input/config, 3 auth, 4 not found, 5 upstream.
