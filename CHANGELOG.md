# Changelog

## 0.7.2 - 2026-09-24

### Fixed

- `--max` is accepted again as a hidden alias for `--limit` on `threads` and `activity`, so scripts written before 0.7.1 keep working.

## 0.7.1 - 2026-09-24

### Added

- Added four experimental MCP Apps views: `show_forum_catchup`, `show_thread_activity`, `show_lesson_progress` and `show_lesson_guide`, plus the `teach_lesson` prompt. Hosts without MCP Apps get the text content; `EDSTEM_WIDGETS=0` removes the tools from the stdio server.
- Added thread read state: an `unseen` flag and `newReplyCount`.
- `--verbose` now traces Ed requests and their timings to stderr.

### Changed

- Units resolve against the site's own list in tiers (exact code, leading code token, exact name, substring); an unmatched unit exits 4 and lists the site's units.
- List tables show identifying columns and fit the terminal width; JSON is compact when stdout is not a terminal.
- `edstem activity` projects `courseId`, `createdAt` and a flat row shape instead of Ed's raw keys.
- Rewrote the skill and every MCP tool description around user intent, with institution-neutral wording.

### Compatibility notes

- `--max` is now `--limit`; `-n` is unchanged. 0.7.2 accepts `--max` again as a hidden alias.
- `edstem activity` output keys changed, and an unknown unit exits 4 instead of 2.

## 0.7.0 - 2026-09-20

### Added

- Added styled help pages with a root wordmark, `gh`-style command groups (core, additional, agent), cyan flags, and a short "Try" list.
- Added first-run onboarding: a terminal session with no saved token is shown where to create one, reads it hidden, verifies it with Ed and saves it.
- Added prompts for what a person left out: a unit picker for `threads send`, an `$EDITOR` body, and a list for ambiguous units.
- Added colour roles for tables and mutation plans: keys, the thing being posted, its destination, and status-like words each get a tone.

### Changed

- `edstem auth login` reads the token through the shared hidden prompt.
- Per-command output flags are hidden from help pages; the root names them once. Commands carry short summaries in listings.

### Compatibility notes

- Prompts and colour only appear when stdin and stdout are terminals, the output is a table, and none of `CLI_AGENT`, `CLAUDECODE` or `CI` is set. Pipes, `--json`, `--output` and `NO_COLOR` keep the previous plain behaviour.

## 0.6.0 - 2026-09-20

### Added

- Added `edstem threads send` and `edstem replies send`, which convert a Markdown body into Ed's document format before posting.
- Added the gated MCP tools `create_thread` and `reply_thread`, disabled unless `EDSTEM_ALLOW_POSTING=1` is set for the stdio server or `MCP_ALLOW_POSTING=1` for the Worker.
- Added `edstem auth login` and `edstem auth logout`, which verify a token before writing the `0600` token file, remove it idempotently, and warn when `EDSTEM_TOKEN` shadows it.
- Added the Markdown read verbs `edstem lessons read` and `edstem slides read`, plus the MCP tools `read_thread`, `read_lesson`, `read_slide`, and `get_slide`.
- Added `edstem threads search` and the `search_threads` MCP tool, along with `--offset` and `--since`, which accepts an ISO date, an ISO datetime, or a relative offset such as `7d`.
- Added thread attachment support: `edstem files list` and `edstem files get` accept `thread:<id>` and `thread:<unit>#<number>` targets, and the `list_thread_files` MCP tool lists them.
- Added the `list_modules` MCP tool and the `triage_unanswered` prompt, and gave every MCP tool a title and per-field input descriptions.
- Restored `edstem update`, which reports the registry version and upgrades when one is available without requiring a token.
- Added retry with exponential backoff and an honored `Retry-After` header for rate-limited reads, configured by the `rateLimit` block in `config.yaml`. Writes are never retried.

### Changed

