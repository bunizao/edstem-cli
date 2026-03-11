# Changelog

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
