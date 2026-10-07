import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export function defaultStateFile(): string {
  return join(homedir(), ".config", "edstem-cli", "state.json");
}

async function readState(path: string): Promise<Record<string, string>> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  const state: unknown = JSON.parse(raw);
  if (!state || typeof state !== "object" || Array.isArray(state) ||
    Object.entries(state).some(([id, time]) => !/^\d+$/.test(id) ||
      typeof time !== "string" || Number.isNaN(Date.parse(time)))) {
    throw new Error(`Invalid thread cursor state in ${path}.`);
  }
  return state as Record<string, string>;
}

export async function readThreadCursor(courseId: number, started: Date, path: string): Promise<Date> {
  const time = (await readState(path))[String(courseId)];
  return time ? new Date(time) : new Date(started.getTime() - 7 * 86400000);
}

export async function saveThreadCursor(courseId: number, started: Date, path: string): Promise<void> {
  const state = await readState(path);
  const previous = state[String(courseId)];
  state[String(courseId)] = previous && Date.parse(previous) > started.getTime()
    ? previous : started.toISOString();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
