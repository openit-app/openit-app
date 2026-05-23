import type { ViewerSource } from "./Viewer";

/// Map the open ViewerSource → repo-relative path of the workstation
/// tile that owns it, so the collapsed left rail can highlight the
/// matching icon. Returns null for views that don't correspond to a
/// pinned station.
///
/// IMPORTANT: the returned string must match the tile's `rel` from
/// `workstationConfig.discoverTiles()` — NOT the on-disk folder path.
/// In particular:
///  - knowledge tiles use rel `"knowledge"` (the on-disk folder is
///    `knowledge/`, NOT `knowledge-bases/`)
///  - traces tiles use rel `"traces"` (folder is `.openit/agent-traces/`)
///  - tickets/conversations have NO tile (handled by the TODAY hero
///    card); we return null so the rail doesn't try to pulse a tile
///    that doesn't exist.
export function selectedRelFromSource(
  s: ViewerSource,
  repo: string | null,
): string | null {
  if (!s || !repo) return null;
  switch (s.kind) {
    case "entity-folder":
      // Includes user-pinned stores (`databases/people`, `filestores/scripts`,
      // anything else mkdir-ed under a primitive). The Workbench tile
      // identity is exactly s.path.
      return s.path;
    case "databases-list":
      return "databases";
    case "filestores-list":
      return "filestores";
    case "knowledge-list":
      return "knowledge";
    case "people-list":
      return "databases/people";
    case "access-list":
      return "databases/access";
    case "assets-list":
      return "databases/assets";
    case "attachments-folder":
      return "filestores/attachments";
    case "conversations-list":
    case "conversation-thread":
      // Tickets/conversations don't have their own pinned tile —
      // they're surfaced via the TODAY hero card. Returning null so
      // no rail tile lights up (vs. lying about a non-existent tile).
      return null;
    case "datastore-table":
    case "datastore-row":
    case "datastore-schema":
      return `databases/${s.collection.name}`;
    case "tools":
      return "tools";
    case "skills-station":
      return "filestores/skills";
    case "commands-station":
      return "filestores/commands";
    case "scripts-station":
      return "filestores/scripts";
    case "traces-list":
    case "agent-trace":
    case "agent-trace-list":
      return "traces";
    case "agent":
      return "agents";
    case "workflow":
      // Workflows live in a separate `workflows/` folder, NOT under
      // agents/, so highlighting the agents tile when a workflow is
      // open would mislead the user. There's no default workflows
      // tile in DEFAULT_WORKSTATION_CONFIG, but a power user can pin
      // one — return the canonical primitive rel so the rail's
      // longest-prefix match can still find it.
      return "workflows";
    case "file": {
      // Best-effort fallback: walk the path back to the first folder
      // under the repo root. Useful for files opened directly from
      // the file explorer (knowledge articles, reports, etc.) so the
      // owning station still pulses.
      const rel = s.path.startsWith(`${repo}/`)
        ? s.path.slice(repo.length + 1)
        : null;
      if (!rel) return null;
      const firstSlash = rel.indexOf("/");
      if (firstSlash < 0) return null;
      const top = rel.slice(0, firstSlash);
      // For databases/filestores, the tile is the second segment.
      if (top === "databases" || top === "filestores") {
        const rest = rel.slice(firstSlash + 1);
        const second = rest.indexOf("/");
        return `${top}/${second < 0 ? rest : rest.slice(0, second)}`;
      }
      return top;
    }
    default:
      return null;
  }
}
