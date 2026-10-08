# Thread actions, export, and the since cursor

Three thread features ship as verified vertical slices: per-thread actions, a per-unit `--since last` cursor, and a Markdown export of a unit's forum.

## Milestones

1. [x] **Thread state**: parse `is_starred`, `is_watched`, and `vote`; add the generic thread action client.
2. [x] **Thread actions**: `threads star|unstar|watch|unwatch|upvote|unvote|mark-read|mark-unread`.
3. [x] **Unread filter**: `threads --unread`.
4. [x] **Since cursor**: `threads --since last`.
5. [x] **Export**: `threads export`.
6. [x] **Docs**: README, CONTEXT, and a regenerated `SKILL.md`.

## Ed endpoints

Read from Ed's web client bundle; none are documented by Ed.

| Action | Request |
| --- | --- |
| Star | `POST threads/{id}/star`, `POST threads/{id}/unstar`; no body |
| Vote | `POST threads/{id}/upvote`, `POST threads/{id}/unvote`; comments use `comments/{id}/…` |
| Watch | `POST threads/{id}/watch` with `{ "state": … }` |
| Read state | `POST threads/{id}/read`, `POST threads/{id}/unread` |
| Read a unit | `POST courses/{courseId}/threads/read_all` |

The thread payload carries `is_starred`, `is_watched` (`true`, `false`, or `null` for the course default), and `vote`.

The current Ed web client sends boolean `state` values (`true` to watch, `false` to unwatch). Verify them with one live call before milestone 2 ships. Ed also exposes `downvote`, but students usually cannot use it, so the CLI leaves it out.

## Thread actions

```bash
edstem threads star UNIT#42
edstem threads unwatch UNIT#42
edstem threads upvote UNIT#42 --comment 88991
edstem threads mark-read UNIT#42
edstem threads mark-read UNIT --all
```

- Paired verbs match Ed's own names and the existing `lessons mark-read`.
- Every action is a mutation: it prints a plan, prompts `y/N` in a terminal, needs `--yes` elsewhere, and honours `--dry-run`.
- The plan phase already fetches the thread through `resolveThread`. If the thread is already in the requested state, the command reports that and sends no write.
- `--comment` reuses `assertCommentInThread`, so a comment from another thread is rejected before any write.
- `mark-read UNIT` without a thread number requires `--all`, matching `lessons mark-read`.
- Writes are never retried.
- `threads show` gains `isStarred`, `isWatched`, and `vote`.
- MCP gets no new tools in this round.

## Unread filter

`threads --unread` keeps threads whose `isSeen` is false. Ed tracks this state on its server, so it agrees with the web client. It is a client-side filter like `--category`, so it pages through Ed until `--limit` matches.

## Since cursor

```bash
edstem threads UNIT --since last
```

`--unread` answers "what have I not opened". The cursor answers "what is new since I last ran this command". Neither replaces the other.

- **Storage**: `~/.config/edstem-cli/state.json`, shaped as `{ "<courseId>": "<ISO time>" }`. The key is the numeric course ID because codes repeat across sessions.
- **First run**: with no saved cursor, `last` means the last 7 days.
- **Advance**: the cursor moves to the request's start time, and only after the command succeeds.
- **When not to advance** (`shouldAdvanceCursor`):
  - `threads search` never advances.
  - Content filters (`--category`, `--subcategory`, `--type`, `--unread`, and similar) read without advancing, so a narrow view cannot hide the rest of the new threads.
  - If the result reaches `--limit`, the cursor stays and stderr warns. Ed returns newest first, so truncation drops the older new threads.
- The cursor is local state only. `read` commands still never change upstream state.

## Export

```bash
edstem threads export UNIT --dest ./archive
edstem threads export UNIT --dest ./archive --since 2026-07-01 --no-files
```

```text
archive/
  index.md                       # number, title, category, author, date, replies
  threads/0042-week-3-sample.md  # threadToMarkdown output
  files/0042/<attachment>
  manifest.json                  # unit, export time, thread ids
```

- Export accepts the thread filters. With no `--limit`, it pages until Ed runs out, without the ten-page cap that `listThreads` uses. Progress goes to stderr.
- Each thread needs one detail request for its comments. Requests run one at a time behind the existing backoff.
- Existing thread files are skipped, so an interrupted export resumes. `--force` rewrites them. Incremental sync is out of scope.
- Attachments download through the thread file collector and `downloadLessonFiles`. Links in the Markdown are rewritten to the local paths, so the archive survives Ed retiring a URL. `--no-files` skips downloads and keeps the remote links.
- stdout reports only a summary: `{ dest, threads, skipped, files }`.

## Commits

1. `feat(ed): parse star, watch, and vote state and add thread actions`
2. `feat(threads): add star, watch, vote, and read actions`
3. `feat(threads): filter unread threads`
4. `feat(threads): add a per-unit --since last cursor`
5. `feat(threads): export a unit's threads and attachments to Markdown`
6. `docs: describe thread actions, the since cursor, and export`

## Acceptance gates

- Every action is tested against mocked Ed responses, including the already-in-state no-op and the `--dry-run` path.
- No write request is retried.
- The cursor never advances on search, filtered listings, truncated results, or failures.
- An interrupted export resumes without re-downloading finished threads.
- One live call per new endpoint confirms the request shape before release.

## Implementation verification

Implemented on `feat/thread-actions-export`. Mocked CLI/HTTP tests cover paired
state actions, no-ops, dry runs, vote comment ownership, bulk read guards, and
non-retried writes. Filesystem tests cover the seven-day cursor fallback,
non-advancement on narrowed/truncated/failed listings, archive attachment links,
uncapped export pagination, interrupted export recovery, and forced replacement.

The current Ed web bundle confirms the endpoint paths, `watch` body shape, and
boolean watch values (the interface calls `setWatch(true)` and passes that state
unchanged to the request).
Live probes on 2026-10-08 (AU, one existing announcement, restored afterwards)
confirmed `star`/`unstar`, `watch`/`unwatch` with boolean `state`, and
`read`/`unread`: each returned 204 and `threads show` or `--unread` reflected the
change; repeated actions sent no write. Ed also accepts `{ "state": null }` on
`watch`, which restores the course default. `upvote`/`unvote` and `read_all` were
not probed live, because a vote is visible to others and `read_all` cannot be undone.

Final local checks: `npm run check`, `npm run build:local`, deterministic skill
regeneration, and `npm test` passed (220 Node, 22 remote, 10 Worker tests).
The two-axis code review found no Standards issues. All three reported Spec
issues around offline Markdown links were fixed and re-reviewed; no findings
remain. Regression tests cover parentheses in filenames, inline and reference
links, bracketed destinations, and standalone autolinks.
