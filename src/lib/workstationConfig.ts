// `.openit/workstation.json` — persisted workstation layout.
//
// Tracks which tiles appear in the main workstation vs the "More" pool,
// their order, and any visual overrides (icon, tone, label). The file
// is optional — a fresh vault renders the default layout. Partial
// overrides merge with defaults.
//
// The `rel` field on each tile is the repo-relative path that doubles as
// the tile's identity (e.g. `databases/people`, `filestores/commands`,
// `knowledge`). System primitives use their canonical paths too
// (`tools`, `traces`).

import { fsRead, fsList, entityWriteFile, type FileNode } from "./api";
import { isDirectChild } from "./paths";
import type { ToneKey } from "../shell/entityIcons";

// ── Types ────────────────────────────────────────────────────────────

export interface TileConfig {
  /** Repo-relative path — the tile's identity. */
  rel: string;
  /** Display label override. */
  label?: string;
  /** Icon key from the ICON_GALLERY. */
  icon?: string;
  /** Color tone override. */
  tone?: ToneKey;
  /** Short description shown on list-view cards. */
  description?: string;
}

export interface WorkstationConfig {
  /** Tiles pinned to the main workstation area, in order. */
  main: TileConfig[];
  /** Tiles in the "More" pool, in order. */
  more: TileConfig[];
}

// ── Defaults ─────────────────────────────────────────────────────────

/// Default workstation = exactly the six primitives.
///
/// Decision (2026-05): the workstation surfaces ONLY the top-level
/// primitive container folders. Each tile opens its primitive's
/// overview, where the admin drills into the sub-stores. Anything else
/// (People, Access, Scripts, Library, ...) lives in the "More" pool and
/// the file explorer — never on the main hero.
///
/// The six primitives:
///   1. databases/   — JSON-row collections
///   2. filestores/  — file collections (library, commands, scripts, ...)
///   3. knowledge/   — markdown KB articles
///   4. reports/     — generated markdown reports
///   5. tasks/       — flat task list (PIN-6605)
///   6. traces/      — agent activity audit log
export const DEFAULT_WORKSTATION_CONFIG: WorkstationConfig = {
  main: [
    { rel: "databases" },
    { rel: "filestores" },
    { rel: "knowledge" },
    { rel: "reports" },
    { rel: "tasks" },
    { rel: "traces" },
  ],
  // Everything else stays available in the "More" pool. Existing
  // sub-store tiles get discovered automatically from disk by
  // `discoverTiles` and appended here on first load — listing them
  // explicitly would force them to materialise even on vaults that
  // never created them.
  more: [
    { rel: "tools" },
  ],
};

// ── Load / Save ──────────────────────────────────────────────────────

/// Old (pre-2026-05-23) default main set — Tasks / Knowledge / Commands.
/// Any vault whose persisted config matches this exact shape gets
/// auto-reset to the new 6-primitive default. We gate on the precise
/// historical layout so customised configs (a user who chose those
/// three tiles deliberately, or added/removed any others) are left
/// alone. The user can always reset manually by deleting
/// `.openit/workstation.json`.
const LEGACY_DEFAULT_MAIN_RELS: ReadonlyArray<string> = [
  "tasks",
  "knowledge",
  "filestores/commands",
];

function matchesLegacyDefaultMain(main: TileConfig[]): boolean {
  if (main.length !== LEGACY_DEFAULT_MAIN_RELS.length) return false;
  // Order must match too — the old defaults always wrote them in this
  // sequence; a user who reordered them gave explicit intent we
  // shouldn't trample.
  for (let i = 0; i < main.length; i += 1) {
    if (main[i].rel !== LEGACY_DEFAULT_MAIN_RELS[i]) return false;
    // Any visual override (label/icon/tone/description) signals
    // customisation — skip the reset.
    const t = main[i];
    if (t.label || t.icon || t.tone || t.description) return false;
  }
  return true;
}

