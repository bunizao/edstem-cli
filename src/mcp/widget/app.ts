import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";

/*
 * One widget renders every show_* tool; the payload's kind picks the view.
 * Each view is one headline plus one main element. Stepping, drilling and grading
 * happen here with no model turn; only "summarise / explain" goes back to the model.
 */

interface CatchupThread {
  answered: boolean;
  category: string;
  createdAt: string;
  excerpt: string;
  id: number;
  newReplies: number;
  number: number;
  replies: number;
  seen: boolean;
  sub: string;
  title: string;
  type: string;
}
interface Catchup {
  announcements: { createdAt: string; id: number; number: number; seen: boolean; title: string }[];
  course: string;
  days: number;
  kind: "forum_catchup";
  threads: CatchupThread[];
}
interface ActivityRow { category: string; createdAt: string; number: number; replies: number; sub: string; title: string }
interface Activity { course: string; kind: "thread_activity"; threads: ActivityRow[]; weeks: number }
interface ProgressModule {
  completed: number;
  name: string;
  openedAt: string | null;
  total: number;
  unfinished: { id: number; status: string; title: string }[];
}
interface Progress { course: string; kind: "lesson_progress"; modules: ProgressModule[] }
interface GuideQuestion { answer: number; options: string[]; question: string; section: number; why: string }
interface Guide {
  edQuizSlides: number;
  kind: "lesson_guide";
  lesson: { id: number; module: string; title: string };
  quiz: GuideQuestion[];
  sections: { points: string[]; title: string }[];
}
type Payload = Catchup | Activity | Progress | Guide;
interface Week { counts: number[]; key: string; threads: ActivityRow[] }

const COLORS = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-other)"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SVG_NS = "http://www.w3.org/2000/svg";
const CATCHUP_ROWS = 8;

const root = document.getElementById("root") as HTMLElement;
const app = new App({ name: "edstem-widget", version: "1.0.0" });

let data: Payload | undefined;
let error: string | undefined;
let timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const ui = {
  drill: null as { key: string; data?: unknown } | null,
  observer: null as ResizeObserver | null,
  picks: {} as Record<number, number>,
  q: 0,
  showAll: false,
  step: 0,
  table: false,
};

app.ontoolresult = (result) => {
  // Mirrors WIDGET_VIEW_KEY in server.ts; the widget bundle can't import server code.
  const content = result._meta?.["edstem/view"] as Payload | undefined;
  if (result.isError || !content?.kind) {
    const text = result.content?.find((block) => block.type === "text");
    error = text && "text" in text ? readError(text.text) : "Ed returned nothing to show.";
    data = undefined;
  } else {
    data = content;
    error = undefined;
  }
  Object.assign(ui, { drill: null, picks: {}, q: 0, showAll: false, step: 0, table: false });
  render();
};
app.onhostcontextchanged = applyHostContext;
app.onteardown = async () => {
  ui.observer?.disconnect();
  return {};
};

void app.connect().then(() => {
  const context = app.getHostContext();
  if (context) applyHostContext(context);
});

function applyHostContext(context: McpUiHostContext): void {
  if (context.theme) applyDocumentTheme(context.theme);
  if (context.styles?.variables) applyHostStyleVariables(context.styles.variables);
  if (context.styles?.css?.fonts) applyHostFonts(context.styles.css.fonts);
  if (context.timeZone && context.timeZone !== timeZone) {
    timeZone = context.timeZone;
    render();
  }
}

