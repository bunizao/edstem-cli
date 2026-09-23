# edstem-cli

CLI and MCP access to Ed Discussion for people, scripts, and agents.

[![npm version](https://img.shields.io/npm/v/edstem-cli?logo=npm)](https://www.npmjs.com/package/edstem-cli)
[![CI](https://github.com/bunizao/edstem-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/bunizao/edstem-cli/actions/workflows/ci.yml)
[![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Install

```bash
npm install -g edstem-cli

# Recommended: verify a token once and save it to ~/.config/edstem-cli/token.
edstem auth login

# Or, for scripts and CI:
export EDSTEM_TOKEN="your-token"

edstem auth status
```

Create a token at [edstem.org/settings/api-tokens](https://edstem.org/settings/api-tokens). `edstem auth login` prompts for the token without echoing it, or reads it from stdin with `--token-stdin`; it verifies the token before writing `~/.config/edstem-cli/token` with `0600` permissions. `edstem auth logout` removes that file, and `edstem auth status` reports whether the active token came from the environment or the file. `EDSTEM_TOKEN` always takes precedence over the saved file. The CLI also reads `~/.config/edstem-cli/config.yaml`.

```bash
printf '%s\n' "your-token" | edstem auth login --token-stdin
edstem auth logout --yes
```

Run `edstem update --check` to compare the installed version against npm, or `edstem update --yes` to install the latest release.

## Command model

Commands follow `edstem <plural-noun> [verb] [scope] [id] [flags]`. The canonical enrolment noun is `units`; `courses` and `projects` are equivalent aliases.

```bash
edstem units
edstem courses UNIT
edstem threads 12345 --limit 20 --fields id,number,title
edstem threads search 12345 assignment deadline
edstem threads show 12345#42
edstem threads show UNIT#42
edstem threads read 12345#42
edstem lessons 12345 --module "Week 2"
edstem lessons show 67890
edstem lessons read 67890
```

Every `<unit>` argument (`UNIT` above) accepts either the numeric Ed course ID or the course code exactly as Ed shows it; run `edstem units` to see both. The CLI never assumes what a code looks like. MCP tools use the same rule for `courseId`, so a code can be passed directly without a preceding `list_courses` lookup. If multiple enrolments share a code, use the numeric ID shown by `edstem units --archived` to select the intended year and session.

Lesson filters are case-insensitive. `--module` accepts an ID or part of a module name; `--type`, `--state`, and `--status` use exact values. Common lesson values are `general`, `active` or `scheduled`, and `unattempted`, `attempted`, or `completed`. Pass `all` or omit a filter to include every value. If an unfiltered lesson list is empty, that unit has no Ed Lessons; an invalid filter reports the values available in that unit.

Thread categories are hierarchical: `--category` matches the top level and `--subcategory` matches the second level. Thread sorting defaults to `new`; Ed may keep pinned threads first regardless of the selected order.

Ed applies none of these filters itself, so `--limit` is honoured by paging through Ed until enough threads match, up to ten requests. `--offset` skips threads at the start of the unfiltered Ed stream. `--since` keeps threads created at or after an ISO date, an ISO datetime, or a relative offset such as `7d`, `12h`, or `2w`. `threads search` matches every query word, case-insensitively, against the thread title and body, and accepts the same filters as `threads list`.

```bash
edstem threads 12345 --category "<top-level category>" --subcategory "<second-level>"
edstem threads 12345 --unanswered --since 7d --limit 20
edstem threads search 12345 assignment deadline --since 2026-09-01
edstem lessons 12345 --module "<part of a module name>" --status all
```

Omitted verbs are inferred when the arguments are unambiguous. `read` always emits Markdown and never changes upstream state; it is available for threads, lessons, and slides.

Lesson files include PDF slides stored in Ed's `file_url` field and Ed-hosted files embedded in lesson content. List them without downloading, or download all files to a directory. External links remain visible in lesson content but are not presented as downloadable files. Existing files are protected unless `--force` is supplied.

A target is a lesson ID, or a thread prefixed with `thread:`. Thread targets collect the attachments in the thread body, its answers, and every nested comment; `--slide` applies to lesson targets only.

```bash
edstem files list 67890
edstem files get 67890 --dest ./slides
edstem files get 67890 --slide 4401 --dest ./slides
edstem files list thread:5001
edstem files get thread:UNIT#42 --dest ./attachments
```

Slide facets use one read-only command so the verb vocabulary stays consistent:

```bash
edstem slides show 4401
edstem slides show 4401 --section questions
edstem slides show 4401 --section responses
edstem slides read 4401
```

## Mutations

Mutations are visible in help, print a plan, and prompt with `y/N` in an interactive terminal. Non-interactive callers must pass `--yes`. `--dry-run` prints the plan without sending a write request.

In a terminal, a command missing its unit asks for it with a picker (`edstem threads` lists your units), and `threads send` asks for `--title` and opens `$EDITOR` for the body. Pipes, `--json` and agent shells get the usage error with the usage line instead.

```bash
edstem lessons mark-read 12345 Pre-Reading --dry-run
edstem lessons mark-read 12345 Pre-Reading --yes

# Marking the whole unit needs --all; queries alone never match everything.
edstem lessons mark-read 12345 --all --yes

# Save one answer, then submit all saved answers for the slide.
edstem slides submit 4401 --question 991 --choice 2 --yes
edstem slides submit 4401 --yes
```

### Posting

Posting request and response formats have been checked with mocked Ed responses only; they have not been verified against the live Ed API. `--dry-run` previews the generated document and plan, but does not validate the live API contract.

Posting publishes to the unit forum under your own name and cannot be undone from this tool. Review the plan first with `--dry-run`, which also prints the Ed XML that will be sent.

```bash
edstem threads send 12345 --title "Week 3 sample solution" --body "Does **Q4** need induction?" --dry-run
edstem threads send UNIT --title "Week 3 sample solution" --body-file ./post.md --type question --category "<top-level category>" --yes
edstem replies send 12345#42 --body "Fixed by reinstalling." --yes
edstem replies send 12345#42 --to 88991 --as comment --body-file - --yes
```

The body is Markdown and is converted to Ed's document format: paragraphs, headings, fenced code, inline code, bold, italic, links, and bullet or numbered lists. `--body-file -` reads the body from stdin; with neither flag, a terminal opens `$EDITOR`. `--as` defaults to `answer` on question threads and `comment` elsewhere; `--private` posts to staff only and `--anonymous` hides your name from other students.

The MCP tools `create_thread` and `reply_thread` are disabled by default. Set `EDSTEM_ALLOW_POSTING=1` for the stdio server, or the Worker variable `MCP_ALLOW_POSTING=1`, to enable them.

## Output and errors

Successful output is a table when stdout is a terminal and JSON when stdout is piped or redirected. Override this with `--json`, `--yaml`, or `--table`; select fields with `--fields a,b`; write to a file with `--output FILE`.

Errors are rendered exactly once on stderr. Usage failures exit 2, authentication failures exit 3, missing entities exit 4, upstream rejections exit 5, and cancellation exits 130.

Run `edstem commands --json` for the full machine-readable command tree, including aliases, positionals, enum values, and mutation markers.

## Environment

| Variable | Purpose |
| --- | --- |
| `EDSTEM_BASE_URL` | Override the Ed JSON API base URL. |
| `EDSTEM_TOKEN` | Provide the Ed API token. |
| `EDSTEM_CONFIG` | Override the local config file path. |
| `EDSTEM_ALLOW_POSTING` | Set to `1` to enable the `edstem-mcp` posting tools. |
| `EDSTEM_WIDGETS` | Set to `0` to drop the interactive `show_*` tools from `edstem-mcp`. |

`config.yaml` also tunes read retries: `rateLimit.maxRetries` (default `3`) caps how many times a rate-limited or temporarily failing GET is retried, and `rateLimit.retryBaseDelay` (seconds, default `1.0`) sets the exponential backoff base. A longer `Retry-After` header wins. Writes are never retried.

## MCP

The package also installs `edstem-mcp`, a local stdio MCP server using the same `EDSTEM_TOKEN`. A hosted Streamable HTTP server is available at `https://edstem.tuuhub.com/mcp` and uses OAuth.

The remote runtime supports MCP `2026-07-28`, including stateless `server/discover`, header-based routing, and results with `resultType`. It also keeps a stateless compatibility lane for 2025 Streamable HTTP clients during migration.

The read-only `list_lesson_files` and `list_thread_files` tools return compact file metadata plus MCP resource links. Remote MCP servers cannot write to a client's local path, so clients can follow those links while the CLI's `files get` command handles direct filesystem downloads.

### Interactive views

In hosts that support [MCP Apps](https://github.com/modelcontextprotocol/ext-apps) (Claude and ChatGPT among them), four tools render an interactive view in the chat instead of a wall of text:

| Tool | Shows |
| --- | --- |
| `show_forum_catchup` | Unread announcements and threads that are new to you or have new replies, each expandable in place. |
| `show_thread_activity` | New threads per week, stacked by category, with each week expandable to its busiest threads. |
| `show_lesson_progress` | Completed lessons per released module, with what is left on click. |
| `show_lesson_guide` | A step-through guide the assistant writes for one lesson, then a short practice quiz graded in place. The lesson's own Ed quiz is never answered. |

Views are the default. Ask for a plain-text answer and the assistant uses the `list_*` and `read_*` tools instead; hosts without MCP Apps get the same data as text; and `EDSTEM_WIDGETS=0` removes the `show_*` tools from the stdio server. The `teach_lesson` prompt runs the lesson guide end to end.

```json
{
  "mcpServers": {
    "edstem": {
      "command": "edstem-mcp",
      "env": {
        "EDSTEM_TOKEN": "your-token"
      }
    }
  }
}
```

### Cloudflare Worker

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/bunizao/edstem-cli)

The button copies this repository to your Git provider and deploys `src/worker.ts`. The Worker uses no database, storage binding, or protocol session. Clients send an Ed access token or API key with each request; the Worker validates the credential without storing it. The hosted OAuth service stores the Ed token encrypted with AES-256-GCM instead. Verified tokens are cached in memory for five minutes per isolate, so repeated calls skip the extra Ed verification round-trip; set `MCP_TOKEN_CACHE_TTL_SECONDS=0` to disable it.

After deployment, the endpoints are:

```text
https://<worker-host>/mcp
https://<worker-host>/healthz
```

See the [MCP setup guide](MCP_SETUP.md) for manual deployment, credential-storage details, Worker configuration, and connection steps for ChatGPT web, Codex, and Claude connectors.

## Agent skill

```bash
npx skills add https://github.com/bunizao/edstem-cli
edstem skills generate
```

The tracked [SKILL.md](SKILL.md) is generated from `edstem commands --json` plus the MCP tool catalog. CI rejects drift. The shared CLI contract comes from the published `@bunizao/cli-kit` npm package (`^0.1.0`).

## License

[MIT](LICENSE). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for migrated remote MCP attribution.
