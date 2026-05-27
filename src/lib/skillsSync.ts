import { invoke } from "@tauri-apps/api/core";
import { basename } from "./paths";

export type Skill = {
  name: string;
  description: string;
  path: string;
};

export type Bubble = {
  label: string;
  skill: string;
};

export type PluginManifest = {
  version?: string;
  files: Array<{ path: string }>;
  bubbles?: Array<Bubble>;
};

/// Path of the on-disk version sentinel relative to repo root. Tracks the
/// `manifest.version` of the most recent successful bundled-plugin sync
/// so relaunches can tell when the bundle has rolled forward and
/// re-sync is needed (without nuking user edits to non-plugin files).
const PLUGIN_VERSION_SENTINEL = ".openit/plugin-version";

/// Tombstone-by-diff sentinel. Records the set of `seed/commands/<name>.md`
/// bundled command names that landed on disk during the previous sync. The
/// gate in `syncSkillsToDisk` reads this on the next sync and uses it to
/// distinguish "file missing because the user deleted it" (skip — respect
/// the deletion) from "file missing because it's a newly-shipped bundled
/// command" (write). Without this, every re-sync resurrects defaults the
/// user removed in Finder.
const SYNCED_SEED_COMMANDS_SENTINEL = ".openit/synced-seed-commands.json";

/// Read the version of the last successful sync. Returns null when the
/// sentinel is missing or unreadable — the caller treats that as
/// "out-of-date" so a fresh sync runs on first launch under a new build.
export async function readSyncedPluginVersion(repo: string): Promise<string | null> {
  try {
    const raw = await invoke<string>("fs_read", { path: `${repo}/${PLUGIN_VERSION_SENTINEL}` });
    const trimmed = raw.trim();
    return trimmed || null;
  } catch {
    return null;
  }
}

async function writeSyncedPluginVersion(repo: string, version: string): Promise<void> {
  try {
    await invoke("entity_write_file", {
      repo,
      subdir: ".openit",
      filename: "plugin-version",
      content: version,
    });
  } catch (err) {
    console.warn("[skillsSync] failed to write plugin-version sentinel:", err);
  }
}

/// Read the set of bundled command names persisted by the previous sync.
/// Returns null when the sentinel is missing or unreadable — the caller
/// treats null as "first sync ever on this vault" and writes all bundled
/// commands. Returns an empty set if the file is present but malformed,
/// which is the conservative choice: an empty set means "we have no record
/// the user ever saw any of these defaults," so every missing file is
/// treated as new and gets written.
export async function readSyncedSeedCommands(repo: string): Promise<Set<string> | null> {
  try {
    const raw = await invoke<string>("fs_read", { path: `${repo}/${SYNCED_SEED_COMMANDS_SENTINEL}` });
    const parsed = JSON.parse(raw) as { commands?: unknown };
    if (!Array.isArray(parsed.commands)) return new Set();
    return new Set(parsed.commands.filter((c): c is string => typeof c === "string"));
  } catch {
    return null;
  }
}

async function writeSyncedSeedCommands(repo: string, commands: string[]): Promise<void> {
  try {
    await invoke("entity_write_file", {
      repo,
      subdir: ".openit",
      filename: "synced-seed-commands.json",
      content: JSON.stringify({ commands: [...commands].sort() }, null, 2),
    });
  } catch (err) {
    console.warn("[skillsSync] failed to write synced-seed-commands sentinel:", err);
  }
}

/// Fetch the manifest. Always reads the bundled copy shipped with the app
/// binary. Cloud-served plugin fetch is disabled until dev is stable —
/// re-enable by restoring the `creds` branch that calls
/// `skills_fetch_manifest` (Rust command stays registered).
export async function fetchSkillsManifest(
  _creds?: unknown,
): Promise<PluginManifest> {
  const manifestJson = await invoke<string>("skills_fetch_bundled_manifest");
  return JSON.parse(manifestJson);
}

export async function fetchSkillFile(
  skillPath: string,
  _creds?: unknown,
): Promise<string> {
  return await invoke<string>("skills_fetch_bundled_file", { skillPath });
}

