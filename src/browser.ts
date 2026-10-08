import { execFile } from "node:child_process";

import { tokenPageUrl, type EdRegion } from "./regions.js";

const MAC_BROWSERS = [
  { id: "com.google.Chrome", name: "Google Chrome" },
  { id: "com.microsoft.edgemac", name: "Microsoft Edge" },
  { id: "com.brave.Browser", name: "Brave" },
  { id: "com.apple.Safari", name: "Safari" },
] as const;

// A new tab in the existing Ed window uses that window's browser profile.
// Only tab URLs are inspected; cookies and session credentials stay in the browser.
export async function openTokenPage(region: EdRegion, platform = process.platform): Promise<string | undefined> {
  const url = tokenPageUrl(region);
  if (platform === "darwin") {
    for (const browser of MAC_BROWSERS) {
      try {
        const result = await runCommand("/usr/bin/osascript", [
          "-e", existingEdWindowScript(browser.id), url, `https://edstem.org/${region}/`,
        ]);
        if (result.trim() === "opened") return browser.name;
      } catch {
        // Unsupported scripting, denied automation, or a closed browser: try the next one.
      }
    }
    await runCommand("/usr/bin/open", [url]);
  } else if (platform === "win32") {
    await runCommand("rundll32.exe", ["url.dll,FileProtocolHandler", url]);
  } else {
    await runCommand("xdg-open", [url]);
  }
  return undefined;
}

function runCommand(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 5_000, windowsHide: true }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

function existingEdWindowScript(browserId: string): string {
  const selectNewTab = browserId === "com.apple.Safari"
    ? "set current tab of edWindow to newTab"
    : "set active tab index of edWindow to (count of tabs of edWindow)";
  return `on run argv
  set targetUrl to item 1 of argv
  set regionPrefix to item 2 of argv
  if application id "${browserId}" is not running then return "none"
  tell application id "${browserId}"
    repeat with prefix in {regionPrefix, "https://edstem.org/"}
      repeat with edWindow in windows
        repeat with edTab in tabs of edWindow
          set tabUrl to ""
          try
            set tabUrl to URL of edTab
          end try
          if tabUrl starts with (contents of prefix) then
            set newTab to make new tab at end of tabs of edWindow with properties {URL:targetUrl}
            ${selectNewTab}
            set index of edWindow to 1
            activate
            return "opened"
          end if
        end repeat
      end repeat
    end repeat
  end tell
  return "none"
end run`;
}
