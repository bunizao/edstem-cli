import { HTMLElement, parse } from "node-html-parser";

import { isDownloadableLessonFileUrl } from "./client.js";
import type { Lesson, LessonFile, LessonSlide } from "./models.js";

export function listLessonFiles(lesson: Lesson): LessonFile[] {
  const files: LessonFile[] = [];
  const seen = new Set<string>();
  const add = (file: LessonFile): void => {
    const key = `${file.slideId ?? "lesson"}\u0000${file.url}`;
    if (!isDownloadableLessonFileUrl(file.url) || seen.has(key)) return;
    seen.add(key);
    files.push(file);
  };

  for (const file of filesFromContent(lesson.outline, lesson.id)) add(file);
  for (const slide of lesson.slides) {
    if (slide.fileUrl) {
      add({
        filename: suggestedSlideFilename(slide),
        lessonId: lesson.id,
        mediaType: mediaTypeForSlide(slide),
        slideId: slide.id,
        slideIndex: slide.index,
        slideTitle: slide.title,
        source: "slide",
        url: slide.fileUrl
      });
    }
    for (const file of filesFromContent(slide.content, lesson.id, slide)) add(file);
  }
  return files;
}

function filesFromContent(source: string, lessonId: number, slide?: LessonSlide): LessonFile[] {
  if (!source || !/<file\b/i.test(source)) return [];
  return parse(source, { lowerCaseTagName: true })
    .querySelectorAll("file")
    .map((node) => fileFromNode(node, lessonId, slide))
    .filter((file): file is LessonFile => file !== null);
}

function fileFromNode(node: HTMLElement, lessonId: number, slide?: LessonSlide): LessonFile | null {
  const url = node.getAttribute("url")?.trim() ?? "";
  if (!url) return null;
  const filename = node.getAttribute("filename")?.trim() ||
    node.getAttribute("name")?.trim() ||
    filenameFromUrl(url) ||
    "download";
  return {
    filename,
    lessonId,
    ...(slide ? {
      slideId: slide.id,
      slideIndex: slide.index,
      slideTitle: slide.title
    } : {}),
    source: "content",
    url
  };
}

function suggestedSlideFilename(slide: LessonSlide): string {
  const base = slide.title.trim() || `slide-${slide.id}`;
  const extension = slide.type.toLowerCase() === "pdf" ? ".pdf" : "";
  return extension && !base.toLowerCase().endsWith(extension) ? `${base}${extension}` : base;
}

function mediaTypeForSlide(slide: LessonSlide): string | undefined {
  return slide.type.toLowerCase() === "pdf" ? "application/pdf" : undefined;
}

function filenameFromUrl(value: string): string {
  try {
    return decodeURIComponent(new URL(value).pathname.split("/").filter(Boolean).at(-1) ?? "");
  } catch {
    return "";
  }
}