/// Resolve where on disk a manifest file lands. Returns { subdir, filename }
/// relative to the repo root, or null to skip writing this file.
///
/// Database/agent dirs use stable, slug-free names so the layout matches
/// the user's mental model and stays consistent if they later connect to
/// cloud (the engine maps these to `<colName>-<orgId>` collections at
/// push time; the local layout doesn't change).
///
/// Routing rules:
///   - `CLAUDE.md`                          → `CLAUDE.md` (repo root)
///   - `claude-md.template.md` (legacy)     → `CLAUDE.md` (repo root)
///   - `instructions/<file>.md`             → `.openit/instructions/<file>.md`
///                                              (system files for Claude, kept
///                                              out of the user's main file
///                                              tree alongside other `.openit/`
///                                              runtime state)
///   - `skills/<name>.md`                   → `.claude/skills/<name>/SKILL.md`
///   - `schemas/<col>._schema.json`         → `databases/<col>/_schema.json`
///   - `agents/<name>.template.json`        → `agents/<name>.json`
///   - `scripts/<file>`                     → `.claude/scripts/<file>`
///   - `seed/commands/<name>.md`            → `filestores/commands/<name>.md`
///                                              (write-once; admin edits in
///                                              place)
///   - `seed/<target>/...`                  → `.claude/seed/<target>/...`
///                                              (staged on disk so
///                                              `load-sample-data.mjs` can
///                                              copy from a known location;
///                                              never written directly into
///                                              the vault by the plugin sync)
///   - anything else                        → preserve original layout
///
/// `substituteSlug` is no longer set by any current rule (the slug
/// suffix on dirs was dropped) but the field is kept for future per-
/// file substitution if needed.
export function routeFile(
  filePath: string,
  _slug: string,
): { subdir: string; filename: string; substituteSlug: boolean } | null {
  if (filePath === "CLAUDE.md" || filePath === "claude-md.template.md") {
    return { subdir: "", filename: "CLAUDE.md", substituteSlug: false };
  }
  // PIN-6614 follow-up: per-topic instruction files seeded by the plugin
  // belong next to the other Claude/runtime system files under `.openit/`,
  // not at the vault root where they appear in the user's file explorer
  // alongside their own content (`databases/`, `filestores/`, ...). The
  // CLAUDE.md index lives at the vault root and links into
  // `.openit/instructions/` explicitly.
  if (filePath.startsWith("instructions/") && filePath.endsWith(".md")) {
    const filename = filePath.replace("instructions/", "");
    return {
      subdir: ".openit/instructions",
      filename,
      substituteSlug: false,
    };
  }
  // Canonical command bodies bundled at `commands/<name>.md` are mirrored
  // into `.claude/skills/<name>/SKILL.md` — Claude Code's plugin loader
  // hard-codes that exact path to invoke `/name`. The admin never edits
  // this copy; they edit `filestores/commands/<name>.md` (the seed flow
  // below writes that), and `skillMirror` keeps the `.claude/skills/`
  // path in sync on save.
  if (filePath.startsWith("commands/") && filePath.endsWith(".md")) {
    const commandName = filePath.replace("commands/", "").replace(".md", "");
    return {
      subdir: `.claude/skills/${commandName}`,
      filename: "SKILL.md",
      substituteSlug: false,
    };
  }
  if (filePath.startsWith("schemas/") && filePath.endsWith("._schema.json")) {
    const colName = filePath
      .replace("schemas/", "")
      .replace("._schema.json", "");
    return {
      subdir: `databases/${colName}`,
      filename: "_schema.json",
      substituteSlug: false,
    };
  }
  // Agent markdown files: agents/triage.md → agents/triage.md
  // Only matches top-level .md files (not nested like agents/triage/common.md)
  if (filePath.startsWith("agents/") && filePath.endsWith(".md") && !filePath.slice("agents/".length).includes("/")) {
    const filename = filePath.replace("agents/", "");
    return { subdir: "agents", filename, substituteSlug: false };
  }
  // Legacy: agents/triage/triage.template.json (V2 era, no longer in manifest)
  if (filePath.startsWith("agents/") && filePath.endsWith(".template.json")) {
    const lastSlash = filePath.lastIndexOf("/");
    const subdir = filePath.slice(0, lastSlash);
    const filename = filePath
      .slice(lastSlash + 1)
      .replace(".template.json", ".json");
    return { subdir, filename, substituteSlug: false };
  }
  if (filePath.startsWith("scripts/")) {
    const filename = filePath.replace("scripts/", "");
    return { subdir: ".claude/scripts", filename, substituteSlug: false };
  }
  // Seed commands are admin-facing slash commands (salesforce-gmail,
  // backup, onboard, offboard, etc.) that must be available on every
  // fresh install — not gated behind `/load-sample-data`. Route them
  // to `filestores/commands/` so they appear in the Commands tile.
  // The sync loop applies a write-once gate (same as agents) so re-
  // syncs don't clobber user-customized versions.
  if (filePath.startsWith("seed/commands/") && filePath.endsWith(".md")) {
    const filename = filePath.replace("seed/commands/", "");
    return { subdir: "filestores/commands", filename, substituteSlug: false };
  }
  // Optional sample data (tickets, people, conversations, etc.) lands
  // under `.claude/seed/<target>/` on disk so `load-sample-data.mjs`
  // can copy it into the vault on demand. Preserves the seed/ subtree
  // shape (e.g. seed/conversations/<ticketId>/<file> → .claude/seed/
  // conversations/<ticketId>/<file>). `src/lib/seed.ts::seedIfEmpty`
  // independently reads from the bundled manifest, so it keeps working
  // for the `openit://create-samples` CTA without depending on disk.
  if (filePath.startsWith("seed/")) {
    const rel = filePath.replace("seed/", "");
    const lastSlash = rel.lastIndexOf("/");
    if (lastSlash < 0) return null;
    return {
      subdir: `.claude/seed/${rel.slice(0, lastSlash)}`,
      filename: rel.slice(lastSlash + 1),
      substituteSlug: false,
    };
  }
  // Default: preserve manifest layout under repo root.
  const parts = filePath.split("/");
  const filename = parts.pop() ?? filePath;
  const subdir = parts.length > 0 ? parts.join("/") : "";
  return { subdir, filename, substituteSlug: false };
}

