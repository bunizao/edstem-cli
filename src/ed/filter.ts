import type { Thread } from "./models.js";

export interface ThreadFilterOptions {
  answered?: boolean;
  category?: string;
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
    return true;
  });
}

function normalizeFilter(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
}
