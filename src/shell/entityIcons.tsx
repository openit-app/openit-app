import type { ReactNode } from "react";

/**
 * Shared visual identity for every entity kind.
 *
 * One source of truth that the Workbench stations, the EntityCardGrid
 * cards, and the Viewer headers all consume — so when the user clicks
 * "Tickets" in the Workbench, the resulting page header shows the
 * same icon, the same tone, and the same label. No more orange-tile
 * Workbench fighting a multicolor card grid.
 */

export type EntityKind =
  | "inbox"
  | "reports"
  | "people"
  | "knowledge"
  | "knowledge-base"
  | "knowledge-bases"
  | "files"
  | "filestores"
  | "library"
  | "attachments"
  | "agents"
  | "databases"
  | "workflows"
  | "tools"
  | "skills"
  | "commands"
  | "scripts"
  | "access"
  | "assets"
  | "traces";

export type ToneKey = "accent" | "sage" | "ochre" | "link" | "clay" | "neutral";

// ── Inline SVGs ────────────────────────────────────────────────────
// Stroke-style line icons at 1.6px, except People which is filled
// (stroke person reads weak at 14px).

const InboxIcon: ReactNode = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="3" y="6" width="18" height="13" rx="2" />
    <path d="M3 7l9 6.5L21 7" />
  </svg>
);

const ReportsIcon: ReactNode = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <line x1="6" y1="20" x2="6" y2="14" />
    <line x1="12" y1="20" x2="12" y2="9" />
    <line x1="18" y1="20" x2="18" y2="4" />
  </svg>
);

const PersonIcon: ReactNode = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 21c0-4.0 3.1-7 7-7s7 3.0 7 7v1H5z" />
  </svg>
);

const KnowledgeIcon: ReactNode = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M5 4a2 2 0 0 1 2-2h12v20H7a2 2 0 0 1-2-2z" />
    <line x1="9" y1="8" x2="15" y2="8" />
    <line x1="9" y1="12" x2="15" y2="12" />
  </svg>
);

const FilesIcon: ReactNode = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
);

const AgentsIcon: ReactNode = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 3l1.8 5.4L19.5 10l-5.7 1.6L12 17l-1.8-5.4L4.5 10l5.7-1.6z" />
  </svg>
);

const AttachmentsIcon: ReactNode = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M21 12.5l-8.5 8.5a5 5 0 0 1-7-7L14 5.5a3.5 3.5 0 0 1 5 5L10.5 19a2 2 0 0 1-2.8-2.8L16 8" />
  </svg>
);

const DatabasesIcon: ReactNode = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <ellipse cx="12" cy="6" rx="7" ry="2.5" />
    <path d="M5 6v6c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6" />
    <path d="M5 12v6c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-6" />
  </svg>
);

const WorkflowsIcon: ReactNode = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M4 12a8 8 0 0 1 14-5.3" />
    <polyline points="14 4 18 6.7 16 11" />
    <path d="M20 12a8 8 0 0 1-14 5.3" />
    <polyline points="10 20 6 17.3 8 13" />
  </svg>
);

// Wrench — installed CLI & MCP tools.
const ToolsIcon: ReactNode = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  </svg>
);

// Slash — commands the admin runs via /name in Claude.
const CommandsIcon: ReactNode = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
    <line x1="15" y1="4" x2="9" y2="20" />
  </svg>
);

// Sparkle on a page — admin-side skill prompts (PIN-5829).
const SkillsIcon: ReactNode = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M5 4a2 2 0 0 1 2-2h8l4 4v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z" />
    <path d="M14 2v5h5" />
    <path d="M11 12l1 2.5L14.5 15.5l-2.5 1L11 19l-1-2.5L7.5 15.5l2.5-1z" />
  </svg>
);

// Code-bracket angle on a page — admin-side runnable scripts (PIN-5829).
const ScriptsIcon: ReactNode = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M5 4a2 2 0 0 1 2-2h8l4 4v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z" />
    <path d="M14 2v5h5" />
    <polyline points="10 12 8 14 10 16" />
    <polyline points="14 12 16 14 14 16" />
  </svg>
);

// Shield icon — access management (onboard/offboard log).
const AccessIcon: ReactNode = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

// Laptop icon — asset/device inventory.
const AssetsIcon: ReactNode = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16" />
  </svg>
);

// Activity log — agent trace history.
const TracesIcon: ReactNode = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
);

// ── Additional gallery icons ──────────────────────────────────────
// Extended icon set for the workstation icon picker. Users choose from
// these when customizing a tile's appearance.

