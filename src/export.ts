import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { downloadLessonFiles } from "./download.js";
import type { EdClient } from "./ed/client.js";
import { listThreadFiles } from "./ed/files.js";
import { filterThreads, type ThreadFilterOptions } from "./ed/filter.js";
import type { Thread } from "./ed/models.js";
import { passedSince } from "./ed/operations.js";
import { threadToMarkdown } from "./markdown.js";

interface ExportEntry {
  id: number;
  number: number;
  title: string;
  category: string;
  author: string;
  createdAt: string;
  replies: number;
  path: string;
}

interface ExportManifest {
  unit: { id: number };
  exportedAt: string;
  threadIds: number[];
  entries: ExportEntry[];
}

export interface ThreadExportOptions extends ThreadFilterOptions {
  courseId: number;
  destination: string;
  limit?: number;
  offset?: number;
  sort: string;
  files?: boolean;
  force?: boolean;
  progress: (message: string) => void;
}

export async function exportThreads(client: EdClient, options: ThreadExportOptions) {
  const dest = resolve(options.destination);
  const manifestPath = join(dest, "manifest.json");
  const previous = await readManifest(manifestPath);
  if (previous && previous.unit.id !== options.courseId) {
    throw new Error(`Archive belongs to unit ${previous.unit.id}; choose another --dest.`);
  }
  await mkdir(join(dest, "threads"), { recursive: true });
  const known = new Map(previous?.entries.map((entry) => [entry.id, entry]) ?? []);
  const entries: ExportEntry[] = [];
  const seen = new Set<number>();
  const started = new Date().toISOString();
  let threads = 0;
  let skipped = 0;
  let files = 0;

  const saveIndex = async () => {
    const manifest: ExportManifest = {
      unit: { id: options.courseId }, exportedAt: started,
      threadIds: entries.map((entry) => entry.id), entries,
    };
    await writeArchiveFile(join(dest, "index.md"), renderIndex(options.courseId, entries));
    await writeArchiveFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  };

  for (let offset = options.offset ?? 0; ; offset += 100) {
    options.progress(`Listing threads at offset ${offset}.\n`);
    const page = await client.fetchThreads(options.courseId, { limit: 100, offset, sort: options.sort });
    for (const summary of filterThreads(page, options)) {
      if (seen.has(summary.id)) continue;
      seen.add(summary.id);
      const number = String(summary.number).padStart(4, "0");
      const path = known.get(summary.id)?.path ?? `threads/${number}-${slug(summary.title)}.md`;
      const target = join(dest, path);
      if (!options.force && await exists(target)) {
        skipped += 1;
        entries.push(known.get(summary.id) ?? indexEntry(summary, path));
        options.progress(`Skipping completed thread #${summary.number}.\n`);
      } else {
        options.progress(`Exporting thread #${summary.number}.\n`);
        const thread = await client.fetchThread(summary.id);
        const attachments = listThreadFiles(thread);
        const links = new Map(attachments.map((file) => [file.url, file.url]));
        if (options.files !== false && attachments.length > 0) {
          const downloads = await downloadLessonFiles(client, attachments, {
            destination: join(dest, "files", number), force: true,
          });
          files += downloads.length;
          for (const download of downloads) {
            links.set(download.url, `../files/${number}/${encodeURIComponent(download.filename)}`);
          }
        }
        let markdown = threadToMarkdown(thread);
        for (const [remote, local] of links) {
          markdown = markdown.split(`](${remote})`).join(`](${local})`);
        }
        if (attachments.length > 0) {
          markdown += `\n## Attachments\n\n${attachments.map((file) =>
            `- [${escapeCell(file.filename)}](${links.get(file.url)})`).join("\n")}\n`;
        }
        await writeArchiveFile(target, markdown);
        entries.push(indexEntry(thread, path));
        threads += 1;
      }
      await saveIndex();
      if (options.limit !== undefined && entries.length >= options.limit) {
        return { dest, threads, skipped, files };
      }
    }
    if (page.length < 100 || (options.sort === "new" && passedSince(page, options.since))) break;
  }
  await saveIndex();
  return { dest, threads, skipped, files };
}

function indexEntry(thread: Thread, path: string): ExportEntry {
  return {
    id: thread.id, number: thread.number, title: thread.title,
    category: [thread.category, thread.subcategory].filter(Boolean).join(" / "),
    author: thread.isAnonymous ? "Anonymous" : thread.author?.name || "Unknown",
    createdAt: thread.createdAt, replies: thread.metrics.replyCount, path,
  };
}

function renderIndex(courseId: number, entries: ExportEntry[]): string {
  return `# Unit ${courseId} forum\n\n| Number | Title | Category | Author | Date | Replies |\n` +
    `| --- | --- | --- | --- | --- | --- |\n` + entries.map((entry) =>
      `| ${entry.number} | [${escapeCell(entry.title)}](${entry.path}) | ${escapeCell(entry.category)} | ` +
      `${escapeCell(entry.author)} | ${escapeCell(entry.createdAt)} | ${entry.replies} |`
    ).join("\n") + "\n";
}

function escapeCell(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/[|\[\]]/g, "\\$&").replace(/[\r\n]+/g, " ");
}

function slug(title: string): string {
  return title.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "").slice(0, 80) || "thread";
}

async function exists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function readManifest(path: string): Promise<ExportManifest | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const manifest = JSON.parse(raw) as ExportManifest;
  if (!Number.isInteger(manifest.unit?.id) || !Array.isArray(manifest.entries) ||
    manifest.entries.some((entry) => !Number.isInteger(entry.id) ||
      typeof entry.path !== "string" || !/^threads\/[\p{L}\p{N}-]+\.md$/u.test(entry.path))) {
    throw new Error(`Invalid archive manifest in ${path}.`);
  }
  return manifest;
}

async function writeArchiveFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
