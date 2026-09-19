import type { Thread } from "./models.js";

const RELATIVE_SINCE = /^(\d+)\s*([dhw])$/i;
const RELATIVE_UNIT_MS: Record<string, number> = {
  d: 86_400_000,
  h: 3_600_000,
  w: 604_800_000,
};

export interface ThreadFilterOptions {
  answered?: boolean;
  category?: string;
  query?: string;
  since?: Date;
  subcategory?: string;
  threadType?: string;
}

export function filterThreads(
  threads: Thread[],
  options: ThreadFilterOptions = {}
): Thread[] {
  const answered = options.answered;
  const category = normalizeFilter(options.category);
  const subcategory = normalizeFilter(options.subcategory);
  const threadType = normalizeFilter(options.threadType);
  const words = queryWords(options.query);
  const since = options.since?.getTime();
  return threads.filter((thread) => {
    if (category && normalizeFilter(thread.category) !== category) {
      return false;
    }
    if (subcategory && normalizeFilter(thread.subcategory) !== subcategory) {
      return false;
    }
    if (threadType && normalizeFilter(thread.type) !== threadType) {
      return false;
    }
    if (answered !== undefined && thread.isAnswered !== answered) {
      return false;
    }
    if (since !== undefined) {
      const created = createdAt(thread);
      if (created === undefined || created < since) {
        return false;
      }
    }
    if (words.length > 0 && !matchesQuery(thread, words)) {
      return false;
    }
    return true;
  });
}

/** True when the options narrow the list, so one Ed page may not hold enough matches. */
export function hasThreadFilters(options: ThreadFilterOptions): boolean {
  return options.answered !== undefined ||
    options.since !== undefined ||
    Boolean(normalizeFilter(options.category)) ||
    Boolean(normalizeFilter(options.subcategory)) ||
    Boolean(normalizeFilter(options.threadType)) ||
    queryWords(options.query).length > 0;
}

/** Parse an ISO date, an ISO datetime, or a relative offset such as 7d, 12h, or 2w. */
export function parseSince(value: string, now = new Date()): Date {
  const normalized = value.trim();
  const relative = RELATIVE_SINCE.exec(normalized);
  if (relative) {
    const unit = RELATIVE_UNIT_MS[(relative[2] ?? "").toLowerCase()] ?? 0;
    return new Date(now.getTime() - Number(relative[1]) * unit);
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(
      `Invalid time value ${JSON.stringify(value)}. Use an ISO date such as 2026-09-01, ` +
      "an ISO datetime such as 2026-09-01T10:00:00Z, or a relative offset such as 7d, 12h, or 2w."
    );
  }
  return parsed;
}

/** True when the thread has a known creation time that falls before the cutoff. */
export function isThreadOlderThan(thread: Thread, since: Date): boolean {
  const created = createdAt(thread);
  return created !== undefined && created < since.getTime();
}

function matchesQuery(thread: Thread, words: string[]): boolean {
  const haystack = `${thread.title}\n${thread.document}`.toLowerCase();
  return words.every((word) => haystack.includes(word));
}

function queryWords(query: string | undefined): string[] {
  return (query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
}

function createdAt(thread: Thread): number | undefined {
  const created = Date.parse(thread.createdAt);
  return Number.isNaN(created) ? undefined : created;
}

function normalizeFilter(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
}