export async function loadWorkstationConfig(
  repo: string,
): Promise<WorkstationConfig> {
  try {
    const raw = await fsRead(`${repo}/.openit/workstation.json`);
    const parsed = JSON.parse(raw);
    const config = parseWorkstationConfig(parsed);

    // One-shot reset: vaults left on the pre-2026-05-23 defaults
    // (Tasks/Knowledge/Commands) get the new 6-primitive main set.
    // We only touch `main` — the user's `more` pool is preserved so
    // any custom sub-store pins stay intact.
    if (matchesLegacyDefaultMain(config.main)) {
      const reset: WorkstationConfig = {
        main: structuredClone(DEFAULT_WORKSTATION_CONFIG.main),
        more: config.more,
      };
      // Persist so subsequent loads skip the migration entirely.
      // Failure is non-fatal — the in-memory reset still applies
      // for this session.
      saveWorkstationConfig(repo, reset).catch((err) => {
        console.warn("[workstationConfig] reset persist failed:", err);
      });
      return reset;
    }

    return config;
  } catch {
    return structuredClone(DEFAULT_WORKSTATION_CONFIG);
  }
}

export async function saveWorkstationConfig(
  repo: string,
  config: WorkstationConfig,
): Promise<void> {
  await entityWriteFile(
    repo,
    ".openit",
    "workstation.json",
    JSON.stringify(config, null, 2),
  );
}

/// Map legacy tile rels to their renamed counterparts. Used when
/// loading a workstation config that was saved before a UI rename so
/// existing vaults keep their pinned tiles instead of going empty
/// after the underlying folder moves.
const LEGACY_REL_REWRITES: Record<string, string> = {
  "filestores/skills": "filestores/commands",
  "knowledge-bases": "knowledge",
  ".openit/agent-traces": "traces",
  // Ticket model removed in PIN-6605 → replaced by the simpler tasks
  // model. Vaults that pinned the old Inbox tile keep their pin,
  // pointing at the new tasks/ folder.
  "databases/tickets": "tasks",
};

function rewriteLegacyRel(tile: TileConfig): TileConfig {
  const replacement = LEGACY_REL_REWRITES[tile.rel];
  return replacement ? { ...tile, rel: replacement } : tile;
}

/// Drop tile entries whose rel matches a retired primitive.
///
/// `agents` was retired in the 2026-05 reorg — Claude Code is the only
/// agent; the standalone Agents primitive no longer has a tile or
/// viewer. Any saved config that still pins it is stripped on load so
/// the user doesn't see a dead tile. (The `agents/` folder on disk is
/// migrated away by the bootstrap; see project_bootstrap in
/// src-tauri/src/project.rs.)
///
/// Note: `databases` and `filestores` USED to be stripped during the
/// "tiles aren't folder mirrors" era. The 2026-05-23 reorg reversed
/// that — the workstation now shows exactly the 6 primitives, of which
/// `databases/` and `filestores/` are two. So they stay.
const DROPPED_PRIMITIVE_RELS = new Set([
  "agents",
]);

function parseWorkstationConfig(raw: unknown): WorkstationConfig {
  if (!raw || typeof raw !== "object") {
    return structuredClone(DEFAULT_WORKSTATION_CONFIG);
  }
  const r = raw as Record<string, unknown>;
  const cleanup = (arr: unknown): TileConfig[] =>
    Array.isArray(arr)
      ? arr
          .filter(isTileConfig)
          .map(rewriteLegacyRel)
          .filter((t) => !DROPPED_PRIMITIVE_RELS.has(t.rel))
      : [];

  // If `main` becomes empty after cleanup (e.g. the saved tiles all
  // pointed at legacy primitives), fall back to the default main set
  // so the admin doesn't see an empty workstation hero.
  const cleanedMain = cleanup(r.main);
  const main = cleanedMain.length > 0
    ? cleanedMain
    : structuredClone(DEFAULT_WORKSTATION_CONFIG.main);

  const more = Array.isArray(r.more)
    ? cleanup(r.more)
    : structuredClone(DEFAULT_WORKSTATION_CONFIG.more);
  return { main, more };
}

