// Skill side-channel: a small JSON file at
// `<repo>/.openit/skill-state/<skill>.json` that lets a skill (driven
// by Claude in chat) tell the FE about ephemeral UI state that
// doesn't fit cleanly in chat.
//
// Today there is exactly one such piece of state: which secret-paste
// affordance the chat-anchored SkillActionDock should surface, if
// any. Tokens can't go through chat history, so the dock is the
// off-ramp for them. Everything else the user does happens in chat.
//
// History note: this used to be a much richer "Skill Canvas" state
// with steps, titles, action kinds, etc. We collapsed to a single
// `dock` field after realizing the canvas was a second narrator
// competing with Claude — see auto-dev/plans/2026-04-29-* for the
// design rationale.

import { invoke } from "@tauri-apps/api/core";
import { writeToActiveSession } from "../shell/activeSession";

/// Which secret-paste affordance the chat-anchored dock should
/// surface. `null` (or absent) means the dock renders nothing.
export type DockKind = "bot-token-paste" | "app-token-paste" | null;

export type SkillState = {
  /// Stable skill identifier — also the file name under
  /// `.openit/skill-state/`. Must match the skill's slash-command
  /// (without the `/`).
  skill: string;
  /// The dock affordance to show, if any.
  dock?: DockKind;
};

// The Tauri commands keep their original names for backwards-
// compatibility with the existing Rust handlers in `skill_canvas.rs`.
// They're plain JSON file read/write — the field shape is the FE's
// concern, not Rust's.

export async function skillStateRead(
  repo: string,
  skill: string,
): Promise<SkillState | null> {
  return invoke("skill_state_read", { repo, skill });
}


/// Inject a slash command (or any line of text) into the active
/// Claude PTY and commit it. Sends the body and the Enter keypress
/// as two separate writes so Claude Code's TUI doesn't treat them
/// as a single paste — when they rode in the same write on Windows,
/// the trailing `\r` was being absorbed as a newline-in-input and
/// `/answer-ticket <path>` got submitted with the path on a new line
/// (skill saw no argument, globbed, and replied to the wrong ticket).
/// No-op (with a console warning) when no Claude session is active.
export async function injectIntoChat(text: string): Promise<boolean> {
  const body = text.replace(/[\r\n]+$/, "");
  const ok = await writeToActiveSession(body);
  if (!ok) return false;
  // 50ms is enough for the TUI to flush the paste buffer before the
  // Enter keypress arrives; longer feels laggy.
  await new Promise((r) => setTimeout(r, 50));
  return writeToActiveSession("\r");
}
