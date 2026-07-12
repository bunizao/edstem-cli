import { spawnSync } from "node:child_process";

import { VERSION } from "./version.js";
import type { FetchLike } from "./ed/client.js";

const PACKAGE_NAME = "edstem-cli";

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  upgradeCommand: string;
}

export async function checkForUpdate(fetchImpl: FetchLike = globalThis.fetch): Promise<UpdateInfo> {
  const response = await fetchImpl(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`npm registry returned HTTP ${response.status}`);
  }
  const payload = await response.json() as { version?: unknown };
  if (typeof payload.version !== "string") {
    throw new Error("npm registry response is missing a version");
  }
  return {
    currentVersion: VERSION,
    latestVersion: payload.version,
    updateAvailable: compareVersions(payload.version, VERSION) > 0,
    upgradeCommand: `npm install -g ${PACKAGE_NAME}@latest`,
  };
}

export function applyUpdate(): string {
  const command = ["npm", "install", "-g", `${PACKAGE_NAME}@latest`];
  const result = spawnSync(command[0], command.slice(1), { stdio: "inherit" });
  if (result.error) {
    throw new Error(`Failed to launch npm: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${command.join(" ")} exited with status ${result.status ?? "unknown"}`);
  }
  return command.join(" ");
}

export function compareVersions(left: string, right: string): number {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  return 0;
}

function parseVersion(value: string): number[] {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(value.trim());
  if (!match) throw new Error(`Invalid version: ${value}`);
  return match.slice(1).map(Number);
}
