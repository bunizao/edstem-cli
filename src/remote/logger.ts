export interface Logger {
  debug(fields?: Record<string, unknown>, message?: string): void;
  error(fields?: Record<string, unknown>, message?: string): void;
  info(fields?: Record<string, unknown>, message?: string): void;
  warn(fields?: Record<string, unknown>, message?: string): void;
}

export function createLogger(level: string = "info"): Logger {
  const threshold = levelRank(level);

  return {
    debug: (fields, message) => log("debug", threshold, fields, message),
    error: (fields, message) => log("error", threshold, fields, message),
    info: (fields, message) => log("info", threshold, fields, message),
    warn: (fields, message) => log("warn", threshold, fields, message)
  };
}

function log(
  level: "debug" | "info" | "warn" | "error",
  threshold: number,
  fields?: Record<string, unknown>,
  message?: string
): void {
  if (levelRank(level) < threshold) {
    return;
  }

  const entry = {
    ...fields,
    level: levelRank(level),
    msg: message ?? "",
    time: Date.now()
  };

  const line = JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
    return;
  }
  console.log(line);
}

function levelRank(level: string): number {
  switch (level) {
    case "debug":
      return 10;
    case "info":
      return 20;
    case "warn":
      return 30;
    case "error":
      return 40;
    default:
      return 20;
  }
}
