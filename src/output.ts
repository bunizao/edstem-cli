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