function readError(text: string): string {
  try {
    return (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? text;
  } catch {
    return text;
  }
}

function render(): void {
  ui.observer?.disconnect();
  root.replaceChildren();
  root.hidden = !data && !error;
  if (error) root.append(el("p", { class: "empty" }, error));
  else if (data?.kind === "forum_catchup") renderCatchup(data);
  else if (data?.kind === "thread_activity") renderActivity(data);
  else if (data?.kind === "lesson_progress") renderProgress(data);
  else if (data?.kind === "lesson_guide") renderGuide(data);
}

// ---------- helpers ----------

type Attrs = Record<string, string | boolean | null | undefined | ((event: Event) => void)>;
type Child = Node | string | null | undefined | false;

function el(tag: string, attrs: Attrs = {}, ...children: (Child | Child[])[]): HTMLElement {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (typeof value === "function") node.addEventListener(key.slice(2), value);
    else if (key === "class") node.className = String(value);
    else if (key === "style") node.style.cssText = String(value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) if (child != null && child !== false) node.append(child);
  return node;
}

function clickable(handler: () => void): Attrs {
  return {
    onclick: handler,
    onkeydown: (event) => {
      const key = (event as KeyboardEvent).key;
      if (key === "Enter" || key === " ") {
        event.preventDefault();
        handler();
      }
    },
    role: "button",
    tabindex: "0",
  };
}

function button(label: string, onClick: () => void, primary = false): HTMLElement {
  return el("button", { class: primary ? "btn primary" : "btn", onclick: onClick, type: "button" }, label);
}

function header(title: string, subtitle: string, withToggle = false): HTMLElement {
  return el("div", { class: "w-head" },
    el("div", {}, el("h2", { class: "w-title" }, title), el("p", { class: "w-sub" }, subtitle)),
    withToggle
      ? el("button", { class: "w-toggle", onclick: () => { ui.table = !ui.table; render(); }, type: "button" },
        ui.table ? "Chart" : "Table")
      : null);
}

/** Hands a question back to the model: the only interaction that costs a turn. */
function askModel(text: string): void {
  void app.sendMessage({ content: [{ text, type: "text" }], role: "user" });
}

function ago(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days}d ago`;
}

function select(key: string): void {
  ui.drill = ui.drill?.key === key ? null : { key };
  render();
}

/** A drill panel loads once per selection and keeps its content across re-renders. */
function drillPanel<T>(options: {
  actions: (value: T) => Child[];
  body: (value: T) => Node;
  key: string;
  load: () => Promise<T>;
  title: string;
}): HTMLElement {
  const content = el("div", {}, el("div", { class: "loading" }, "Loading…"));
  const panel = el("div", { class: "drill" },
    el("div", { class: "drill-head" },
      el("h3", { class: "drill-title" }, options.title),
      el("button", { "aria-label": "Close", class: "icon-btn", onclick: () => { ui.drill = null; render(); }, type: "button" }, "×")),
    content);
  const fill = (value: T) => content.replaceChildren(
    options.body(value), el("div", { class: "drill-actions" }, options.actions(value)));
  const drill = ui.drill;
  if (drill && "data" in drill) fill(drill.data as T);
  else {
    options.load().then((value) => {
      if (ui.drill !== drill || !drill) return;
      drill.data = value;
      fill(value);
    }, (reason: unknown) => {
      content.replaceChildren(el("div", { class: "loading" }, `Couldn't load this: ${String(reason)}`));
    });
  }
  return panel;
}

// ---------- show_forum_catchup ----------

