import { HTMLElement, type Node, parse } from "node-html-parser";

import type { Comment, Lesson, Thread, User } from "./ed/models.js";

const ED_XML_TAG = /<(?:document|paragraph|heading|list|list-item|link|file|break|code|pre)\b/i;

export function threadToMarkdown(thread: Thread): string {
  const lines = [`# #${thread.number} ${thread.title}`, ""];
  addMetadata(lines, "Thread ID", thread.id);
  addMetadata(lines, "Course ID", thread.courseId);
  addMetadata(lines, "Author", authorName(thread.author, thread.isAnonymous));
  addMetadata(lines, "Category", [thread.category, thread.subcategory].filter(Boolean).join(" / "));
  addMetadata(lines, "Created", thread.createdAt);
  addMetadata(lines, "Updated", thread.updatedAt);
  addMetadata(lines, "Flags", threadFlags(thread).join(", "));
  lines.push("", "## Post", "", renderEdText(thread.document || thread.content), "");
  appendComments(lines, "Answers", thread.answers);
  appendComments(lines, "Comments", thread.comments);
  return `${lines.join("\n").trimEnd()}\n`;
}

export function lessonToMarkdown(lesson: Lesson): string {
  const lines = [`# ${lesson.title}`, ""];
  addMetadata(lines, "Lesson ID", lesson.id);
  addMetadata(lines, "Course ID", lesson.courseId);
  addMetadata(lines, "Module", lesson.moduleName);
  addMetadata(lines, "Type", lesson.type);
  addMetadata(lines, "Status", lesson.status);
  if (lesson.outline) {
    lines.push("", "## Outline", "", renderEdText(lesson.outline, 2), "");
  }
  lines.push("", "## Slides", "");
  for (const slide of lesson.slides) {
    lines.push(`### ${slide.index || 1}. ${slide.title || `Slide ${slide.index || 1}`}`, "");
    addMetadata(lines, "Slide ID", slide.id);
    addMetadata(lines, "Type", slide.type);
    addMetadata(lines, "Status", slide.status);
    if (slide.content) {
      lines.push("", renderEdText(slide.content, 2), "");
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderEdText(source: string, headingOffset = 0): string {
  if (!ED_XML_TAG.test(source)) {
    return source;
  }
  if (/<document\b/i.test(source) && !/<\/document>/i.test(source)) {
    return source;
  }
  try {
    const normalized = source.replace(/<link\b/gi, "<a").replace(/<\/link>/gi, "</a>");
    const root = parse(normalized, { lowerCaseTagName: true });
    return renderChildren(root, headingOffset).replace(/\n{3,}/g, "\n\n").trim();
  } catch {
    return source;
  }
}

function renderNode(node: Node, headingOffset: number): string {
  if (!(node instanceof HTMLElement)) {
    return node.textContent;
  }
  const tag = node.rawTagName.toLowerCase();
  const content = renderChildren(node, headingOffset);
  if (tag === "document") return content;
  if (tag === "paragraph") return `${content.trim()}\n\n`;
  if (tag === "break" || tag === "br") return "\n";
  if (tag === "heading") {
    const level = Math.min(6, Math.max(1, Number(node.getAttribute("level")) || 1) + headingOffset);
    return `${"#".repeat(level)} ${content.trim()}\n\n`;
  }
  if (tag === "list") return renderList(node, headingOffset);
  if (tag === "list-item") return content;
  if (tag === "link" || tag === "a") {
    const href = node.getAttribute("href") ?? node.getAttribute("url") ?? "";
    return href ? `[${content.trim() || href}](${href})` : content;
  }
  if (tag === "file") {
    const url = node.getAttribute("url") ?? "";
    const name = node.getAttribute("filename") ?? node.getAttribute("name") ?? url;
    return url ? `File: [${name}](${url})\n\n` : `File: ${name}\n\n`;
  }
  if (tag === "code") return `\`${content.trim()}\``;
  if (tag === "pre") return `\n\`\`\`\n${node.textContent.trim()}\n\`\`\`\n\n`;
  if (tag === "bold" || tag === "strong") return `**${content.trim()}**`;
  if (tag === "italic" || tag === "em") return `*${content.trim()}*`;
  return content;
}

function renderChildren(node: Node, headingOffset: number): string {
  return node.childNodes.map((child) => renderNode(child, headingOffset)).join("");
}

function renderList(node: HTMLElement, headingOffset: number): string {
  const ordered = node.getAttribute("style") === "number" || node.getAttribute("type") === "ordered";
  const items = node.childNodes.filter(
    (child): child is HTMLElement => child instanceof HTMLElement && child.rawTagName.toLowerCase() === "list-item"
  );
  return `${items.map((item, index) => {
    const marker = ordered ? `${index + 1}.` : "-";
    const body = renderChildren(item, headingOffset).trim().replace(/\n/g, "\n  ");
    return `${marker} ${body}`;
  }).join("\n")}\n\n`;
}

function appendComments(lines: string[], title: string, comments: Comment[]): void {
  if (comments.length === 0) return;
  lines.push(`## ${title}`, "");
  for (const comment of comments) {
    appendComment(lines, comment, 0);
  }
  lines.push("");
}

function appendComment(lines: string[], comment: Comment, depth: number): void {
  const indent = "  ".repeat(depth);
  const markers = [
    isStaff(comment.author) ? "staff" : "",
    comment.isEndorsed ? "endorsed" : "",
    comment.isAnonymous ? "anonymous" : "",
    comment.voteCount ? `${comment.voteCount > 0 ? "+" : ""}${comment.voteCount}` : "",
  ].filter(Boolean);
  const suffix = markers.length ? ` [${markers.join(", ")}]` : "";
  const timestamp = comment.createdAt ? ` - ${comment.createdAt}` : "";
  lines.push(`${indent}- **${authorName(comment.author, comment.isAnonymous)}**${suffix}${timestamp}`);
  const body = renderEdText(comment.document || comment.content);
  if (body) {
    for (const line of body.split("\n")) {
      lines.push(`${indent}  ${line}`);
    }
  }
  comment.comments.forEach((child) => appendComment(lines, child, depth + 1));
}

function addMetadata(lines: string[], label: string, value: string | number): void {
  if (value !== "" && value !== 0) {
    lines.push(`- **${label}:** ${value}`);
  }
}

function authorName(user: User | null, anonymous: boolean): string {
  if (anonymous) return "Anonymous";
  return user?.name || "Unknown";
}

function isStaff(user: User | null): boolean {
  return Boolean(user && ["admin", "ta", "tutor"].includes(user.courseRole));
}

function threadFlags(thread: Thread): string[] {
  return [
    thread.isPinned ? "pinned" : "",
    thread.isPrivate ? "private" : "",
    thread.isAnswered ? "answered" : "",
    thread.isEndorsed ? "endorsed" : "",
    thread.isAnonymous ? "anonymous" : "",
    thread.isLocked ? "locked" : "",
  ].filter(Boolean);
}
