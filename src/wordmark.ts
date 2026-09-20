import type { Ui } from "@bunizao/cli-kit";

export const EDSTEM_TAGLINE = "Read and post on Ed Discussion from the command line.";

// figlet "Small"; kept as lines so the backslashes and the backtick survive as typed.
export const EDSTEM_WORDMARK = [
  "         _    _",
  "  ___ __| |__| |_ ___ _ __",
  " / -_) _` (_-<  _/ -_) '  \\",
  " \\___\\__,_/__/\\__\\___|_|_|_|",
].join("\n");

let shown = false;

/** The wordmark opens the first guided step of a run and no other, however many steps follow. */
export function showWordmark(ui: Ui): void {
  if (shown) return;
  shown = true;
  ui.banner(EDSTEM_WORDMARK, EDSTEM_TAGLINE);
}
