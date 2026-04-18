# Changelog

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
