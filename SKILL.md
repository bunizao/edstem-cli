---
name: edstem-cli
description: Inspect Ed Discussion from the terminal with the `edstem` CLI. Use when an agent needs to list courses, browse or filter lessons or threads in a course, open a lesson or thread by ID, inspect recent activity, fetch the current user profile, or mark lessons as read. Prefer JSON output for agent workflows.
---

# edstem-cli

Use `edstem` for Ed Discussion access from the terminal.

## Defaults

- Use `--json` on every command. Do not parse the rich-text table output.
- Add `--max` to list commands to keep results small.
- Use `-o <file>` when the JSON payload is too large for stdout.
- Omit `--json` only when a human explicitly wants the formatted terminal view.
- Use `edstem lessons read ... --json` when you need a machine-readable summary of which lessons were updated.

## Setup

```bash
npx skills add https://github.com/bunizao/edstem-cli

# or install the CLI alias first
uv tool install edstem-cli
edstem skills add

# other Python install options
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
edstem lessons list <course_id> --json
edstem lessons <course_id> --module "Week 1" --json
edstem lessons <course_id> --type python --status attempted --json
edstem lessons <course_id> -o lessons.json
edstem lessons read <course_id> Pre-Reading --json
edstem lessons read <course_id> Week 3 Workshop --delay 0.3 --json

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
- If the user wants lessons marked as read, use `edstem lessons read <course_id> [query...] --json` and let the CLI handle the slide actions.

## Failure Modes

- `Invalid or expired Ed API token`: regenerate the token and update the environment variable or token file.
- `Not found`: verify the course ID, thread ID, or `course_id#number` reference.
- `--max must be greater than 0`: pass a positive integer.
- `--delay must be greater than or equal to 0`: pass a non-negative delay.
- `Must complete all prereqs`: some lessons cannot be marked read until Ed unlocks their prerequisites.

## Safety

- Treat the API token as a secret and never paste it into chat or logs.
- `edstem lessons read` updates lesson and slide read state for the current user. It does not post threads or modify course content.