function isTileConfig(v: unknown): v is TileConfig {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.rel === "string" && o.rel.length > 0;
}

// ── Discovery ────────────────────────────────────────────────────────
// Scan the filesystem to find all available stores. Each store maps to
// a potential workstation tile.

export interface DiscoveredTile {
  rel: string;
  /** Auto-derived label from the folder name. */
  label: string;
  /** Default icon key for this type of store. */
  defaultIcon: string;
  /** Default color tone. */
  defaultTone: ToneKey;
  /** How to count direct children. */
  countMode: "dirs" | "json-rows" | "files" | "custom";
  /** If clicking should open a different path than `rel`. */
  openRel?: string;
}

/// Well-known tiles that exist regardless of filesystem state.
///
/// Every entry here is one of the six top-level primitives or a
/// system-synthetic tile. Sub-stores (People, Scripts, ...) are
/// discovered from disk below.
///
/// `agents` is intentionally absent — Claude Code is the only agent;
/// the standalone Agents primitive was retired in the May 2026 tile
/// reorg (PIN-6606).
const SYSTEM_TILES: DiscoveredTile[] = [
  // The four primitive container folders. Each tile opens its
  // primitive's overview viewer (databases-list, filestores-list,
  // entity-folder for knowledge/reports) where the admin drills into
  // sub-stores or individual articles.
  { rel: "databases",  label: "Databases",  defaultIcon: "database",  defaultTone: "link",    countMode: "dirs"  },
  { rel: "filestores", label: "Filestores", defaultIcon: "folder",    defaultTone: "neutral", countMode: "dirs"  },
  { rel: "knowledge",  label: "Knowledge",  defaultIcon: "knowledge", defaultTone: "ochre",   countMode: "files" },
  { rel: "reports",    label: "Reports",    defaultIcon: "reports",   defaultTone: "link",    countMode: "files" },
  // Tasks is the post-PIN-6605 replacement for the ticket model — surfaced as
  // a top-level workstation primitive backed by `tasks/` on disk.
  { rel: "tasks",  label: "Tasks",  defaultIcon: "inbox",  defaultTone: "accent",  countMode: "files" },
  // Traces backs onto the top-level `traces/` folder (the legacy
  // `.openit/agent-traces/` is migrated by project_bootstrap).
  { rel: "traces", label: "Traces", defaultIcon: "traces", defaultTone: "neutral", countMode: "dirs" },
  { rel: "tools",  label: "Tools",  defaultIcon: "tools",  defaultTone: "accent",  countMode: "custom" },
];

/** Well-known database collections with custom defaults. */
const KNOWN_DB_DEFAULTS: Record<string, { label: string; icon: string; tone: ToneKey }> = {
  people:        { label: "People",   icon: "person",   tone: "sage" },
  access:        { label: "Access",   icon: "access",   tone: "sage" },
  assets:        { label: "Assets",   icon: "assets",   tone: "clay" },
};

/** Well-known filestore collections with custom defaults. */
const KNOWN_FS_DEFAULTS: Record<string, { label: string; icon: string; tone: ToneKey; openRel?: string }> = {
  commands:    { label: "Commands",    icon: "commands",    tone: "accent" },
  scripts:     { label: "Scripts",     icon: "scripts",     tone: "link" },
  library:     { label: "Library",     icon: "folder",      tone: "neutral" },
};

/** Capitalize first letter. */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function directChildDirs(items: FileNode[], rootAbs: string): FileNode[] {
  return items.filter((n) => n.is_dir && isDirectChild(rootAbs, n.path));
}