function renderCatchup(view: Catchup): void {
  const fresh = view.threads.filter((thread) => !thread.seen || thread.newReplies > 0);
  const byRecent = (left: CatchupThread, right: CatchupThread) => Date.parse(right.createdAt) - Date.parse(left.createdAt);
  const shown = ui.showAll ? [...view.threads].sort(byRecent) : fresh.sort(byRecent).slice(0, CATCHUP_ROWS);
  const unread = view.announcements.filter((item) => !item.seen);

  root.append(header("Forum catch-up",
    `${view.course} · ${fresh.length} new or updated in the last ${view.days} days`));

  const list = el("div", { class: "rank" });
  for (const item of unread) {
    list.append(el("div", {
      class: "rank-row unseen",
      ...clickable(() => askModel(`Read ${view.course} announcement #${item.number} and tell me what changed`)),
    },
    el("div", { class: "rank-top" }, el("span", { class: "t" }, "📢 ", item.title)),
    el("div", { class: "meta" }, `Announcement · ${ago(item.createdAt)}`)));
  }
  for (const thread of shown) {
    const key = `thread:${thread.id}`;
    const open = ui.drill?.key === key;
    const status = !thread.seen ? "new" : thread.newReplies ? `+${thread.newReplies} replies` : null;
    list.append(el("div", {
      "aria-expanded": String(open),
      class: `rank-row${thread.seen ? "" : " unseen"}${open ? " selected" : ""}`,
      ...clickable(() => select(key)),
    },
    el("div", { class: "rank-top" }, el("span", { class: "t", title: thread.title }, thread.title)),
    el("div", { class: "meta" },
      [status, thread.sub || thread.category, ago(thread.createdAt)].filter(Boolean).join(" · "),
      thread.type === "question" && !thread.answered ? el("span", { class: "wait" }, " · ○ unanswered") : null)));
    if (open) list.append(threadDrill(view, thread, key));
  }
  if (shown.length === 0 && unread.length === 0) {
    list.append(el("p", { class: "empty" }, "Nothing new. You're caught up."));
  }
  root.append(list);
  if (view.threads.length > shown.length || ui.showAll) {
    root.append(el("button", {
      class: "link",
      onclick: () => { ui.showAll = !ui.showAll; ui.drill = null; render(); },
      type: "button",
    }, ui.showAll ? "Only what's new" : `Show all ${view.threads.length} threads`));
  }
}

function threadDrill(view: Catchup, thread: CatchupThread, key: string): HTMLElement {
  return drillPanel<string | null>({
    actions: () => [button("Summarise", () =>
      askModel(`Summarise ${view.course} thread #${thread.number} "${thread.title}" and its replies`))],
    body: (answer) => el("div", {},
      thread.excerpt ? el("p", { class: "excerpt" }, thread.excerpt) : null,
      thread.type === "question"
        ? el("p", { class: "excerpt answer" }, answer ?? el("span", { class: "wait" }, "○ No answer yet"))
        : null),
    key,
    load: () => thread.type === "question" ? loadAnswer(thread.id) : Promise.resolve(null),
    title: `#${thread.number}`,
  });
}

/** The endorsed answer if there is one, else the first; trimmed to a glance. */
async function loadAnswer(threadId: number): Promise<string | null> {
  const result = await app.callServerTool({ arguments: { threadId }, name: "get_thread" });
  const text = result.content?.find((block) => block.type === "text");
  if (result.isError || !text || !("text" in text)) throw new Error(text && "text" in text ? readError(text.text) : "no thread");
  const detail = JSON.parse(text.text) as { answers?: { document?: string; endorsed?: boolean }[] };
  const answer = detail.answers?.find((item) => item.endorsed) ?? detail.answers?.[0];
  const body = answer?.document?.replace(/\s+/g, " ").trim();
  if (!body) return null;
  return body.length > 280 ? `${body.slice(0, 279).trimEnd()}…` : body;
}

// ---------- show_thread_activity ----------

// Weeks are bucketed in the viewer's zone: the server can't know it, the host can.
function weekOf(iso: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    day: "2-digit", month: "2-digit", timeZone, weekday: "short", year: "numeric",
  }).formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
  const monday = new Date(Date.UTC(+parts.year!, +parts.month! - 1, +parts.day! - WEEKDAYS.indexOf(parts.weekday!)));
  return monday.toISOString().slice(0, 10);
}