const TagIcon: ReactNode = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.828 8.828a2 2 0 0 0 2.828 0l7.172-7.172a2 2 0 0 0 0-2.828z" />
    <circle cx="7.5" cy="7.5" r="1.5" fill="currentColor" stroke="none" />
  </svg>
);

const GlobeIcon: ReactNode = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="10" />
    <path d="M2 12h20" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

const CalendarIcon: ReactNode = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);

const KeyIcon: ReactNode = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" />
  </svg>
);

const LockIcon: ReactNode = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

const HeartIcon: ReactNode = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
  </svg>
);

const FlagIcon: ReactNode = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
    <line x1="4" y1="22" x2="4" y2="15" />
  </svg>
);

const BellIcon: ReactNode = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);

const BuildingIcon: ReactNode = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="4" y="2" width="16" height="20" rx="2" />
    <path d="M9 22v-4h6v4" />
    <line x1="8" y1="6" x2="8" y2="6.01" />
    <line x1="16" y1="6" x2="16" y2="6.01" />
    <line x1="12" y1="6" x2="12" y2="6.01" />
    <line x1="8" y1="10" x2="8" y2="10.01" />
    <line x1="16" y1="10" x2="16" y2="10.01" />
    <line x1="12" y1="10" x2="12" y2="10.01" />
    <line x1="8" y1="14" x2="8" y2="14.01" />
    <line x1="16" y1="14" x2="16" y2="14.01" />
    <line x1="12" y1="14" x2="12" y2="14.01" />
  </svg>
);

const BriefcaseIcon: ReactNode = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="2" y="7" width="20" height="14" rx="2" />
    <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
  </svg>
);

const CreditCardIcon: ReactNode = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="1" y="4" width="22" height="16" rx="2" />
    <line x1="1" y1="10" x2="23" y2="10" />
  </svg>
);

const UsersIcon: ReactNode = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

const ServerIcon: ReactNode = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="2" y="2" width="20" height="8" rx="2" />
    <rect x="2" y="14" width="20" height="8" rx="2" />
    <line x1="6" y1="6" x2="6.01" y2="6" />
    <line x1="6" y1="18" x2="6.01" y2="18" />
  </svg>
);

const BookmarkIcon: ReactNode = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
  </svg>
);

const ClipboardIcon: ReactNode = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    <rect x="8" y="2" width="8" height="4" rx="1" />
  </svg>
);

const HashIcon: ReactNode = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
    <line x1="4" y1="9" x2="20" y2="9" />
    <line x1="4" y1="15" x2="20" y2="15" />
    <line x1="10" y1="3" x2="8" y2="21" />
    <line x1="16" y1="3" x2="14" y2="21" />
  </svg>
);

const LayersIcon: ReactNode = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polygon points="12 2 2 7 12 12 22 7 12 2" />
    <polyline points="2 17 12 22 22 17" />
    <polyline points="2 12 12 17 22 12" />
  </svg>
);

const TargetIcon: ReactNode = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="12" r="6" />
    <circle cx="12" cy="12" r="2" />
  </svg>
);

// ── Icon Gallery ─────────────────────────────────────────────────────
// Maps string IDs to SVG ReactNodes. Used by the workstation config to
// reference icons by name, and by the icon picker to render the gallery.

