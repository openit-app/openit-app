// Single source of truth for "what counts as a slash command" in OpenIT.
//
// The Commands tile counter (Workbench) and the Commands viewer
// (SkillsStation) used to compute their lists from two different filters,
// so the sidebar could read "Commands 6" while the viewer rendered 3
// entries. The drift came from two separate filters that disagreed on
// dedup, `.server.` files, and history snapshots.
//
// This module is the only place that decides what's a command. Both the
// counter and the viewer pull from it so the number and the list always
// agree.

import { fsList, type FileNode } from "./api";
import { isDirectChild } from "./paths";

export interface CommandRef {
  /** Stem name without the trailing `.md` (or the dir name for skills). */
  name: string;
  /** Absolute path to the SKILL.md / .md file. */
  path: string;
  /** Where the command was discovered. System commands win on dedup. */
  source: "system" | "custom";
}

/// Return the canonical list of commands for a vault, in stable order.
///
/// Discovery rules (matched by the Commands viewer):
///   * System commands — direct child *directories* of `.claude/skills/`.
///     The presence of a `SKILL.md` is not required (the viewer renders
///     them either way; missing description just shows blank).
///   * Custom commands — direct child `.md` *files* of
///     `filestores/commands/`. Files inside subdirectories (e.g.
///     `filestores/commands/<slug>/_history/<ts>.md` snapshots from the
///     "commands learn in place" pattern) are intentionally excluded
///     because they are not commands themselves.
///   * `.server.<ext>` sidecar files are excluded — they are runtime
///     metadata, not commands.
///   * Hidden files / `_history` / `_schema.json` etc. are excluded by
///     the direct-child / `.md` check or by the explicit `.server.`
///     guard.
///   * When a name exists in both buckets, the system entry wins (it's
///     the curated copy) and the duplicate is dropped.
///
/// Errors from `fs_list` are swallowed (the folder may not exist on a
/// fresh vault) and treated as "no entries" for that source.
export async function listCommands(repo: string): Promise<CommandRef[]> {
  const [system, custom] = await Promise.all([
    listSystemCommands(repo),
    listCustomCommands(repo),
  ]);

  const seen = new Set<string>();
  const out: CommandRef[] = [];
  // System first so it wins on name collisions.
  for (const e of system) {
    if (!seen.has(e.name)) {
      seen.add(e.name);
      out.push(e);
    }
  }
  for (const e of custom) {
    if (!seen.has(e.name)) {
      seen.add(e.name);
      out.push(e);
    }
  }
  return out;
}

/// Convenience wrapper for callers that only need the count.
export async function countCommands(repo: string): Promise<number> {
  return (await listCommands(repo)).length;
}

// ── Internals ────────────────────────────────────────────────────────

async function listSystemCommands(repo: string): Promise<CommandRef[]> {
  const root = `${repo}/.claude/skills`;
  let nodes: FileNode[];
  try {
    nodes = await fsList(root);
  } catch {
    return [];
  }
  return nodes
    .filter((n) => n.is_dir && isDirectChild(root, n.path))
    .map((d) => ({
      name: d.name,
      path: `${d.path}/SKILL.md`,
      source: "system" as const,
    }));
}

async function listCustomCommands(repo: string): Promise<CommandRef[]> {
  const root = `${repo}/filestores/commands`;
  let nodes: FileNode[];
  try {
    nodes = await fsList(root);
  } catch {
    return [];
  }
  return nodes
    .filter((n) => {
      if (n.is_dir) return false;
      if (!isDirectChild(root, n.path)) return false;
      if (n.name.startsWith(".")) return false;
      if (n.name.includes(".server.")) return false;
      return n.name.endsWith(".md");
    })
    .map((f) => ({
      name: f.name.replace(/\.md$/, ""),
      path: f.path,
      source: "custom" as const,
    }));
}