function addDays(key: string, days: number): string {
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dayLabel(key: string): string {
  return new Date(`${key.slice(0, 10)}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
}

function bucketByWeek(rows: ActivityRow[]): { categories: string[]; weeks: Week[] } {
  // The four busiest categories keep their own hue, in order of volume; the rest fold into Other.
  const volume = new Map<string, number>();
  for (const row of rows) volume.set(row.category, (volume.get(row.category) ?? 0) + 1);
  const ranked = [...volume.keys()].filter((name) => name && name !== "Other")
    .sort((left, right) => volume.get(right)! - volume.get(left)!);
  const named = ranked.slice(0, 4);
  const hasRest = rows.some((row) => !named.includes(row.category));
  const categories = hasRest ? [...named, "Other"] : named;
  const weeks = new Map<string, Week>();
  for (const row of rows) {
    const key = weekOf(row.createdAt);
    const week = weeks.get(key) ?? { counts: categories.map(() => 0), key, threads: [] };
    const index = named.indexOf(row.category);
    week.counts[index >= 0 ? index : categories.length - 1]! += 1;
    week.threads.push(row);
    weeks.set(key, week);
  }
  // Quiet weeks stay on the axis, up to the current one, so time reads evenly.
  const keys = [...weeks.keys()].sort();
  const last = weekOf(new Date().toISOString());
  for (let key = keys[0]!; key <= last; key = addDays(key, 7)) {
    if (!weeks.has(key)) weeks.set(key, { counts: categories.map(() => 0), key, threads: [] });
  }
  return { categories, weeks: [...weeks.values()].sort((left, right) => left.key.localeCompare(right.key)) };
}

function colorFor(categories: string[], index: number): string {
  return categories[index] === "Other" ? COLORS[4]! : COLORS[index]!;
}

function topSubcategory(rows: ActivityRow[]): string | undefined {
  const counts = new Map<string, number>();
  for (const row of rows) if (row.sub) counts.set(row.sub, (counts.get(row.sub) ?? 0) + 1);
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
}

function renderActivity(view: Activity): void {
  root.append(header("Forum activity", `${view.course} · threads per week, announcements excluded`, view.threads.length > 0));
  if (view.threads.length === 0) {
    root.append(el("p", { class: "empty" }, `No threads in the last ${view.weeks} weeks.`));
    return;
  }
  const { categories, weeks } = bucketByWeek(view.threads);
  const totals = weeks.map((week) => week.threads.length);
  const peak = totals.indexOf(Math.max(...totals));

  if (ui.table) {
    root.append(el("table", {},
      el("thead", {}, el("tr", {}, ["Week of", ...categories, "Total"].map((name) => el("th", {}, name)))),
      el("tbody", {}, weeks.map((week, index) => el("tr", {},
        el("td", {}, dayLabel(week.key)),
        week.counts.map((count) => el("td", {}, String(count))),
        el("td", {}, String(totals[index])))))));
    return;
  }

  if (categories.length > 1) {
    root.append(el("div", { class: "legend" }, categories.map((name, index) =>
      el("span", {}, el("i", { class: "key", style: `background:${colorFor(categories, index)}` }), name))));
  }
  const tip = el("div", { class: "tip" });
  const plot = el("div", { class: "plot" }, tip);
  root.append(plot);

  const selected = weeks.findIndex((week) => ui.drill?.key === `week:${week.key}`);
  if (selected >= 0) root.append(weekDrill(view, weeks[selected]!, categories));

  const draw = () => {
    const width = plot.clientWidth;
    if (width === 0) return;
    const height = 180;
    const pad = { bottom: 22, left: 28, right: 4, top: 18 };
    const innerW = width - pad.left - pad.right;
    const innerH = height - pad.top - pad.bottom;
    const max = totals[peak]!;
    const step = max > 50 ? 20 : max > 20 ? 10 : 5;
    const yMax = Math.ceil(max / step) * step;
    const y = (value: number) => pad.top + innerH - (value / yMax) * innerH;
    const band = innerW / weeks.length;
    const barW = Math.min(24, band * 0.6);
    const labelEvery = Math.ceil(44 / band);
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("height", String(height));
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `Threads per week by category; peak ${max} in the week of ${dayLabel(weeks[peak]!.key)}`);
    const add = (tag: string, attrs: Record<string, string | number>, text?: string | number) => {
      const node = document.createElementNS(SVG_NS, tag);
      for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
      if (text != null) node.textContent = String(text);
      svg.append(node);
      return node;
    };

    for (let value = 0; value <= yMax; value += step) {
      add("line", { class: value === 0 ? "base" : "grid", x1: pad.left, x2: width - pad.right, y1: y(value), y2: y(value) });
      add("text", { class: "axis-text", "text-anchor": "end", x: pad.left - 8, y: y(value) + 4 }, value);
    }

    weeks.forEach((week, index) => {
      const cx = pad.left + band * index + band / 2;
      const x = cx - barW / 2;
      const dim = selected >= 0 && selected !== index;
      const segments = week.counts.map((count, category) => [count, category] as const).filter(([count]) => count > 0);
      let stacked = 0;
      segments.forEach(([count, category], position) => {
        const y0 = y(stacked);
        const y1 = y(stacked + count);
        stacked += count;
        const fill = { fill: colorFor(categories, category), "fill-opacity": dim ? 0.35 : 1 };
        // 2px surface gap between stacked segments; a 4px rounded data-end on top only.
        if (position === segments.length - 1) {
          const r = Math.min(4, y0 - y1);
          add("path", { ...fill, d: `M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + barW - r} Q${x + barW},${y1} ${x + barW},${y1 + r} V${y0} Z` });
        } else {
          add("rect", { ...fill, height: Math.max(0, y0 - y1 - 2), width: barW, x, y: y1 + 2 });
        }
      });
      if (index % labelEvery === 0) add("text", { class: "axis-text", "text-anchor": "middle", x: cx, y: height - 6 }, dayLabel(week.key));
      if (index === peak) add("text", { class: "peak-label", "text-anchor": "middle", x: cx, y: y(totals[index]!) - 6 }, totals[index]!);

      const hit = add("rect", {
        "aria-label": `Week of ${dayLabel(week.key)}: ${totals[index]} threads`,
        class: `hit${index === selected ? " active" : ""}`,
        height: innerH, role: "button", tabindex: 0, width: band, x: pad.left + band * index, y: pad.top,
      });
      const show = () => {
        const hot = topSubcategory(week.threads);
        tip.replaceChildren(
          el("b", {}, `Week of ${dayLabel(week.key)} · ${totals[index]}`),
          ...segments.slice().reverse().map(([count, category]) => el("div", { class: "line" },
            el("i", { class: "key", style: `background:${colorFor(categories, category)}` }),
            el("span", {}, categories[category]!), el("span", {}, String(count)))),
          ...(hot ? [el("div", { class: "line muted" }, el("span", {}, `Mostly about ${hot}`))] : []));
        tip.classList.add("on");
        const tipW = tip.offsetWidth;
        const left = cx + band / 2 + 8 + tipW > width ? cx - band / 2 - 8 - tipW : cx + band / 2 + 8;
        tip.style.left = `${Math.max(0, left)}px`;
        tip.style.top = `${pad.top}px`;
      };
      const hide = () => tip.classList.remove("on");
      hit.addEventListener("mouseenter", show);
      hit.addEventListener("focus", show);
      hit.addEventListener("mouseleave", hide);
      hit.addEventListener("blur", hide);
      hit.addEventListener("click", () => select(`week:${week.key}`));
      hit.addEventListener("keydown", (event) => { if ((event as KeyboardEvent).key === "Enter") select(`week:${week.key}`); });
    });

    plot.querySelector("svg")?.remove();
    plot.prepend(svg);
  };

  draw();
  ui.observer = new ResizeObserver(draw);
  ui.observer.observe(plot);
}

// The rows already carry titles and reply counts, so this drill needs no server call.
function weekDrill(view: Activity, week: Week, categories: string[]): HTMLElement {
  const label = dayLabel(week.key);
  const colorOf = (row: ActivityRow) => {
    const index = categories.indexOf(row.category);
    return colorFor(categories, index >= 0 ? index : categories.length - 1);
  };
  const top = [...week.threads].sort((left, right) => right.replies - left.replies).slice(0, 5);
  return drillPanel<ActivityRow[]>({
    actions: (rows) => rows.length === 0 ? [] : [button("Summarise this week", () =>
      askModel(`Summarise what ${view.course} discussed on the forum in the week of ${label}`))],
    body: (rows) => rows.length === 0 ? el("div", { class: "loading" }, "No new threads this week.") : el("ul", { class: "digest" }, rows.map((row) => el("li", {},
      el("i", { class: "key", style: `background:${colorOf(row)}` }),
      el("span", { class: "t", title: row.title }, row.title),
      el("span", { class: "m" }, `${row.replies} ${row.replies === 1 ? "reply" : "replies"}`)))),
    key: `week:${week.key}`,
    load: () => Promise.resolve(top),
    title: `Week of ${label}`,
  });
}

// ---------- show_lesson_progress ----------

// Only released modules are drawn; one series (completed), so no legend.
// Ed lessons carry no due dates, so there is deliberately no deadline list.
function renderProgress(view: Progress): void {
  if (view.modules.length === 0) {
    root.append(header("Lesson progress", `${view.course} has no Ed lessons`));
    return;
  }
  const released = view.modules.filter((module) => module.openedAt);
  const latest = released.at(-1);
  const behind = released.slice(0, -1).reduce((sum, module) => sum + module.total - module.completed, 0);
  const unreleased = view.modules.length - released.length;

  root.append(header("Lesson progress",
    `${view.course} · ${behind} unfinished ${behind === 1 ? "lesson" : "lessons"} before the latest topic`, true));

  if (ui.table) {
    root.append(el("table", {},
      el("thead", {}, el("tr", {}, ["Module", "Opened", "Completed", "Total"].map((name) => el("th", {}, name)))),
      el("tbody", {}, view.modules.map((module) => el("tr", {},
        el("td", {}, module.name),
        el("td", {}, module.openedAt ? dayLabel(module.openedAt) : "not released"),
        el("td", {}, String(module.completed)),
        el("td", {}, String(module.total)))))));
    return;
  }

  const rows = el("div", { class: "rows" });
  for (const module of released) {
    const key = `module:${module.name}`;
    const open = ui.drill?.key === key;
    const done = module.completed / module.total;
    rows.append(el("div", { "aria-expanded": String(open), class: `row${open ? " selected" : ""}`, ...clickable(() => select(key)) },
      el("span", { class: "row-label", title: module.name }, module.name),
      el("div", { "aria-label": `${module.name}: ${module.completed} of ${module.total} completed`, class: "meter", role: "img" },
        done > 0 ? el("i", { style: `width:${done * 100}%` }) : null),
      el("span", { class: "row-count" }, module === latest ? `latest · ${module.completed}/${module.total}` : `${module.completed}/${module.total}`)));
    if (open) rows.append(el("div", { class: "row-drill" }, moduleDrill(view, module, key)));
  }
  root.append(rows);
  if (unreleased) {
    root.append(el("p", { class: "meta", style: "margin-top:10px" },
      `${unreleased} more ${unreleased === 1 ? "module" : "modules"} not released yet`));
  }
}

function moduleDrill(view: Progress, module: ProgressModule, key: string): HTMLElement {
  const left = module.unfinished.length;
  return drillPanel<ProgressModule["unfinished"]>({
    actions: (lessons) => lessons.length === 0 ? [] : [
      button("Teach me this topic", () => askModel(`Teach me ${module.name} from ${view.course}`), true),
      button("Which ones matter?", () =>
        askModel(`Which unfinished lessons in ${view.course} ${module.name} actually matter?`)),
    ],
    body: (lessons) => lessons.length === 0
      ? el("div", { class: "loading" }, "Nothing left in this module.")
      : el("ul", { class: "digest plain" }, lessons.map((lesson) => el("li", {},
        el("span", { class: "t", title: lesson.title }, lesson.title),
        lesson.status === "attempted" ? el("span", { class: "m" }, "started") : null))),
    key,
    load: () => Promise.resolve(module.unfinished),
    title: left === 1 ? "1 lesson left" : `${left} lessons left`,
  });
}

// ---------- show_lesson_guide (Teach me) ----------

// One card, one thing at a time: a section, then a question, then the result.
function renderGuide(view: Guide): void {
  const steps = view.sections.length;
  const inQuiz = ui.step >= steps;
  const position = !inQuiz ? `${ui.step + 1}/${steps}` : ui.q < view.quiz.length ? `Quiz ${ui.q + 1}/${view.quiz.length}` : "";

  root.append(el("div", { class: "w-head" },
    el("h2", { class: "w-title" }, view.lesson.module || view.lesson.title),
    el("span", { class: "meta" }, position)));

  if (!inQuiz) renderSection(view, ui.step);
  else if (ui.q < view.quiz.length) renderQuestion(view.quiz[ui.q]!, ui.q);
  else renderResult(view);
}

function renderSection(view: Guide, index: number): void {
  const section = view.sections[index]!;
  const last = index === view.sections.length - 1;
  root.append(
    el("h3", { class: "section-title" }, section.title),
    el("ul", { class: "points" }, section.points.map((point) => el("li", {}, point))),
    el("div", { class: "nav" },
      index > 0 ? el("button", { class: "link", onclick: () => { ui.step -= 1; render(); }, type: "button" }, "Back") : el("span"),
      last && view.quiz.length === 0
        ? null
        : button(last ? "Start quiz" : "Next", () => { ui.step += 1; render(); }, true)));
}

function renderQuestion(question: GuideQuestion, index: number): void {
  const pick = ui.picks[index];
  const answered = pick !== undefined;
  root.append(
    el("p", { class: "question" }, question.question),
    el("div", { class: "options" }, question.options.map((option, choice) => {
      const state = !answered ? "" : choice === question.answer ? "right" : choice === pick ? "wrong" : "idle";
      return el("button", {
        class: state,
        disabled: answered,
        onclick: () => { ui.picks[index] = choice; render(); },
        type: "button",
      },
      el("span", {}, option),
      state === "right" ? el("span", { class: "mark" }, "✓") : state === "wrong" ? el("span", { class: "mark" }, "✗") : null);
    })),
    ...(answered ? [
      el("p", { class: "why" }, question.why),
      el("div", { class: "nav" }, el("span"), button("Next", () => { ui.q += 1; render(); }, true)),
    ] : []));
}

function renderResult(view: Guide): void {
  const missed = view.quiz
    .map((question, index) => ({ index, question }))
    .filter(({ index, question }) => ui.picks[index] !== question.answer);
  const edQuiz = view.edQuizSlides > 0
    ? ` This lesson's own quiz is still yours to do in Ed.`
    : "";
  root.append(el("div", {},
    el("p", { class: "score" }, `${view.quiz.length - missed.length} of ${view.quiz.length} right`),
    missed.length
      ? el("ul", { class: "digest plain" }, missed.map(({ question }) => el("li", {},
        el("span", { class: "t", title: question.question }, question.question),
        el("button", { class: "link", onclick: () => { ui.step = question.section; render(); }, type: "button" }, "Review"))))
      : null,
    el("p", { class: "meta" }, `Practice questions written by the assistant, not Ed's marking.${edQuiz}`),
    missed.length
      ? el("div", { class: "nav" }, el("span"), button("Go over my mistakes", () => askModel(
        `Go over the practice questions I got wrong in "${view.lesson.title}":\n` +
        missed.map(({ index, question }) =>
          `- ${question.question} I picked "${question.options[ui.picks[index]!]}", the answer is "${question.options[question.answer]}".`
        ).join("\n")), true))
      : null));
}
