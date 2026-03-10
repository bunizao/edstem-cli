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

## Authentication

edstem-cli uses this auth priority:

1. **Environment variable**: `ED_API_TOKEN`
2. **Token file**: `~/.config/edstem-cli/token`
3. **Interactive prompt**: asks for token and saves to file

Get your API token from: https://edstem.org/us/settings/api-tokens

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

## Release

Push a version tag such as `v0.1.0` to trigger the release workflows.

- `CI` runs lint, tests, and package validation
- `Publish GitHub Release` creates a GitHub release and uploads the wheel and sdist
- `Publish to PyPI` uploads the package to PyPI through trusted publishing

## Acknowledgements

This project builds on ideas and structure from
[`twitter-cli`](https://github.com/jackwener/twitter-cli).
Thanks to the original project for the foundation and inspiration.

## Project Structure

```text
edstem_cli/
├── __init__.py
├── cli.py
├── client.py
├── auth.py
├── config.py
├── constants.py
├── filter.py
├── formatter.py
├── serialization.py
└── models.py
```
