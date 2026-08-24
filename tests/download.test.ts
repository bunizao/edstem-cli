import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { downloadLessonFiles, LessonDownloadError } from "../src/download.js";
import { EdClient, type FetchLike } from "../src/ed/client.js";
import type { LessonFile } from "../src/ed/models.js";

describe("lesson file downloads", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
  });

  it("uses the response filename and writes the file to the destination", async () => {
    const directory = await temporaryDirectory();
    const fetch = vi.fn<FetchLike>().mockResolvedValue(new Response("pdf-body", {
      headers: {
        "content-disposition": 'inline; filename="fallback.pdf"; filename*=UTF-8\'\'Workshop%20Slides.pdf',
        "content-type": "application/pdf",
      },
    }));
    const client = new EdClient({ fetch, token: "secret" });

    const downloads = await downloadLessonFiles(client, [file()], { destination: directory });

    expect(downloads).toEqual([expect.objectContaining({
      bytes: 8,
      filename: "Workshop Slides.pdf",
      mediaType: "application/pdf",
      slideId: 10,
    })]);
    expect(await readFile(join(directory, "Workshop Slides.pdf"), "utf8")).toBe("pdf-body");
  });

  it("protects existing files unless force is set", async () => {
    const directory = await temporaryDirectory();
    const target = join(directory, "Workshop Slides.pdf");
    await writeFile(target, "original");
    const fetch = vi.fn<FetchLike>().mockImplementation(async () => new Response("replacement", {
      headers: { "content-disposition": 'attachment; filename="Workshop Slides.pdf"' },
    }));
    const client = new EdClient({ fetch, token: "secret" });

    await expect(downloadLessonFiles(client, [file()], { destination: directory }))
      .rejects.toBeInstanceOf(LessonDownloadError);
    expect(await readFile(target, "utf8")).toBe("original");

    await downloadLessonFiles(client, [file()], { destination: directory, force: true });
    expect(await readFile(target, "utf8")).toBe("replacement");
  });

  it("keeps response filenames inside the destination", async () => {
    const directory = await temporaryDirectory();
    const fetch = vi.fn<FetchLike>().mockResolvedValue(new Response("safe", {
      headers: {
        "content-disposition": "attachment; filename*=UTF-8''..%2F..%2Fescaped.pdf",
      },
    }));
    const client = new EdClient({ fetch, token: "secret" });

    const downloads = await downloadLessonFiles(client, [file()], { destination: directory });

    expect(downloads[0]?.filename).toBe("escaped.pdf");
    expect(downloads[0]?.path).toBe(join(directory, "escaped.pdf"));
    expect(await readFile(join(directory, "escaped.pdf"), "utf8")).toBe("safe");
  });

  async function temporaryDirectory(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), "edstem-download-test-"));
    directories.push(directory);
    return directory;
  }
});

function file(): LessonFile {
  return {
    filename: "Suggested.pdf",
    lessonId: 7001,
    mediaType: "application/pdf",
    slideId: 10,
    source: "slide",
    url: "https://static.edusercontent.com/files/slides",
  };
}
