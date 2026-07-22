import { writeFile } from "node:fs/promises";

import { CliError } from "./errors.js";

export interface OutputOptions {
  fields?: string;
  output?: string;
  pretty?: boolean;
}

export async function writeJson(
  value: unknown,
  options: OutputOptions = {},
  write = (text: string): void => {
    process.stdout.write(text);
  }
): Promise<void> {
  const selected = selectFields(value, options.fields);
  const text = `${JSON.stringify(selected, null, options.pretty ? 2 : undefined)}\n`;
  if (options.output) {
    await writeFile(options.output, text, "utf8");
    return;
  }
  write(text);
}

export async function writeText(
  value: string,
  output: string | undefined,
  write = (text: string): void => {
    process.stdout.write(text);
  }
): Promise<void> {
  const text = value.endsWith("\n") ? value : `${value}\n`;
  if (output) {
    await writeFile(output, text, "utf8");
    return;
  }
  write(text);
}

export async function writeHuman(
  value: unknown,
  output: string | undefined,
  write = (text: string): void => {
    process.stdout.write(text);
  }
): Promise<void> {
  await writeText(formatHuman(value), output, write);
}

export function selectFields(value: unknown, fields?: string): unknown {
  if (!fields) {
    return value;
  }
  const selectedFields = fields.split(",").map((field) => field.trim()).filter(Boolean);
  if (selectedFields.length === 0) {
    throw new CliError("input", "--fields requires at least one field name", 2);
  }
  if (Array.isArray(value)) {
    return value.map((item) => selectObjectFields(item, selectedFields));
  }
  return selectObjectFields(value, selectedFields);
}

function selectObjectFields(value: unknown, fields: string[]): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const record = value as Record<string, unknown>;
  return Object.fromEntries(fields.filter((field) => field in record).map((field) => [field, record[field]]));
}

export function writeError(
  error: CliError,
  write = (text: string): void => {
    process.stderr.write(text);
  }
): void {
  write(`${JSON.stringify({ error: { code: error.code, message: error.message } })}\n`);
}

function formatHuman(value: unknown): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return "No results.";
    const records = value.filter(isRecord);
    if (records.length !== value.length) return JSON.stringify(value, null, 2);
    const preferred = ["id", "number", "code", "name", "title", "type", "status", "role", "flags"];
    const available = new Set(records.flatMap((record) => Object.keys(record)));
    const columns = preferred.filter((field) => available.has(field));
    if (columns.length === 0) return JSON.stringify(value, null, 2);
    const widths = columns.map((column) => Math.min(48, Math.max(
      column.length,
      ...records.map((record) => displayValue(record[column]).length)
    )));
    const row = (record: Record<string, unknown>): string => columns
      .map((column, index) => displayValue(record[column]).slice(0, widths[index]).padEnd(widths[index]))
      .join("  ")
      .trimEnd();
    const header = Object.fromEntries(columns.map((column) => [column, column.toUpperCase()]));
    return [row(header), ...records.map(row)].join("\n");
  }
  if (isRecord(value)) {
    return Object.entries(value).map(([key, item]) => `${key}: ${displayValue(item)}`).join("\n");
  }
  return String(value ?? "");
}

function displayValue(value: unknown): string {
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value.join(", ");
  }
  if (value && typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value ?? "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
