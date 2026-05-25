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
  /**
   * True when the user explicitly added this tile via the right-click
   * "Add to workstation" action. Untagged tiles in `more` are assumed
   * to be legacy auto-discovered entries and may be removed by the
   * one-shot reset on load. Primitives in `main` ignore this flag —
   * they're always defaults.
   */
  userPinned?: boolean;
}

export interface WorkstationConfig {
  /** Tiles pinned to the main workstation area, in order. */
  main: TileConfig[];
  /** Tiles in the "More" pool, in order. */
  more: TileConfig[];
}

// ── Primitives ───────────────────────────────────────────────────────

/// The eight primitive tile rels that make up the workstation hero.
///
/// Per user direction (2026-05-24): the workstation surfaces ONLY these
/// eight primitives by default. Sub-stores (People, Access, Assets,
/// Scripts, Library, Attachments, ...) never auto-appear — the user
/// pins them explicitly via the right-click "Add to workstation" action
/// on the primitive's overview viewer.
///
/// `filestores/commands` is treated as a primitive even though on disk
/// it lives under `filestores/` — Commands is the IT admin's daily
/// driver and earned its own top-level tile.
/// Primitives that ship pinned to MAIN by default. The IT admin sees
/// these three tiles the moment they open a fresh vault; everything
/// else lives in MORE so the front page stays scannable.
export const PRIMITIVE_MAIN_RELS: ReadonlyArray<string> = [
  "tasks",
  "knowledge",
  "filestores/commands",
];

/// Primitives that ship pinned to MORE by default. Still primitives —
/// the user can move them into MAIN if they want, and they're not
/// strippable by the auto-discovery cleanup.
export const PRIMITIVE_MORE_RELS: ReadonlyArray<string> = [
  "reports",
  "filestores",
  "databases",
  "tools",
  "traces",
];

/// All eight primitives. Used by the "is this a primitive?" check and
/// by the reset logic that rejects non-primitive tiles in MAIN.
export const PRIMITIVE_RELS: ReadonlyArray<string> = [
  ...PRIMITIVE_MAIN_RELS,
  ...PRIMITIVE_MORE_RELS,
];

const PRIMITIVE_SET: ReadonlySet<string> = new Set(PRIMITIVE_RELS);

export function isPrimitiveRel(rel: string): boolean {
  return PRIMITIVE_SET.has(rel);
}

// ── Defaults ─────────────────────────────────────────────────────────

/// Default workstation = three primitives in MAIN
/// (Tasks / Knowledge / Commands), the remaining five primitives in
/// MORE. Sub-stores (Access, Assets, Scripts, etc.) stay invisible
/// until the user explicitly pins them via right-click.
export const DEFAULT_WORKSTATION_CONFIG: WorkstationConfig = {
  main: PRIMITIVE_MAIN_RELS.map((rel) => ({ rel })),
  more: PRIMITIVE_MORE_RELS.map((rel) => ({ rel, userPinned: true })),
};

// ── Load / Save ──────────────────────────────────────────────────────

/// Returns true when `main` contains any tile that is NOT one of the
/// eight primitives — a strong signal the saved config predates the
/// 2026-05-24 primitives-only layout. We reset such configs so users
/// stuck on the legacy layouts (Tasks/Knowledge/Commands,
/// six-primitives-plus-People, etc.) get the new defaults without
/// having to delete `.openit/workstation.json` by hand.
function mainHasNonPrimitive(main: TileConfig[]): boolean {
  return main.some((t) => !PRIMITIVE_SET.has(t.rel));
}

/// Returns true when `main` contains any primitive that should live in
/// MORE by default (i.e., one of the five non-main primitives). When
/// this fires we move those tiles into MORE rather than letting MAIN
/// balloon — keeps the workstation focused on the three daily-driver
/// primitives (Tasks / Knowledge / Commands).
function mainHasMorePrimitive(main: TileConfig[]): boolean {
  const moreSet = new Set(PRIMITIVE_MORE_RELS);
  return main.some((t) => moreSet.has(t.rel));
}

