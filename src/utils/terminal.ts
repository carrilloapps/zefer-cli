/**
 * Terminal capability detection.
 *
 * Windows cmd.exe and some legacy terminals can't render Unicode > U+00FF,
 * braille patterns (U+2800–U+28FF), or block elements (U+2580–U+259F).
 * We detect this and fall back to ASCII equivalents.
 *
 * Detection heuristic (no external deps):
 *   - TERM=dumb          → ASCII
 *   - CI=true            → ASCII (no spinners needed)
 *   - Windows + no WT    → ASCII (legacy cmd.exe / conhost without Windows Terminal)
 *   - Everything else    → Unicode
 *
 * Users can override with:
 *   ZEFER_ASCII=1   → force ASCII
 *   ZEFER_UNICODE=1 → force Unicode
 */

function detect(): boolean {
  if (process.env.ZEFER_ASCII) return false;
  if (process.env.ZEFER_UNICODE) return true;
  if (process.env.TERM === "dumb") return false;
  if (process.env.CI) return false;

  // Windows: support Unicode only in Windows Terminal (WT_SESSION set) or VS Code terminal
  if (process.platform === "win32") {
    return !!(process.env.WT_SESSION || process.env.TERM_PROGRAM === "vscode");
  }

  return true;
}

export const supportsUnicode = detect();

// ─── Spinner frames ───

export const SPINNER_FRAMES = supportsUnicode
  ? ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
  : ["-", "\\", "|", "/"];

// ─── Progress bar characters ───

export const BAR_FILLED = supportsUnicode ? "█" : "#";
export const BAR_EMPTY = supportsUnicode ? "░" : "-";

// ─── Icons ───

export const ICON_OK = supportsUnicode ? "✓" : "OK";
export const ICON_ERR = supportsUnicode ? "✗" : "ERR";
export const ICON_ARROW = supportsUnicode ? "▸" : ">";
export const ICON_SEP = supportsUnicode ? "─" : "-";
