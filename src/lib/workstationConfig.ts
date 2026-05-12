// `.openit/workstation.json` — persisted workstation layout.
//
// Tracks which tiles appear in the main workstation vs the "More" pool,
// their order, and any visual overrides (icon, tone, label). The file
// is optional — a fresh vault renders the default layout. Partial
// overrides merge with defaults.
//
// The `rel` field on each tile is the repo-relative path that doubles as
// the tile's identity (e.g. `databases/people`, `filestores/skills`,
// `knowledge-bases`). System primitives use their canonical paths too
// (`agents`, `tools`, `.openit/agent-traces`).

import { fsRead, fsList, entityWriteFile, type FileNode } from "./api";
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

export const DEFAULT_WORKSTATION_CONFIG: WorkstationConfig = {
  main: [
    { rel: "knowledge-bases" },
    { rel: "filestores/skills" },
  ],
  more: [
    { rel: "reports" },
    { rel: "databases/people" },
    { rel: "databases/access" },
    { rel: "databases/assets" },
    { rel: "agents" },
    { rel: "filestores/scripts" },
    { rel: "tools" },
    { rel: "databases" },
    { rel: "filestores" },
    { rel: ".openit/agent-traces" },
  ],
};

// ── Load / Save ──────────────────────────────────────────────────────

export async function loadWorkstationConfig(
  repo: string,
): Promise<WorkstationConfig> {
  try {
    const raw = await fsRead(`${repo}/.openit/workstation.json`);
    const parsed = JSON.parse(raw);
    return parseWorkstationConfig(parsed);
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

function parseWorkstationConfig(raw: unknown): WorkstationConfig {
  if (!raw || typeof raw !== "object") {
    return structuredClone(DEFAULT_WORKSTATION_CONFIG);
  }
  const r = raw as Record<string, unknown>;
  const main = Array.isArray(r.main)
    ? r.main.filter(isTileConfig)
    : structuredClone(DEFAULT_WORKSTATION_CONFIG.main);
  const more = Array.isArray(r.more)
    ? r.more.filter(isTileConfig)
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

/** Well-known tiles that exist regardless of filesystem state. */
const SYSTEM_TILES: DiscoveredTile[] = [
  { rel: "agents",               label: "Agents",      defaultIcon: "agents",      defaultTone: "accent",  countMode: "files" },
  { rel: "tools",                label: "Tools",       defaultIcon: "tools",       defaultTone: "accent",  countMode: "custom" },
  { rel: ".openit/agent-traces", label: "Traces",      defaultIcon: "traces",      defaultTone: "neutral", countMode: "dirs" },
  { rel: "databases",            label: "Databases",   defaultIcon: "database",    defaultTone: "link",    countMode: "dirs" },
  { rel: "filestores",           label: "Filestores",  defaultIcon: "folder",      defaultTone: "neutral", countMode: "dirs" },
];

/** Well-known database collections with custom defaults. */
const KNOWN_DB_DEFAULTS: Record<string, { label: string; icon: string; tone: ToneKey }> = {
  people:        { label: "People",   icon: "person",   tone: "sage" },
  access:        { label: "Access",   icon: "access",   tone: "sage" },
  assets:        { label: "Assets",   icon: "assets",   tone: "clay" },
  tickets:       { label: "Inbox",    icon: "inbox",    tone: "accent" },
};

/** Well-known filestore collections with custom defaults. */
const KNOWN_FS_DEFAULTS: Record<string, { label: string; icon: string; tone: ToneKey; openRel?: string }> = {
  skills:      { label: "Commands",    icon: "commands",    tone: "accent" },
  scripts:     { label: "Scripts",     icon: "scripts",     tone: "link" },
  library:     { label: "Library",     icon: "folder",      tone: "neutral" },
  attachments: { label: "Attachments", icon: "attachments", tone: "neutral" },
};

/** Capitalize first letter. */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function directChildDirs(items: FileNode[], rootAbs: string): FileNode[] {
  // Normalize separators — see comment in Workbench.directChildren.
  const root = rootAbs.replace(/\\/g, "/");
  const prefix = `${root}/`;
  return items.filter((n) => {
    if (!n.is_dir) return false;
    const p = n.path.replace(/\\/g, "/");
    if (!p.startsWith(prefix)) return false;
    const tail = p.slice(prefix.length);
    return tail.length > 0 && !tail.includes("/");
  });
}

export async function discoverTiles(repo: string): Promise<DiscoveredTile[]> {
  const tiles: DiscoveredTile[] = [];

  // Knowledge bases — only if the folder exists on disk
  try {
    await fsList(`${repo}/knowledge-bases`);
    tiles.push({
      rel: "knowledge-bases",
      label: "Knowledge",
      defaultIcon: "knowledge",
      defaultTone: "ochre",
      countMode: "files",
    });
  } catch { /* folder doesn't exist — skip */ }

  // Reports — only if the folder exists on disk
  try {
    await fsList(`${repo}/reports`);
    tiles.push({
      rel: "reports",
      label: "Reports",
      defaultIcon: "reports",
      defaultTone: "link",
      countMode: "files",
    });
  } catch { /* folder doesn't exist — skip */ }

  // Discover database collections
  try {
    const dbItems = await fsList(`${repo}/databases`);
    const dbDirs = directChildDirs(dbItems, `${repo}/databases`);
    for (const dir of dbDirs) {
      if (dir.name === "conversations") continue; // hidden, tied to tickets
      if (dir.name === "tickets") continue; // inbox hero card handles this
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

  // Always synthesize the Commands tile (filestores/skills) so it appears
  // in a fresh vault even before the folder is materialized — it's a core
  // workstation tile pinned to `main` in the default config.
  if (!fsSeen.has("skills")) {
    const known = KNOWN_FS_DEFAULTS.skills;
    tiles.push({
      rel: "filestores/skills",
      label: known.label,
      defaultIcon: known.icon,
      defaultTone: known.tone,
      countMode: "files",
    });
  }

  // System tiles
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
