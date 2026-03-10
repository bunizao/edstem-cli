# edstem-cli

A terminal-first CLI for Ed Discussion: browse courses, threads, and comments without leaving the terminal.

## Features

- **Courses**: list all enrolled courses
- **Threads**: list, filter, and sort course threads
- **Thread detail**: view full thread with answers and comment tree
- **Activity**: browse your activity across courses
- **User profile**: view current user info
- **JSON output**: export any data for scripting and AI agent integration

> **AI Agent Tip:** Always use `--json` for structured output instead of parsing the default rich-text display. Use `--max` to limit results.

## Installation

```bash
# Recommended: uv tool (fast, isolated)
uv tool install edstem-cli

# Alternative: pipx
pipx install edstem-cli
```

Install from source:

```bash
git clone https://github.com/bunizao/edstem-cli.git
cd edstem-cli
uv sync
```

## Quick Start

Get your API token from: [https://edstem.org/settings/api-tokens](https://edstem.org/settings/api-tokens)

```bash
# View your profile and courses
edstem user

# List enrolled courses
edstem courses

# List threads in a course
edstem threads 12345

# View a thread with comments
edstem thread 67890
```

## Usage

```bash
# Courses
edstem courses
edstem courses --archived
edstem courses --json

# Threads
edstem threads <course_id>
edstem threads <course_id> --sort top
edstem threads <course_id> --category "HW1"
edstem threads <course_id> --type question
edstem threads <course_id> --unanswered
edstem threads <course_id> --max 50 --json

# Thread detail
edstem thread <thread_id>
edstem thread <course_id>#<number>      # by course thread number
edstem thread <thread_id> --json

# Activity
edstem activity                          # all courses
edstem activity <course_id>              # specific course
edstem activity --filter answer --json

# User
edstem user
edstem user --json
```

```bash
# Option 1: Environment variable
export ED_API_TOKEN="your-token-here"

# Option 2: Will prompt on first use and save automatically
edstem user
```

## Configuration

Create `config.yaml` in your working directory:

```yaml
fetch:
  count: 30

rateLimit:
  requestDelay: 1.0
  maxRetries: 3
  retryBaseDelay: 3.0
  maxCount: 100
```

- `fetch.count` is the default item count when `--max` is omitted

## Development

```bash
# Install dev dependencies
uv sync --extra dev

# Lint + tests
uv run ruff check .
uv run pytest -q
```

## Acknowledgements

This project builds on ideas and structure from  
earlier `edstem-cli` iterations.  
Thanks to the original project foundation and subsequent refactors.