export const ICON_GALLERY: Record<string, { icon: ReactNode; label: string }> = {
  // Original entity icons
  inbox:       { icon: InboxIcon,       label: "Inbox" },
  reports:     { icon: ReportsIcon,     label: "Reports" },
  person:      { icon: PersonIcon,      label: "Person" },
  knowledge:   { icon: KnowledgeIcon,   label: "Book" },
  folder:      { icon: FilesIcon,       label: "Folder" },
  agents:      { icon: AgentsIcon,      label: "Star" },
  attachments: { icon: AttachmentsIcon, label: "Paperclip" },
  database:    { icon: DatabasesIcon,   label: "Database" },
  workflows:   { icon: WorkflowsIcon,   label: "Cycle" },
  tools:       { icon: ToolsIcon,       label: "Wrench" },
  commands:    { icon: CommandsIcon,    label: "Slash" },
  skills:      { icon: SkillsIcon,      label: "Sparkle" },
  scripts:     { icon: ScriptsIcon,     label: "Code" },
  access:      { icon: AccessIcon,      label: "Shield" },
  assets:      { icon: AssetsIcon,      label: "Laptop" },
  traces:      { icon: TracesIcon,      label: "Activity" },
  // Extended gallery
  tag:         { icon: TagIcon,         label: "Tag" },
  globe:       { icon: GlobeIcon,       label: "Globe" },
  calendar:    { icon: CalendarIcon,    label: "Calendar" },
  key:         { icon: KeyIcon,         label: "Key" },
  lock:        { icon: LockIcon,        label: "Lock" },
  heart:       { icon: HeartIcon,       label: "Heart" },
  flag:        { icon: FlagIcon,        label: "Flag" },
  bell:        { icon: BellIcon,        label: "Bell" },
  building:    { icon: BuildingIcon,    label: "Building" },
  briefcase:   { icon: BriefcaseIcon,   label: "Briefcase" },
  "credit-card": { icon: CreditCardIcon, label: "Card" },
  users:       { icon: UsersIcon,       label: "Group" },
  server:      { icon: ServerIcon,      label: "Server" },
  bookmark:    { icon: BookmarkIcon,    label: "Bookmark" },
  clipboard:   { icon: ClipboardIcon,   label: "Clipboard" },
  hash:        { icon: HashIcon,        label: "Hash" },
  layers:      { icon: LayersIcon,      label: "Layers" },
  target:      { icon: TargetIcon,      label: "Target" },
};

/** Look up an icon ReactNode by gallery key, with a fallback. */
export function iconForKey(key: string | undefined): ReactNode {
  if (!key) return DatabasesIcon;
  return ICON_GALLERY[key]?.icon ?? DatabasesIcon;
}

// ── Per-kind metadata (icon + tone + label) ───────────────────────

type EntityMetaEntry = {
  icon: ReactNode;
  tone: ToneKey;
  label: string;
};

export const ENTITY_META: Record<EntityKind, EntityMetaEntry> = {
  inbox:             { icon: InboxIcon,       tone: "accent",  label: "Inbox" },
  reports:           { icon: ReportsIcon,     tone: "link",    label: "Reports" },
  people:            { icon: PersonIcon,      tone: "sage",    label: "People" },
  knowledge:         { icon: KnowledgeIcon,   tone: "ochre",   label: "Knowledge" },
  "knowledge-base":  { icon: KnowledgeIcon,   tone: "ochre",   label: "Knowledge" },
  "knowledge-bases": { icon: KnowledgeIcon,   tone: "ochre",   label: "Knowledge" },
  files:             { icon: FilesIcon,       tone: "neutral", label: "Filestores" },
  filestores:        { icon: FilesIcon,       tone: "neutral", label: "Filestores" },
  library:           { icon: FilesIcon,       tone: "neutral", label: "Library" },
  attachments:       { icon: AttachmentsIcon, tone: "neutral", label: "Attachments" },
  agents:            { icon: AgentsIcon,      tone: "accent",  label: "Agents" },
  databases:         { icon: DatabasesIcon,   tone: "link",    label: "Databases" },
  workflows:         { icon: WorkflowsIcon,   tone: "sage",    label: "Workflows" },
  tools:             { icon: ToolsIcon,       tone: "accent",  label: "Tools" },
  skills:            { icon: SkillsIcon,      tone: "ochre",   label: "Skills" },
  commands:          { icon: CommandsIcon,    tone: "accent",  label: "Commands" },
  scripts:           { icon: ScriptsIcon,     tone: "link",    label: "Scripts" },
  access:            { icon: AccessIcon,      tone: "sage",    label: "Access" },
  assets:            { icon: AssetsIcon,      tone: "clay",    label: "Assets" },
  traces:            { icon: TracesIcon,     tone: "neutral", label: "Traces" },
};

// ── Convenience accessors used by call sites ──────────────────────

// ── EntityBadge component (used in viewer headers) ────────────────

/// Small tinted badge: tone-colored glyph square + label text.
/// Rendered at the top of an entity-list view so the page header
/// matches the station/card icon that opened it.
export function EntityBadge({
  kind,
  size = "md",
  showLabel = true,
}: {
  kind: EntityKind;
  size?: "sm" | "md";
  showLabel?: boolean;
}) {
  const meta = ENTITY_META[kind];
  return (
    <span
      className={`entity-badge entity-badge-${size} entity-tone-${meta.tone}`}
    >
      <span className="entity-badge-glyph" aria-hidden>
        {meta.icon}
      </span>
      {showLabel && <span className="entity-badge-label">{meta.label}</span>}
    </span>
  );
}
