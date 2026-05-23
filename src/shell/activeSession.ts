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

// Serializes PTY writes so two concurrent `writeToActiveSession`
// callers don't interleave their body+enter pairs at the terminal.
// Without this, two back-to-back calls would race:
//   ptyWrite(bodyA) → ptyWrite(bodyB) → sleep(50) → enter for A →
//   sleep(50) → enter for B
// producing `bodyA + bodyB + \r + \r` at the prompt — one garbled
// merged submission plus an empty newline. Chain everything off a
// single shared promise so the second call sees the first's enter
// before starting its body. (Independent reviewer finding, PIN-6607.)
let writeChain: Promise<unknown> = Promise.resolve();

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
///
/// Concurrent callers are serialized via an internal promise chain —
/// see `writeChain` above.
export async function writeToActiveSession(text: string): Promise<boolean> {
  if (!activeSessionId) {
    console.warn(
      "[activeSession] no active Claude session — paste dropped. Make sure Claude is running in the right pane.",
    );
    return false;
  }
  // Dispatch to whatever session is active when this queued job
  // actually runs — NOT the session captured at enqueue. The
  // user's intent is "send to the current Claude session," and if
  // they swapped sessions while another write was in flight, the
  // new session is the right target. Only return false if NO
  // session is active at run time. (BugBot iter-10 finding —
  // previous behaviour returned false on any id mismatch, even
  // when a new session was live, which surfaced a misleading
  // "Claude session not active" toast.)
  const run = async (): Promise<boolean> => {
    const liveSessionId = activeSessionId;
    if (!liveSessionId) {
      console.warn(
        "[activeSession] active session cleared between enqueue and run — dropping queued write.",
      );
      return false;
    }
    const m = text.match(/^([\s\S]*?)([\r\n]+)$/);
    if (m) {
      const [, body, enter] = m;
      if (body.length > 0) {
        await ptyWrite(liveSessionId, body);
        await new Promise((r) => setTimeout(r, 50));
      }
      await ptyWrite(liveSessionId, enter);
      return true;
    }
    await ptyWrite(liveSessionId, text);
    return true;
  };
  // Chain off the previous write so body+enter pair runs without
  // interleaving. Swallow any rejection inside the chain itself so
  // one caller's failure doesn't poison the chain for the next.
  const result = writeChain.then(run, run);
  writeChain = result.catch(() => undefined);
  return result;
}
