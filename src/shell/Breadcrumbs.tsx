import type { ViewerSource } from "./viewerTypes";

/** One segment of the breadcrumb trail. `navigateTo` is a repo-relative
 *  path that will be dispatched as `openit:navigate`. Null for the last
 *  (current) segment — it renders as plain text rather than a link. */
export type BreadcrumbSegment = {
  label: string;
  /** Repo-relative path to navigate to on click, or null for the leaf. */
  navigateTo: string | null;
};

// ── Top-level folder mapping ──────────────────────────────────────
// Maps the first directory segment of a repo-relative path to a
// human-readable label and the parent listing path. Used by the `file`
// and `draft-file` source kinds to auto-derive breadcrumbs from any
// path without case-by-case handling.
const TOP_LEVEL_FOLDERS: Record<string, { label: string; listPath: string }> = {
  filestores:        { label: "Filestores",  listPath: "filestores" },
  databases:         { label: "Databases",   listPath: "databases" },
  agents:            { label: "Agents",      listPath: "agents" },
  workflows:         { label: "Workflows",   listPath: "workflows" },
  "knowledge-bases": { label: "Knowledge",   listPath: "knowledge-bases" },
  reports:           { label: "Reports",     listPath: "reports" },
};

/** Capitalize the first letter of a string. */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// First-class database collections that appear as top-level stations
// in the Workbench. These skip the "Databases /" prefix in breadcrumbs.
// Custom collections promoted to the workstation also get this treatment
// — the check falls through to the generic path which adds "Databases /"
// as a parent, which is still correct. The well-known ones here get
// friendly display names.
const FIRST_CLASS_COLLECTIONS: Record<string, { label: string; listPath: string }> = {
  people:        { label: "People",  listPath: "databases/people" },
  access:        { label: "Access",  listPath: "databases/access" },
  assets:        { label: "Assets",  listPath: "databases/assets" },
  tickets:       { label: "Tickets", listPath: "databases/tickets" },
  conversations: { label: "Tickets", listPath: "databases/tickets" },
};

// ── Core: derive breadcrumb segments from a ViewerSource ──────────

export function breadcrumbSegments(
  source: ViewerSource,
  repo: string,
): BreadcrumbSegment[] {
  if (!source) return [];

  switch (source.kind) {
    // ── File (most common — path-derived) ─────────────────────────
    case "file":
      return filePathSegments(source.path, repo);

    case "draft-file":
      return filePathSegments(source.path, repo);

    // ── Filestores hierarchy ──────────────────────────────────────
    case "filestores-list":
      return [{ label: "Filestores", navigateTo: null }];

    case "attachments-folder":
      return [
        { label: "Filestores", navigateTo: "filestores" },
        { label: "Attachments", navigateTo: null },
      ];

    // ── Databases hierarchy ───────────────────────────────────────
    case "databases-list":
      return [{ label: "Databases", navigateTo: null }];

    case "datastore-table": {
      const name = source.collection?.name ?? "collection";
      const fc = FIRST_CLASS_COLLECTIONS[name];
      if (fc) return [{ label: fc.label, navigateTo: null }];
      return [
        { label: "Databases", navigateTo: "databases" },
        { label: capitalize(name), navigateTo: null },
      ];
    }

    case "datastore-row": {
      const col = source.collection?.name ?? "collection";
      const key = source.item?.key || source.item?.id || "row";
      const fc = FIRST_CLASS_COLLECTIONS[col];
      if (fc) {
        return [
          { label: fc.label, navigateTo: fc.listPath },
          { label: `${key}.json`, navigateTo: null },
        ];
      }
      return [
        { label: "Databases", navigateTo: "databases" },
        { label: capitalize(col), navigateTo: `databases/${col}` },
        { label: `${key}.json`, navigateTo: null },
      ];
    }

    case "datastore-schema": {
      const col = source.collection?.name ?? "collection";
      const fc = FIRST_CLASS_COLLECTIONS[col];
      if (fc) {
        return [
          { label: fc.label, navigateTo: fc.listPath },
          { label: "Schema", navigateTo: null },
        ];
      }
      return [
        { label: "Databases", navigateTo: "databases" },
        { label: capitalize(col), navigateTo: `databases/${col}` },
        { label: "Schema", navigateTo: null },
      ];
    }

    // ── Conversations (tickets) ───────────────────────────────────
    case "conversations-list":
      return [{ label: "Tickets", navigateTo: null }];

    case "conversation-thread":
      return [
        { label: "Tickets", navigateTo: "databases/tickets" },
        { label: source.ticketId, navigateTo: null },
      ];

    // ── Entity folders (agents, workflows, knowledge, etc.) ──────
    case "entity-folder": {
      const entityLabel = entityFolderLabel(source.entity);
      // If it's a sub-collection under filestores (library, skills, scripts,
      // attachments-ticket), show Filestores as a parent.
      if (
        source.entity === "library" ||
        source.entity === "skills" ||
        source.entity === "scripts" ||
        source.entity === "attachments-ticket"
      ) {
        return [
          { label: "Filestores", navigateTo: "filestores" },
          { label: entityLabel, navigateTo: null },
        ];
      }
      return [{ label: entityLabel, navigateTo: null }];
    }

    // ── Agents ────────────────────────────────────────────────────
    case "agent":
      return [
        { label: "Agents", navigateTo: "agents" },
        { label: source.agent?.name ?? "Agent", navigateTo: null },
      ];

    // ── Workflows ─────────────────────────────────────────────────
    case "workflow":
      return [
        { label: "Workflows", navigateTo: "workflows" },
        { label: source.workflow?.name ?? "Workflow", navigateTo: null },
      ];

    // ── People / Access / Assets ──────────────────────────────────
    case "people-list":
      return [{ label: "People", navigateTo: null }];
    case "access-list":
      return [{ label: "Access", navigateTo: null }];
    case "assets-list":
      return [{ label: "Assets", navigateTo: null }];

    // ── Traces ────────────────────────────────────────────────────
    case "traces-list":
      return [{ label: "Traces", navigateTo: null }];

    case "agent-trace-list":
      return [
        { label: "Traces", navigateTo: ".openit/agent-traces" },
        { label: source.subject || source.ticketId, navigateTo: null },
      ];

    case "agent-trace":
      return [
        { label: "Traces", navigateTo: ".openit/agent-traces" },
        { label: source.subject || source.ticketId, navigateTo: null },
      ];

    // ── Stations / Tools ──────────────────────────────────────────
    case "tools":
      return [{ label: "Tools", navigateTo: null }];
    case "skills-station":
      return [{ label: "Skills", navigateTo: null }];
    case "commands-station":
      return [{ label: "Commands", navigateTo: null }];
    case "scripts-station":
      return [{ label: "Scripts", navigateTo: null }];

    // ── Misc ──────────────────────────────────────────────────────
    case "sync":
      return [{ label: "Sync output", navigateTo: null }];
    case "diff":
      return [{ label: "Git diff", navigateTo: null }];
    case "script-output":
      return [
        { label: "Scripts", navigateTo: "filestores/scripts" },
        { label: `Run: ${source.script.split("/").pop() ?? source.script}`, navigateTo: null },
      ];
    case "knowledge-bases-list":
      return [{ label: "Knowledge", navigateTo: null }];

    default:
      return [];
  }
}

