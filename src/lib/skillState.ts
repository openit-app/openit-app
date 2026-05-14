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

/// Delete the on-disk skill-state file for `skill`. Idempotent: if the
/// file isn't there, this is a no-op. Used on app startup to clear
/// stale paste-state from a prior Claude session — the chat that was
/// asking for a token is gone, so the persisted dock value can't
/// belong to anyone the user can still answer.
export async function skillStateClear(
  repo: string,
  skill: string,
): Promise<void> {
  return invoke("skill_state_clear", { repo, skill });
}


/// Inject a slash command (or any line of text) into the active
/// Claude PTY and commit it. `writeToActiveSession` does the
/// body / Enter split internally so a Windows TUI doesn't absorb
/// the terminating `\r` as a newline-in-input.
export async function injectIntoChat(text: string): Promise<boolean> {
  const trimmed = text.endsWith("\n") || text.endsWith("\r") ? text : `${text}\r`;
  return writeToActiveSession(trimmed);
}
