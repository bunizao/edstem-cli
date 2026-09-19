import { describe, expect, it } from "vitest";

import { markdownToEdDocument } from "../src/ed/document.js";

const CASES: Array<[string, string, string]> = [
  [
    "wraps blank-line separated paragraphs",
    "First line\nstill first.\n\nSecond.",
    "<paragraph>First line still first.</paragraph><paragraph>Second.</paragraph>",
  ],
  [
    "maps headings to levels",
    "# Title\n\n### Detail",
    '<heading level="1">Title</heading><heading level="3">Detail</heading>',
  ],
  [
    "escapes markup inside fenced code",
    "```ts\nif (a < b && c > d) {}\n```",
    "<pre>if (a &lt; b &amp;&amp; c &gt; d) {}</pre>",
  ],
  [
    "keeps blank lines inside fenced code",
    "```\none\n\ntwo\n```",
    "<pre>one\n\ntwo</pre>",
  ],
  [
    "groups bullet items into one list",
    "- first\n- second",
    '<list style="bullet"><list-item><paragraph>first</paragraph></list-item>'
    + "<list-item><paragraph>second</paragraph></list-item></list>",
  ],
  [
    "groups numbered items into one list",
    "1. first\n2. second",
    '<list style="number"><list-item><paragraph>first</paragraph></list-item>'
    + "<list-item><paragraph>second</paragraph></list-item></list>",
  ],
  [
    "renders links with escaped attributes",
    "See [the docs](https://ed.example/a?x=1&y=2).",
    '<paragraph>See <link href="https://ed.example/a?x=1&amp;y=2">the docs</link>.</paragraph>',
  ],
  [
    "keeps balanced parentheses inside a link URL",
    "[wiki](https://en.wikipedia.org/wiki/Function_(mathematics))",
    '<paragraph><link href="https://en.wikipedia.org/wiki/Function_(mathematics)">wiki</link></paragraph>',
  ],
  [
    "stops a link URL before trailing parenthesised text",
    "See [the docs](https://ed.example/a) (really).",
    '<paragraph>See <link href="https://ed.example/a">the docs</link> (really).</paragraph>',
  ],
  [
    "renders inline code, bold, and italic",
    "Run `npm < ci` for **real** and *maybe* more.",
    "<paragraph>Run <code>npm &lt; ci</code> for <bold>real</bold> and <italic>maybe</italic> more.</paragraph>",
  ],
  [
    "escapes text outside markup",
    "5 < 6 & 7 > 2",
    "<paragraph>5 &lt; 6 &amp; 7 &gt; 2</paragraph>",
  ],
  [
    "leaves emphasis markers inside code spans alone",
    "`**not bold**`",
    "<paragraph><code>**not bold**</code></paragraph>",
  ],
  ["produces an empty document for blank input", "   \n\n", ""],
];

describe("markdownToEdDocument", () => {
  it.each(CASES)("%s", (_name, markdown, expected) => {
    expect(markdownToEdDocument(markdown)).toBe(`<document version="2.0">${expected}</document>`);
  });

  it("round-trips through the Markdown renderer", async () => {
    const { renderEdText } = await import("../src/markdown.js");

    expect(renderEdText(markdownToEdDocument("# Title\n\nUse `pip` now."))).toBe(
      "# Title\n\nUse `pip` now."
    );
  });
});