- Made filtered thread listings walk pages until enough threads match, so `--max` is honest for filters Ed does not apply server-side.
- Made `edstem slides show` return the projected slide instead of Ed's raw payload, matching every other projection.
- Cached verified Ed tokens in the Worker isolate for five minutes, keyed by token digest and bounded to 1000 entries, overridable with `MCP_TOKEN_CACHE_TTL_SECONDS`.
- Memoized the identity lookup for 60 seconds so a command and the course resolution before it share one `/api/user` request.

### Fixed

- Required an explicit selection for `lessons mark-read` and `mark_lessons_read`, which previously matched every lesson in a unit when no query was given.
- Required at least one choice for `submit_slide_answer`, which previously posted an empty selection.
- Named the offending argument in validation errors instead of reporting a bare value.
- Handled `--help` and `--version` in `edstem-mcp` before starting the stdio server, so neither hangs in a terminal.
- Honored `--dry-run` in `auth login` instead of contacting Ed and overwriting the saved token.
- Ignored pinned threads when deciding where a `--since` walk stops, and shared the `offset` field between `search_threads` and `list_threads`.
- Preserved link targets through emphasis and rejected unbalanced link URLs when converting Markdown bodies.
- Verified reply targets belong to the thread being replied to.

### Compatibility notes

- `edstem slides show` now returns the projected slide shape rather than Ed's raw payload.
- `lessons mark-read` and `mark_lessons_read` now fail without a query or `--all`/`all`.
- `submit_slide_answer` now fails without at least one choice.

## 0.5.0 - 2026-08-25

### Added

- Added a stateless Cloudflare Worker MCP transport with Bearer and API-key authentication.
- Added safe listing and local downloading for Ed-hosted lesson files and PDF slides.
- Added direct course-code resolution across CLI and MCP commands.
- Added module-name, lesson state/status/type, and hierarchical thread-category filters.

### Changed

- Normalized the CLI around plural nouns, explicit verbs, machine-readable command metadata, and shared output/error behavior from `@bunizao/cli-kit`.
- Made ambiguous course codes fail with enrolment details instead of selecting an arbitrary course.
- Made lesson filters report the values available in the selected course.

### Fixed

- Preserved slide associations when lesson files share a URL.
- Rejected redirects, external hosts, lookalike domains, unsafe response filenames, and accidental download overwrites.
- Preserved not-found errors for unknown numeric unit IDs.
- Excluded Worker-only sources from the production Docker image build.
- Updated vulnerable transitive URL, HTTP, and address-parsing dependencies.

### Compatibility notes

- The legacy singular command grammar has been replaced by the normalized plural noun and verb grammar. Run `edstem commands --json` to inspect the current command tree.

## 0.4.0 - 2026-07-13

### Changed

- Rewrote the CLI with TypeScript 7 and switched distribution from PyPI to npm.
- Merged the local stdio MCP and hosted OAuth MCP runtimes into this repository.
- Replaced duplicated Ed clients and token verification with one shared implementation.
- Made compact JSON the default and added top-level field selection with `--fields`.

### Added

- Added the `edstem-mcp` stdio executable and 13 MCP tools.
- Added Node package smoke tests plus Bun OAuth, SQLite, security, and reconnect tests.
- Added generated agent-skill metadata for CLI commands and MCP tools.

## 0.3.6 - 2026-05-15

### Added

- Added Markdown export for `edstem lesson` and `edstem thread` with `--md`, `--format md`, and `-o <file>` support.
- Preserved quiz slide `passage` text in lesson exports when Ed stores the readable body outside `content`.

### Fixed

- Preserved literal angle brackets in Markdown exports, including comparison text such as `x < y` and generic-looking text such as `Array<T>`.

## 0.3.5 - 2026-04-27

### Highlights

- Switched `edstem thread <ref> --json` to a compact thread JSON shape that keeps source-grounded reply content while removing redundant structure and surfacing endorsed and staff signals.

### Changed

