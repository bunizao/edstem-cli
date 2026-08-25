import { createWriteStream } from "node:fs";
import { link, mkdir, rename, rm, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { randomUUID } from "node:crypto";

import type { EdClient } from "./ed/client.js";
import type { LessonFile } from "./ed/models.js";

export interface LessonFileDownload {
  filename: string;
  path: string;
  bytes: number;
  mediaType?: string;
  slideId?: number;
  url: string;
}

export class LessonDownloadError extends Error {
  readonly kind: "exists" | "response";

  constructor(kind: "exists" | "response", message: string) {
    super(message);
    this.kind = kind;
    this.name = "LessonDownloadError";
  }
}

export async function downloadLessonFiles(
  client: EdClient,
  files: LessonFile[],
  options: { destination: string; force?: boolean }
): Promise<LessonFileDownload[]> {
  const destination = resolve(options.destination);
  await mkdir(destination, { recursive: true });
  const downloads: LessonFileDownload[] = [];
  const reservedNames = new Set<string>();

  for (const file of files) {
    const response = await client.fetchFile(file.url);
    if (!response.body) {
      throw new LessonDownloadError("response", `Ed returned an empty file body for ${file.filename}.`);
    }

    const headerName = filenameFromContentDisposition(response.headers.get("content-disposition"));
    const filename = uniqueFilename(safeFilename(headerName || file.filename), reservedNames);
    const target = join(destination, filename);
    const temporary = join(destination, `.${filename}.${randomUUID()}.part`);

    try {
      await pipeline(
        Readable.fromWeb(response.body as unknown as NodeReadableStream),
        createWriteStream(temporary, { flags: "wx" })
      );
      const bytes = (await stat(temporary)).size;
      if (options.force) {
        await rename(temporary, target);
      } else {
        try {
          await link(temporary, target);
        } catch (error) {
          if (isNodeError(error, "EEXIST")) {
            throw new LessonDownloadError(
              "exists",
              `File already exists: ${target}. Use --force to replace it.`
            );
          }
          throw error;
        }
        await rm(temporary);
      }
      downloads.push({
        bytes,
        filename,
        mediaType: response.headers.get("content-type") || file.mediaType,
        path: target,
        slideId: file.slideId,
        url: file.url
      });
    } finally {
      await rm(temporary, { force: true });
    }
  }

  return downloads;
}

function filenameFromContentDisposition(value: string | null): string {
  if (!value) return "";
  const encoded = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(value)?.[1]?.trim();
  if (encoded) {
    try {
      return decodeURIComponent(stripQuotes(encoded));
    } catch {
      return stripQuotes(encoded);
    }
  }
  const quoted = /filename\s*=\s*"((?:[^"\\]|\\.)*)"/i.exec(value)?.[1];
  if (quoted) return quoted.replace(/\\(["\\])/g, "$1");
  return stripQuotes(/filename\s*=\s*([^;]+)/i.exec(value)?.[1]?.trim() ?? "");
}

function safeFilename(value: string): string {
  const cleaned = basename(value)
    .replace(/[\u0000-\u001f\u007f]/g, "_")
    .replace(/[\\/]/g, "_")
    .trim();
  return cleaned && cleaned !== "." && cleaned !== ".." ? cleaned : "download";
}

function uniqueFilename(filename: string, reserved: Set<string>): string {
  if (!reserved.has(filename)) {
    reserved.add(filename);
    return filename;
  }
  const dot = filename.lastIndexOf(".");
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  const extension = dot > 0 ? filename.slice(dot) : "";
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}${extension}`;
    if (!reserved.has(candidate)) {
      reserved.add(candidate);
      return candidate;
    }
  }
}

function stripQuotes(value: string): string {
  return value.replace(/^"|"$/g, "");
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