/// Probe disk for an existing file. Used by the agent write-once gate
/// below — once the user has edited `agents/openit-triage.json`, every
/// future plugin version bump must leave their edits alone. `fsRead`
/// throws on missing → false; any other failure path also returns
/// false so a transient read error doesn't permanently block re-sync.
async function fileExistsOnDisk(
  repo: string,
  subdir: string,
  filename: string,
): Promise<boolean> {
  try {
    const path = subdir ? `${repo}/${subdir}/${filename}` : `${repo}/${filename}`;
    await invoke<string>("fs_read", { path });
    return true;
  } catch {
    return false;
  }
}

function ensureSkillFrontmatter(skillName: string, content: string): string {
  if (content.startsWith("---")) return content;
  const nameMatch = content.match(/^name:\s*(.+?)$/m);
  const descMatch = content.match(/^description:\s*(.+?)$/m);
  // `||` not `??` — a `description:` line that's present but empty (or
  // whitespace-only after trim) should still fall back to the skill
  // name, not write an empty description into the frontmatter.
  const skillTitle = nameMatch?.[1]?.trim() || skillName;
  const description = descMatch?.[1]?.trim() || skillName;
  return `---\nname: ${skillTitle}\ndescription: ${description}\n---\n\n${content}`;
}

export async function syncSkillsToDisk(
  repo: string,
  creds?: unknown,
  onLog?: (msg: string) => void,
): Promise<{ bubbles: Bubble[] }> {
  // Slug = repo basename. Same value used by kbSync / datastoreSync to
  // suffix collection names. Keeps schemas/agents/databases all aligned.
  const slug = basename(repo) || repo;
  // Diagnostic log written to `.openit/sync-log.json` at end of sync.
  // Captures per-file outcome so failures aren't trapped in the renderer's
  // dev-only console (which is hard to access on Windows during onboarding).
  type SyncLogEntry = {
    path: string;
    stage: "route" | "preserved" | "fetch" | "write" | "ok";
    subdir?: string;
    filename?: string;
    error?: string;
  };
  const syncLog: SyncLogEntry[] = [];

  try {
    const manifest = await fetchSkillsManifest(creds);
    let skillCount = 0;
    let fileCount = 0;
    const bubbleCount = (manifest.bubbles ?? []).length;
    const writtenPaths: string[] = [];

    // Tombstone-by-diff for seed commands. `previousSeedCommands` is what
    // the previous sync persisted on this vault (null on first install).
    // `currentSeedCommands` is the set of bundled command names in this
    // manifest version — we persist it at the end so the next sync can
    // tell "user deleted this" apart from "never seeded this." Without
    // this gate, every missing file in `filestores/commands/` looks the
    // same to the write-once check below and gets resurrected.
    const previousSeedCommands = await readSyncedSeedCommands(repo);
    const currentSeedCommands = new Set<string>();
    for (const file of manifest.files) {
      if (file.path.startsWith("seed/commands/") && file.path.endsWith(".md")) {
        currentSeedCommands.add(file.path.replace("seed/commands/", "").replace(".md", ""));
      }
    }

    for (const file of manifest.files) {
      let stage: SyncLogEntry["stage"] = "route";
      try {
        const route = routeFile(file.path, slug);
        if (!route) { syncLog.push({ path: file.path, stage: "route" }); continue; }
        // Write-once gate for agent files. The plugin sync runs on every
        // version bump; without this, an upgrade silently overwrites
        // user-edited `agents/<name>.json` instructions. Agents are the
        // only manifest-routed destination the user edits in place — KB
        // articles / scripts / schemas are managed by Claude or the
        // plugin, not free-text user input.
        if (route.subdir === "agents" || route.subdir.startsWith("agents/")) {
          if (await fileExistsOnDisk(repo, route.subdir, route.filename)) {
            console.debug(
              `[skillsSync] preserved user-edited ${route.subdir}/${route.filename}`,
            );
            syncLog.push({ path: file.path, stage: "preserved", subdir: route.subdir, filename: route.filename });
            continue;
          }
        }
        // Write-once gate for seed commands (filestores/commands/). These
        // are admin-customizable slash commands — once the user has edited
        // one, the plugin sync must leave their version in place.
        if (route.subdir === "filestores/commands") {
          if (await fileExistsOnDisk(repo, route.subdir, route.filename)) {
            console.debug(
              `[skillsSync] preserved user-edited ${route.subdir}/${route.filename}`,
            );
            syncLog.push({ path: file.path, stage: "preserved", subdir: route.subdir, filename: route.filename });
            continue;
          }
          // Tombstone gate: file is missing on disk. If we know this command
          // was synced previously, the user has since deleted it (in Finder
          // or via the app) — respect the deletion instead of resurrecting
          // it. New bundled commands (not in the previous set) and the
          // first-install case (previousSeedCommands === null) both fall
          // through and get written below.
          const commandName = file.path.replace("seed/commands/", "").replace(".md", "");
          if (previousSeedCommands !== null && previousSeedCommands.has(commandName)) {
            console.debug(
              `[skillsSync] respecting user deletion of ${route.subdir}/${route.filename}`,
            );
            syncLog.push({ path: file.path, stage: "preserved", subdir: route.subdir, filename: route.filename });
            continue;
          }
        }
        stage = "fetch";
        let content = await fetchSkillFile(file.path, creds);
        if (route.substituteSlug) {
          content = content.replace(/\{\{slug\}\}/g, slug);
        }
        if (file.path.startsWith("commands/") && file.path.endsWith(".md")) {
          const commandName = file.path.replace("commands/", "").replace(".md", "");
          content = ensureSkillFrontmatter(commandName, content);
          skillCount += 1;
        } else {
          fileCount += 1;
        }
        stage = "write";
        await invoke("entity_write_file", {
          repo,
          subdir: route.subdir,
          filename: route.filename,
          content,
        });
        syncLog.push({ path: file.path, stage: "ok", subdir: route.subdir, filename: route.filename });
        const relPath = route.subdir ? `${route.subdir}/${route.filename}` : route.filename;
        // Skip paths that .gitignore rejects (.claude/, CLAUDE.md). Passing
        // them to `git add` is fatal — git refuses the entire add list with
        // "paths are ignored by one of your .gitignore files", which then
        // blocks the auto-commit of the non-ignored siblings.
        const isGitignored =
          relPath.startsWith(".claude/") ||
          relPath === "CLAUDE.md" ||
          relPath.startsWith(".openit/");
        if (!isGitignored) writtenPaths.push(relPath);
        console.debug(`[skillsSync] Synced ${file.path} → ${relPath}`);
      } catch (err) {
        console.warn(`[skillsSync] Failed to sync ${file.path} (stage=${stage}):`, err);
        onLog?.(`  ✗ ${file.path}: ${err}`);
        syncLog.push({ path: file.path, stage, error: String(err) });
      }
    }

    // Persist diagnostic log so failures on Windows / locked-down envs
    // surface somewhere the user can `cat` without opening DevTools.
    try {
      await invoke("entity_write_file", {
        repo,
        subdir: ".openit",
        filename: "sync-log.json",
        content: JSON.stringify({ version: manifest.version, entries: syncLog }, null, 2),
      });
    } catch (err) {
      console.warn("[skillsSync] failed to write sync-log.json:", err);
    }

    // Roll the synced files into a commit so a fresh bootstrap doesn't
    // surface bundled scaffolding as "untracked changes" in the Deploy
    // panel. git_commit_paths is a no-op when nothing in `paths` has
    // changed, so this stays clean on subsequent re-syncs.
    if (writtenPaths.length > 0) {
      try {
        await invoke("git_commit_paths", {
          repo,
          paths: writtenPaths,
          message: "init: bundled plugin",
        });
      } catch (err) {
        console.warn("[skillsSync] commit of bundled plugin failed:", err);
      }
    }

    if (manifest.version) {
      await writeSyncedPluginVersion(repo, manifest.version);
    }

    // Persist the bundled-command set this sync was responsible for so the
    // next sync can diff against it (see the tombstone gate above). We
    // always write the full current set, not the union with the previous
    // set — bundled commands that were dropped from the manifest are no
    // longer something we care about preserving deletions for.
    await writeSyncedSeedCommands(repo, [...currentSeedCommands]);

    onLog?.(`    ${fileCount} file(s), ${skillCount} skill(s), ${bubbleCount} bubble(s) — synced`);
    return { bubbles: manifest.bubbles ?? [] };
  } catch (error) {
    console.error("[skillsSync] syncSkillsToDisk failed:", error);
    onLog?.(`    ✗ manifest fetch failed: ${error}`);
    return { bubbles: [] };
  }
}