// ── Helpers ───────────────────────────────────────────────────────

/** Build breadcrumb segments from a file's absolute path. Walks up
 *  from the filename through intermediate directories to the top-level
 *  entity folder (if one matches). */
function filePathSegments(absPath: string, repo: string): BreadcrumbSegment[] {
  const rel = absPath.startsWith(repo + "/") ? absPath.slice(repo.length + 1) : null;
  if (!rel) return [{ label: absPath.split("/").pop() ?? absPath, navigateTo: null }];

  const parts = rel.split("/");

  // Special case: .claude/skills/<name>/SKILL.md → Commands / skill-name
  const skillMatch = rel.match(/^\.claude\/skills\/([^/]+)\/SKILL\.md$/);
  if (skillMatch) {
    return [
      { label: "Commands", navigateTo: "filestores/skills" },
      { label: skillMatch[1], navigateTo: null },
    ];
  }

  // Look up the top-level folder for a label
  const topDir = parts[0];
  const topEntry = TOP_LEVEL_FOLDERS[topDir];

  if (topEntry && parts.length >= 2) {
    const segments: BreadcrumbSegment[] = [
      { label: topEntry.label, navigateTo: topEntry.listPath },
    ];

    // Intermediate directories (everything between top-level and filename)
    for (let i = 1; i < parts.length - 1; i++) {
      const dirPath = parts.slice(0, i + 1).join("/");
      segments.push({ label: parts[i], navigateTo: dirPath });
    }

    // Leaf: the filename itself
    const filename = parts[parts.length - 1];
    segments.push({ label: filename, navigateTo: null });

    return segments;
  }

  // Fallback: just the filename
  return [{ label: parts[parts.length - 1], navigateTo: null }];
}

function entityFolderLabel(
  entity:
    | "agents"
    | "workflows"
    | "knowledge"
    | "knowledge-base"
    | "library"
    | "reports"
    | "skills"
    | "scripts"
    | "attachments-ticket",
): string {
  switch (entity) {
    case "agents":             return "Agents";
    case "workflows":          return "Workflows";
    case "knowledge":
    case "knowledge-base":     return "Knowledge";
    case "library":            return "Library";
    case "reports":            return "Reports";
    case "skills":             return "Skills";
    case "scripts":            return "Scripts";
    case "attachments-ticket": return "Attachments";
    default:                   return capitalize(entity);
  }
}

// ── React component ───────────────────────────────────────────────

/** Renders only the ancestor (non-leaf) breadcrumb segments with
 *  a trailing separator so the caller can append their own leaf UI
 *  (rename input, editable title, plain title, etc.). Returns null
 *  when there are no ancestors to show (single-segment views). */
export function BreadcrumbAncestors({
  source,
  repo,
  onNavigate,
}: {
  source: ViewerSource;
  repo: string;
  /** Called when the user clicks an ancestor segment. Receives
   *  the repo-relative path to navigate to. */
  onNavigate: (repoRelPath: string) => void;
}) {
  const segments = breadcrumbSegments(source, repo);
  // Only render if there are ancestor segments (more than just the leaf)
  if (segments.length <= 1) return null;

  const ancestors = segments.slice(0, -1);

  return (
    <nav className="viewer-breadcrumb-ancestors" aria-label="Breadcrumb">
      {ancestors.map((seg, i) => (
        <span key={i} className="viewer-breadcrumb-item">
          {seg.navigateTo ? (
            <button
              type="button"
              className="viewer-breadcrumb-link"
              onClick={() => onNavigate(seg.navigateTo!)}
            >
              {seg.label}
            </button>
          ) : (
            <span className="viewer-breadcrumb-current">{seg.label}</span>
          )}
          <span className="viewer-breadcrumb-sep" aria-hidden="true">/</span>
        </span>
      ))}
    </nav>
  );
}