export async function discoverTiles(repo: string): Promise<DiscoveredTile[]> {
  const tiles: DiscoveredTile[] = [];

  // The six primitive tiles (databases, filestores, knowledge, reports,
  // tasks, traces) plus system synthetics (tools) live in SYSTEM_TILES
  // and are always surfaced regardless of filesystem state. The
  // project_bootstrap creates these directories on first launch, and
  // the merge step below only includes config-pinned tiles, so an
  // empty-on-disk primitive still appears with a "0 items" tile.

  // Discover database collections
  try {
    const dbItems = await fsList(`${repo}/databases`);
    const dbDirs = directChildDirs(dbItems, `${repo}/databases`);
    for (const dir of dbDirs) {
      // Legacy ticket folders from older app versions stay on disk but
      // are never surfaced as workstation tiles — the tasks station
      // replaces them. The user can still navigate to the raw JSON via
      // the file explorer if needed.
      if (dir.name === "conversations") continue;
      if (dir.name === "tickets") continue;
      const known = KNOWN_DB_DEFAULTS[dir.name];
      tiles.push({
        rel: `databases/${dir.name}`,
        label: known?.label ?? capitalize(dir.name),
        defaultIcon: known?.icon ?? "database",
        defaultTone: known?.tone ?? "link",
        countMode: "json-rows",
      });
    }
  } catch { /* databases/ may not exist */ }

  // Discover filestore collections
  const fsSeen = new Set<string>();
  try {
    const fsItems = await fsList(`${repo}/filestores`);
    const fsDirs = directChildDirs(fsItems, `${repo}/filestores`);
    for (const dir of fsDirs) {
      const known = KNOWN_FS_DEFAULTS[dir.name];
      fsSeen.add(dir.name);
      tiles.push({
        rel: `filestores/${dir.name}`,
        label: known?.label ?? capitalize(dir.name),
        defaultIcon: known?.icon ?? "folder",
        defaultTone: known?.tone ?? "neutral",
        countMode: "files",
        openRel: known?.openRel,
      });
    }
  } catch { /* filestores/ may not exist */ }

  // Mark fsSeen to allow future synthetic tiles, but the post-2026-05
  // default doesn't pin commands to main, so no fallback insert is
  // needed — the tile materialises naturally once the folder exists.
  void fsSeen;

  // System + primitive tiles
  tiles.push(...SYSTEM_TILES);

  return tiles;
}

// ── Merge ────────────────────────────────────────────────────────────
// Combine the persisted config with filesystem discovery to produce the
// final tile lists. Config-referenced tiles that no longer exist on disk
// are silently dropped. Newly discovered tiles not in config are appended
// to "more".

export interface ResolvedTile {
  rel: string;
  label: string;
  icon: string;
  tone: ToneKey;
  countMode: "dirs" | "json-rows" | "files" | "custom";
  openRel?: string;
}

export function mergeConfigWithDiscovery(
  config: WorkstationConfig,
  discovered: DiscoveredTile[],
): { main: ResolvedTile[]; more: ResolvedTile[] } {
  const discoveredMap = new Map(discovered.map((d) => [d.rel, d]));

  function resolve(tc: TileConfig): ResolvedTile | null {
    const d = discoveredMap.get(tc.rel);
    if (!d) return null; // tile no longer exists on disk
    return {
      rel: d.rel,
      label: tc.label ?? d.label,
      icon: tc.icon ?? d.defaultIcon,
      tone: tc.tone ?? d.defaultTone,
      countMode: d.countMode,
      openRel: d.openRel,
    };
  }

  const main: ResolvedTile[] = [];
  for (const tc of config.main) {
    const r = resolve(tc);
    if (r) main.push(r);
  }

  const more: ResolvedTile[] = [];
  for (const tc of config.more) {
    const r = resolve(tc);
    if (r) more.push(r);
  }

  // Append newly discovered tiles not in config
  const inConfig = new Set([
    ...config.main.map((t) => t.rel),
    ...config.more.map((t) => t.rel),
  ]);
  for (const d of discovered) {
    if (!inConfig.has(d.rel)) {
      more.push({
        rel: d.rel,
        label: d.label,
        icon: d.defaultIcon,
        tone: d.defaultTone,
        countMode: d.countMode,
        openRel: d.openRel,
      });
    }
  }

  return { main, more };
}
