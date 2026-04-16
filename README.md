# edstem-cli

A terminal-first CLI for Ed Discussion: browse courses, lessons, threads, and comments without leaving the terminal.

## Features

- **Courses**: list all enrolled courses
- **Lessons**: list course lessons and inspect lesson slides
- **Lesson read automation**: read matching lessons and push their slide status forward
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

## Agent Skill

Install the agent skill with the shared `skills` CLI spec:

```bash
npx skills add https://github.com/bunizao/edstem-cli
```

If you already installed `edstem`, the CLI exposes the same thing as a thin alias:

```bash
edstem skills add
```

Install from source:

```bash
git clone https://github.com/bunizao/edstem-cli.git
cd edstem-cli
uv sync
```

## Update

Update the CLI using the same method you used to install it:

```bash
# If installed with uv tool
uv tool upgrade edstem-cli

# If installed with pipx
pipx upgrade edstem-cli
```

If you installed from source:

```bash
git pull
uv sync
```

> Running an older version? Check with `edstem --version` first. If a command in this README does not exist locally, update the CLI before trying again.

## Quick Start

Get your API token from: [https://edstem.org/settings/api-tokens](https://edstem.org/settings/api-tokens)

```bash
# View your profile and courses
edstem user

# List enrolled courses
edstem courses

# List threads in a course
edstem threads 12345

# List lessons in a course
edstem lessons 12345

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

# Lessons
edstem lessons <course_id>
edstem lessons <course_id> --module "Week 1"
edstem lessons <course_id> --type python --status attempted
edstem lesson <lesson_id>
edstem lesson <lesson_id> --json
edstem lessons read <course_id> Pre-Reading
edstem lessons read <course_id> Week 3 Workshop

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

## Mark Lessons Read

Use `lessons read` when you want the CLI to visit lessons and push their slide status forward.
Query words are matched case-insensitively against lesson titles and module names.
For non-quiz slides the CLI calls the lesson completion endpoint. For quiz slides it records a view.

```bash
# Mark all pre-reading lessons in a course as read
edstem lessons read 29579 Pre-Reading

# Mark week 1 applied/workshop content as read
edstem lessons read 29579 Week 1 Workshop
edstem lessons read 29579 Week 1 Applied

# Add a delay between slide actions
edstem lessons read 29579 Applied --delay 0.3

# Export a machine-readable summary
edstem lessons read 29579 Pre-Reading --json
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
[twitter-cli](https://github.com/jackwener/twitter-cli).  
Thanks to the original project for the foundation and inspiration.
