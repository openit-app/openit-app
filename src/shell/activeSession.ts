import { ptyWrite } from "../lib/terminal";

let activeSessionId: string | null = null;

export function setActiveSession(id: string) {
  activeSessionId = id;
}

export function clearActiveSession(id: string) {
  if (activeSessionId === id) {
    activeSessionId = null;
  }
}

/// Write text into whatever PTY is currently active (the visible Claude session).
/// Resolves silently when no session is active so UI never crashes from a bubble click.
/// Returns true if a session was active and the write was issued.
///
/// When the text ends with a newline (`\r`, `\n`, or `\r\n`), the
/// terminating Enter is sent as a *separate* write after a 50ms
/// gap. Claude Code's TUI on Windows treats a single bulk write that
/// contains both body and Enter as a paste with embedded newline —
/// leaving the command staged at the prompt instead of submitting.
/// Splitting it makes the Enter look like a real keypress.
export async function writeToActiveSession(text: string): Promise<boolean> {
  if (!activeSessionId) {
    console.warn(
      "[activeSession] no active Claude session — paste dropped. Make sure Claude is running in the right pane.",
    );
    return false;
  }
  const m = text.match(/^([\s\S]*?)([\r\n]+)$/);
  if (m) {
    const [, body, enter] = m;
    if (body.length > 0) {
      await ptyWrite(activeSessionId, body);
      await new Promise((r) => setTimeout(r, 50));
    }
    await ptyWrite(activeSessionId, enter);
    return true;
  }
  await ptyWrite(activeSessionId, text);
  return true;
}