- Compact thread JSON now hoists users, omits default false/zero/empty fields, trims timestamp fractions, and keeps XML `content` behind `--include-html` instead of carrying it by default.
- On a corpus of 39 real thread dumps measured with `tiktoken` `o200k_base`, compact thread JSON reduced total payload from 74,364 tokens to 28,466 tokens, saving 45,898 tokens overall (`-61.72%`).
- On the same sample set, the mean savings were 1,176.87 tokens per thread (`-55.88%` on average), with a median savings of 397 tokens per thread (`-54.61%`).
- Representative samples from the same corpus ranged from `8,973 -> 2,852` tokens (`-68.22%`) on a large thread to `518 -> 254` tokens (`-50.97%`) on a small thread.

## 0.3.1 - 2026-04-18

### Highlights

- Added `edstem update` to upgrade the installed CLI in place.

### Added

- `edstem update` now detects common install methods and runs the updater directly.

### Changed

- `edstem update` no longer prints a shell command for manual execution.

### Safety

- Source installs are refused by the updater so local checkouts stay local.

## 0.3.0 - 2026-04-16

### Highlights

- Added lesson automation commands for marking matching lessons as read without leaving the terminal.
- Added quiz-slide workflows for listing questions, checking saved responses, answering questions, and submitting a slide.
- Switched skill installation to the shared `vercel-labs/skills` flow through `npx skills add`, with an `npm exec` fallback when `npx` is unavailable.

### Added

- `edstem lessons read <course_id> [query...]` to visit matching lessons and advance slide status.
- `edstem lessons quiz <slide_id>` to inspect quiz questions from the CLI.
- `edstem lessons quiz <slide_id> --responses` to inspect saved responses.
- `edstem lessons quiz <slide_id> --answer <question_id> --choice <n>` to submit answers.
- `edstem lessons quiz <slide_id> --submit` to submit all saved responses for a quiz slide.
- `edstem skills add` as a thin alias for `npx skills add https://github.com/bunizao/edstem-cli`.

### Changed

- `edstem lessons` now preserves legacy flag ordering such as `edstem lessons --json <course_id>` and `edstem lessons --module Week 1 <course_id>`.
- `edstem lessons read` now reports partial progress when a later slide fails instead of pretending nothing changed.
- Skill installation now follows the shared skills spec instead of writing directly into a Codex-only directory.
- `edstem skills add` now falls back to `npm exec --yes -- skills add ...` when `npx` is missing.

### Release

- GitHub Actions release automation now builds the package, publishes it to PyPI, and creates the GitHub Release from this changelog section.

## 0.2.0 - 2026-03-12

### Highlights

- Added `lessons` and `lesson` commands for listing course lessons and fetching lesson detail.
- Reduced lesson JSON payload size by omitting empty, default, and caller-known fields in agent-oriented output.
- On a real `edstem lessons 29579 --json` sample with 22 lessons, the compact lesson JSON shape reduced payload size from 14,367 to 8,281 characters, which translates to roughly 42% lower token usage for agent and LLM workflows.
- Expanded `SKILL.md` with explicit lesson lookup workflows for agent usage.

### Added

- `edstem lessons <course_id> --json` to list lessons in a course.
- Lesson filters for `--module`, `--type`, `--state`, and `--status`.
- `edstem lesson <lesson_id> --json` to inspect a single lesson and its slides.

### Changed

- Lesson JSON output is now more compact by default.
- Agent-facing lesson JSON now uses about 42% fewer tokens on a real course sample after removing empty and default fields.
- `courseId` is no longer emitted in lesson JSON output.
- `number` is omitted when Ed returns the placeholder value `-1`.
- Empty arrays such as `slides: []` are omitted.
- Empty string fields such as `outline`, `dueAt`, `lockedAt`, and `updatedAt` are omitted.
- Boolean fields that are `false` by default, such as `openableWithoutAttempt`, `isHidden`, `isUnlisted`, and `isTimed`, are omitted.

### Documentation

- Added agent-facing examples for course lesson lookup and lesson detail lookup in `SKILL.md`.

### Compatibility notes

- This release changes the shape of lesson JSON output. Consumers should treat omitted lesson fields as equivalent to empty string, empty list, `false`, or the placeholder lesson number `-1`, depending on field type.
