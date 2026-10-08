import { execFile } from "node:child_process";

import { ED_REGIONS, type EdRegion } from "./regions.js";

// Hands the URL to the OS launcher, so the person's default browser and profile are used.
export async function openTokenPage(region: EdRegion, platform = process.platform): Promise<void> {
  const url = ED_REGIONS[region].tokenUrl;
  const [command, args] = platform === "darwin"
    ? ["/usr/bin/open", [url]]
    : platform === "win32"
      ? ["rundll32.exe", ["url.dll,FileProtocolHandler", url]]
      : ["xdg-open", [url]];

  await new Promise<void>((resolve, reject) => {
    execFile(command, args, { timeout: 5_000, windowsHide: true }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
