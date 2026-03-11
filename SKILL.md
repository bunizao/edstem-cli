---
name: edstem-cli
description: Inspect Ed Discussion from the terminal with the `edstem` CLI. Use when Codex needs to list courses, browse or filter lessons or threads in a course, open a lesson or thread by ID, inspect recent activity, or fetch the current user profile. Prefer JSON output for agent workflows.
---

# edstem-cli

Use `edstem` for read-only Ed Discussion access.

## Defaults

- Use `--json` on every command. Do not parse the rich-text table output.
- Add `--max` to list commands to keep results small.
- Use `-o <file>` when the JSON payload is too large for stdout.
- Omit `--json` only when a human explicitly wants the formatted terminal view.

## Setup

```bash
uv tool install edstem-cli
# or
pipx install edstem-cli
```

Authenticate by setting `ED_API_TOKEN` or saving the token to `~/.config/edstem-cli/token`.
Get a token from [https://edstem.org/settings/api-tokens](https://edstem.org/settings/api-tokens).

## Common Commands

```bash
# Courses
edstem courses --json
edstem courses --archived --json

# Threads
edstem threads <course_id> --max 20 --json
edstem threads <course_id> --sort top --json
edstem threads <course_id> --category "HW1" --json
edstem threads <course_id> --type question --json
edstem threads <course_id> --unanswered --json
edstem threads <course_id> --max 100 -o threads.json

# Lessons
edstem lessons <course_id> --json
edstem lessons <course_id> --module "Week 1" --json
edstem lessons <course_id> --type python --status attempted --json
edstem lessons <course_id> -o lessons.json

# Lesson detail
edstem lesson <lesson_id> --json

# Thread detail
edstem thread <thread_id> --json
edstem thread <course_id>#<number> --json

# Activity
edstem activity --max 10 --json
edstem activity <course_id> --filter answer --max 10 --json

# User
edstem user --json
```

For less common flags, check `edstem --help` and the relevant subcommand help.

## Agent Workflow

- If the user asks for lessons in a specific course and the `course_id` is already known, run `edstem lessons <course_id> --json`.
- If the user names a course but does not provide the `course_id`, run `edstem courses --json` first, resolve the course, then run `edstem lessons <course_id> --json`.
- If the user asks for one lesson's full content or slides, run `edstem lesson <lesson_id> --json`.
- Prefer filtering at the CLI, for example `edstem lessons <course_id> --module "Week 2" --json`, instead of fetching everything and filtering in prompt context.

## Failure Modes

- `Invalid or expired Ed API token`: regenerate the token and update the environment variable or token file.
- `Not found`: verify the course ID, thread ID, or `course_id#number` reference.
- `--max must be greater than 0`: pass a positive integer.

## Safety

- Treat the API token as a secret and never paste it into chat or logs.
- The CLI is read-only and does not create or modify Ed Discussion content.