/// Strip tiles from `main` whose rel belongs in MORE by default and
/// append them to `more` (with `userPinned: true` so they survive the
/// next reset). Used when a legacy config had all eight primitives in
/// main — we keep them visible, just relocate to where they belong.
function relocateMorePrimitives(
  main: TileConfig[],
  more: TileConfig[],
): { main: TileConfig[]; more: TileConfig[] } {
  const moreSet = new Set(PRIMITIVE_MORE_RELS);
  const moreRelsAlready = new Set(more.map((t) => t.rel));
  const stayingInMain: TileConfig[] = [];
  const relocated: TileConfig[] = [];
  for (const t of main) {
    if (moreSet.has(t.rel) && !moreRelsAlready.has(t.rel)) {
      relocated.push({ ...t, userPinned: true });
    } else if (!moreSet.has(t.rel)) {
      stayingInMain.push(t);
    }
    // else: already represented in more, drop the duplicate.
  }
  return { main: stayingInMain, more: [...more, ...relocated] };
}

/// Returns true when `main` is missing one or more primitives. We
/// re-add the missing ones in-place so partial configs (e.g. saved
/// before a new primitive was introduced) get filled out.
function mainMissingPrimitive(main: TileConfig[]): boolean {
  const present = new Set(main.map((t) => t.rel));
  return PRIMITIVE_MAIN_RELS.some((p) => !present.has(p));
}

/// Append any missing primitives to `main`, preserving the user's
/// existing order. Used when `main` is partial (had some primitives
/// but not all) — we want to keep what they had and just fill the
/// gaps rather than wipe the whole list.
function appendMissingPrimitives(main: TileConfig[]): TileConfig[] {
  const present = new Set(main.map((t) => t.rel));
  const out = [...main];
  for (const rel of PRIMITIVE_MAIN_RELS) {
    if (!present.has(rel)) out.push({ rel });
  }
  return out;
}

/// Strip MORE entries that lack the `userPinned` flag. The flag is
/// only ever set by the right-click "Add to workstation" action; any
/// entry without it was auto-discovered into MORE by the pre-2026-05-24
/// merge logic and should be removed so a fresh vault shows MORE empty.
function stripAutoDiscoveredMore(more: TileConfig[]): TileConfig[] {
  return more.filter((t) => t.userPinned === true || PRIMITIVE_SET.has(t.rel));
}

