import type { Thread } from "./models.js";

export interface ThreadFilterOptions {
  answered?: boolean;
  category?: string;
  threadType?: string;
}

export function filterThreads(
  threads: Thread[],
  options: ThreadFilterOptions = {}
): Thread[] {
  const { answered, category, threadType } = options;
  return threads.filter((thread) => {
    if (category && thread.category.toLowerCase() !== category.toLowerCase()) {
      return false;
    }
    if (threadType && thread.type.toLowerCase() !== threadType.toLowerCase()) {
      return false;
    }
    if (answered !== undefined && thread.isAnswered !== answered) {
      return false;
    }
    return true;
  });
}
