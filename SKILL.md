---
name: edstem-cli
description: CLI skill for Ed Discussion with JSON output for AI agents — browse courses, threads, and comments from the terminal
author: bunizao
version: "1.0.0"
tags:
  - edstem
  - ed
  - discussion
  - education
  - cli
---

# edstem-cli Skill

Use this skill when the user wants to browse Ed Discussion courses, threads, and comments from terminal.

## Agent Defaults

When you need machine-readable output:

1. **Always use `--json`** for structured output. Do not parse the default rich-text table output.
2. Use `--max` to keep result sets small and token-efficient.
3. Use `-o <file>` to save large results to a file instead of printing to stdout.

## Prerequisites

```bash
# Install (requires Python 3.8+)
uv tool install edstem-cli
# Or: pipx install edstem-cli
```

## Authentication

- Set environment variable: `ED_API_TOKEN`
- Or save token to `~/.config/edstem-cli/token`
- Get token from: https://edstem.org/us/settings/api-tokens

## Command Reference

### Courses

```bash
edstem courses                         # List enrolled courses
edstem courses --json                  # JSON output
```

### Threads

```bash
edstem threads <course_id>             # List threads
edstem threads <course_id> --sort top  # Sort by votes
edstem threads <course_id> --category "HW1"  # Filter by category
edstem threads <course_id> --type question   # Filter by type
edstem threads <course_id> --unanswered      # Only unanswered
edstem threads <course_id> --max 50 --json   # Limit + JSON
edstem threads <course_id> -o threads.json   # Save to file
```

### Thread Detail

```bash
edstem thread <thread_id>              # View thread + comments
edstem thread <course_id>#<number>     # By course thread number
edstem thread <thread_id> --json       # JSON output
```

### Activity

```bash
edstem activity                        # Your activity (all courses)
edstem activity <course_id>            # Activity in a course
edstem activity --filter answer --json # Filter + JSON
```

### User

```bash
edstem user                            # Current user profile
edstem user --json                     # JSON output
```

## Structured Output

All commands support `--json` for machine-readable output.
AI agents should **always use `--json`**:

```bash
edstem courses --json
edstem threads 12345 --json | jq '.[0].title'
edstem thread 67890 --json | jq '.answers'
```

## Common Patterns for AI Agents

```bash
# Get all courses
edstem courses --json

# Get recent threads in a course
edstem threads 12345 --max 10 --json

# View a specific thread with answers
edstem thread 67890 --json

# Check unanswered questions
edstem threads 12345 --unanswered --json

# Get your recent activity
edstem activity --max 10 --json
```

## Error Handling

- `Invalid or expired Ed API token` — regenerate at https://edstem.org/us/settings/api-tokens
- `Not found` — check that the course/thread ID is correct
- Auth errors (401/403) — token may have expired, regenerate it

## Safety Notes

- API tokens are stored locally at `~/.config/edstem-cli/token` with 600 permissions.
- Do not ask users to share API tokens in chat logs.
- This is a read-only CLI — no write operations are supported.
