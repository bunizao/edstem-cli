// Minimal Markdown to Ed document converter. Ed stores post bodies as XML;
// renderEdText in src/markdown.ts turns that XML back into Markdown.

const FENCE = /^```/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET_ITEM = /^-\s+(.*)$/;
const NUMBER_ITEM = /^\d+\.\s+(.*)$/;
const CODE_SPAN = /^`[^`]+`$/;
// Allows one level of balanced parentheses so Wikipedia-style URLs survive.
const LINK = /\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g;
const BOLD = /\*\*([^*]+)\*\*/g;
const ITALIC = /\*([^*]+)\*/g;

type ListStyle = "bullet" | "number";

export function markdownToEdDocument(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = (lines[index] ?? "").trim();
    if (!line) {
      index += 1;
      continue;
    }

    if (FENCE.test(line)) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !FENCE.test((lines[index] ?? "").trim())) {
        code.push(lines[index] ?? "");
        index += 1;
      }
      index += 1;
      blocks.push(`<pre>${escapeText(code.join("\n"))}</pre>`);
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1]?.length ?? 1;
      blocks.push(`<heading level="${level}">${renderInline(heading[2] ?? "")}</heading>`);
      index += 1;
      continue;
    }

    const style = listStyle(line);
    if (style) {
      const items: string[] = [];
      while (index < lines.length && listStyle((lines[index] ?? "").trim()) === style) {
        items.push(itemContent((lines[index] ?? "").trim()));
        index += 1;
      }
      blocks.push(`<list style="${style}">${items
        .map((item) => `<list-item><paragraph>${renderInline(item)}</paragraph></list-item>`)
        .join("")}</list>`);
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length && isParagraphLine((lines[index] ?? "").trim())) {
      paragraph.push((lines[index] ?? "").trim());
      index += 1;
    }
    blocks.push(`<paragraph>${renderInline(paragraph.join(" "))}</paragraph>`);
  }

  return `<document version="2.0">${blocks.join("")}</document>`;
}

function isParagraphLine(line: string): boolean {
  return Boolean(line) && !FENCE.test(line) && !HEADING.test(line) && !listStyle(line);
}

function listStyle(line: string): ListStyle | undefined {
  if (BULLET_ITEM.test(line)) return "bullet";
  if (NUMBER_ITEM.test(line)) return "number";
  return undefined;
}

function itemContent(line: string): string {
  return (BULLET_ITEM.exec(line)?.[1] ?? NUMBER_ITEM.exec(line)?.[1] ?? "").trim();
}

function renderInline(text: string): string {
  return text
    .split(/(`[^`]+`)/)
    .map((part) => CODE_SPAN.test(part)
      ? `<code>${escapeText(part.slice(1, -1))}</code>`
      : renderEmphasis(escapeText(part)))
    .join("");
}

function renderEmphasis(text: string): string {
  return text
    .replace(LINK, (_match, label: string, href: string) =>
      `<link href="${escapeAttribute(href)}">${label}</link>`)
    .replace(BOLD, "<bold>$1</bold>")
    .replace(ITALIC, "<italic>$1</italic>");
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Attribute values arrive already escaped for & < >; only quotes remain.
function escapeAttribute(value: string): string {
  return value.replace(/"/g, "&quot;");
}