export async function loadWorkstationConfig(
  repo: string,
): Promise<WorkstationConfig> {
  try {
    const raw = await fsRead(`${repo}/.openit/workstation.json`);
    const parsed = JSON.parse(raw);
    const config = parseWorkstationConfig(parsed);

    // One-shot reset for vaults still on a pre-2026-05-24 layout.
    //
    // Trigger criteria (any one is enough):
    //   1. `main` contains any non-primitive tile (e.g. legacy People
    //      pin, custom sub-store in main) — likely legacy auto-derived
    //      shape, wipe main back to the eight primitives.
    //   2. `main` is missing one or more primitives — re-add them
    //      while preserving the user's existing order.
    //   3. `more` contains any entry without `userPinned: true` — all
    //      such entries came from the old auto-discovery merge; strip
    //      them so MORE starts empty.
    //
    // Tradeoff: this is intentionally aggressive. Users who manually
    // arranged auto-discovered tiles in MORE and expected them to
    // persist (rare, since MORE was never customisable) will lose
    // that arrangement on first load after upgrade. They can re-pin
    // each one via right-click → "Add to workstation".
    let nextMain = config.main;
    let nextMore = config.more;
    let changed = false;

    if (mainHasNonPrimitive(nextMain)) {
      nextMain = structuredClone(DEFAULT_WORKSTATION_CONFIG.main);
      nextMore = structuredClone(DEFAULT_WORKSTATION_CONFIG.more);
      changed = true;
    } else if (mainHasMorePrimitive(nextMain)) {
      // Legacy 8-primitives-in-main shape. Relocate the 5 non-main
      // primitives to MORE (preserving any visual overrides), keep
      // the 3 main primitives in MAIN.
      const relocated = relocateMorePrimitives(nextMain, nextMore);
      nextMain = relocated.main;
      nextMore = relocated.more;
      // Also re-add the 3 main primitives if any got dropped.
      if (mainMissingPrimitive(nextMain)) {
        nextMain = appendMissingPrimitives(nextMain);
      }
      changed = true;
    } else if (mainMissingPrimitive(nextMain)) {
      nextMain = appendMissingPrimitives(nextMain);
      changed = true;
    }

    const strippedMore = stripAutoDiscoveredMore(nextMore);
    if (strippedMore.length !== nextMore.length) {
      nextMore = strippedMore;
      changed = true;
    }

    if (changed) {
      const reset: WorkstationConfig = { main: nextMain, more: nextMore };
      // Persist so subsequent loads skip the migration entirely.
      // Failure is non-fatal — the in-memory reset still applies for
      // this session.
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

/// Append a tile to MORE, marking it `userPinned: true` so the next
/// reset preserves it. No-op when the tile is already pinned somewhere
/// (main or more). Persists the updated config.
export async function pinTileToWorkstation(
  repo: string,
  rel: string,
  extras?: { label?: string; icon?: string; tone?: ToneKey; description?: string },
): Promise<void> {
  const cfg = await loadWorkstationConfig(repo);
  if (cfg.main.some((t) => t.rel === rel)) return;
  if (cfg.more.some((t) => t.rel === rel)) {
    // Already in MORE — upgrade to userPinned so a future reset spares
    // it. Merge any new visual overrides while we're here.
    cfg.more = cfg.more.map((t) =>
      t.rel === rel ? { ...t, ...extras, userPinned: true } : t,
    );
  } else {
    cfg.more.push({ rel, ...extras, userPinned: true });
  }
  await saveWorkstationConfig(repo, cfg);
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
  if (typeof o.rel !== "string" || o.rel.length === 0) return false;
  // `userPinned` is optional — accept missing or boolean, reject other
  // types so a malformed config can't accidentally suppress the reset.
  if ("userPinned" in o && typeof o.userPinned !== "boolean") return false;
  return true;
}

// ── Discovery ────────────────────────────────────────────────────────
// Scan the filesystem to find all available stores. Each store maps to
// a potential workstation tile. Sub-stores discovered here are NOT
// auto-surfaced as tiles — `mergeConfigWithDiscovery` only resolves
// tiles the config explicitly references. The discovery is still
// needed so that:
//   - the resolver knows the label/icon/tone/countMode for a pinned
//     sub-store
//   - navigation into `databases/people` etc. still routes correctly
//     elsewhere in the app (sourcing from FileExplorer)
//   - the right-click "Add to workstation" action has metadata to
//     copy onto the new MORE entry

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
/// Every entry here is one of the eight top-level primitives (per the
/// 2026-05-24 primitives-only layout). Sub-stores (People, Scripts,
/// ...) are discovered from disk below but not surfaced as tiles
/// unless explicitly pinned.
const SYSTEM_TILES: DiscoveredTile[] = [
  // The eight primitives, in canonical order.
  { rel: "tasks",              label: "Tasks",     defaultIcon: "checklist", defaultTone: "accent",  countMode: "files" },
  { rel: "knowledge",          label: "Knowledge", defaultIcon: "knowledge", defaultTone: "ochre",   countMode: "files" },
  { rel: "filestores/commands", label: "Commands", defaultIcon: "commands",  defaultTone: "accent",  countMode: "files" },
  { rel: "reports",            label: "Reports",   defaultIcon: "reports",   defaultTone: "link",    countMode: "files" },
  { rel: "filestores",         label: "Filestores", defaultIcon: "folder",   defaultTone: "neutral", countMode: "dirs"  },
  { rel: "databases",          label: "Databases", defaultIcon: "database",  defaultTone: "link",    countMode: "dirs"  },
  { rel: "tools",              label: "Tools",     defaultIcon: "tools",     defaultTone: "accent",  countMode: "custom" },
  { rel: "traces",             label: "Traces",    defaultIcon: "traces",    defaultTone: "neutral", countMode: "dirs"  },
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
  try {
    const fsItems = await fsList(`${repo}/filestores`);
    const fsDirs = directChildDirs(fsItems, `${repo}/filestores`);
    for (const dir of fsDirs) {
      // `filestores/commands` is already a primitive in SYSTEM_TILES —
      // skip the discovered copy to avoid a duplicate entry.
      if (dir.name === "commands") continue;
      const known = KNOWN_FS_DEFAULTS[dir.name];
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

  // System + primitive tiles
  tiles.push(...SYSTEM_TILES);

  return tiles;
}

// ── Merge ────────────────────────────────────────────────────────────
// Combine the persisted config with filesystem discovery to produce the
// final tile lists. Config-referenced tiles that no longer exist on disk
// are silently dropped.
//
// NOTE (2026-05-24): unlike the pre-primitives-only behaviour, discovered
// tiles that are NOT in the config are NOT auto-appended to MORE. The
// user pins sub-stores explicitly via right-click → "Add to workstation"
// (see `pinTileToWorkstation`).

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

  return { main, more };
}
