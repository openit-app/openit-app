import type { ViewerSource } from "../viewerTypes";
import {
  resolveTracesList,
  resolveTraceFolder,
  resolveTraceFile,
} from "./resolvers/traceResolvers";
import {
  resolveDatastoreSchema,
  resolveDatastoreRow,
  resolveDatastoreTable,
  resolveDatabasesList,
} from "./resolvers/datastoreResolvers";
import {
  resolveEntityFolder,
  resolveFilestoresList,
} from "./resolvers/filestoreResolvers";
import { resolveTasksList } from "./resolvers/taskResolvers";
import { relUnderRepo } from "../../lib/paths";

/**
 * Given an absolute file path, determine if it's an entity file
 * (database row, agent, workflow, schema, task) and return the
 * appropriate ViewerSource. Falls back to { kind: "file", path } for
 * regular files.
 */
export async function resolvePathToSource(
  path: string,
  repo: string | null,
): Promise<ViewerSource> {
  if (!repo) return { kind: "file", path };

  // Handle both path separators — Windows yields backslashes, Unix yields
  // forward slashes, and the two sides (repo and path) may even disagree.
  // Without normalization, clicking a folder in the file explorer on Windows
  // resolved as a generic file view and surfaced "Access is denied. (os
  // error 5)" as the viewer tried to read the directory as a file.
  const rel = relUnderRepo(repo, path);
  // Treat the repo root itself as a "file" fallback — caller already has
  // dedicated viewers for it elsewhere; the empty rel here would short-
  // circuit every match below.
  if (rel === null || rel === "") return { kind: "file", path };

  // `tools` is a synthetic entity -- no on-disk directory at all (so it
  // doesn't show up in the file explorer). The Workbench station calls
  // onOpen with this synthetic path; we route it to the catalog
  // viewer. Source of truth for installed state is `which` detection
  // per catalog entry.
  if (rel === "tools" || rel === "tools/") return { kind: "tools" };

  // Skills station -- intercept before the generic entity-folder routing
  // so `filestores/commands` renders the combined slash-commands + custom
  // skills view instead of the plain file list.
  if (rel === "filestores/commands") return { kind: "commands-station" };
  if (rel === "filestores/scripts") return { kind: "scripts-station" };

  // ── Tasks ─────────────────────────────────────────────────────────

  // `tasks/` parent -> the new flat task list. Individual task files
  // (`tasks/task-*.md`) fall through to the generic markdown file view
  // so the Viewer's standard render / raw / edit toggle handles body
  // edits the same way it would for any other markdown file.
  if (rel === "tasks" || rel === "tasks/") {
    return resolveTasksList(repo);
  }

  // ── Trace resolvers ──

  // traces/ parent -> list all ticket trace folders
  if (rel === "traces") {
    return resolveTracesList(path, repo);
  }

  // traces/<ticketId>/ (folder) -> agent-trace-list
  const traceFolderMatch = rel.match(/^traces\/([^/]+)$/);
  if (traceFolderMatch) {
    return resolveTraceFolder(path, repo, traceFolderMatch[1]);
  }

  // traces/<ticketId>/<isoStamp>.json -> agent-trace
  const traceMatch = rel.match(
    /^traces\/([^/]+)\/([^/]+)\.json$/,
  );
  if (traceMatch) {
    return resolveTraceFile(path, repo, traceMatch[1]);
  }

  // ── Datastore resolvers ──

  // databases/<collection>/_schema.json -> datastore-schema
  const schemaMatch = rel.match(/^databases\/([^/]+)\/_schema\.json$/);
  if (schemaMatch) {
    return resolveDatastoreSchema(path, schemaMatch[1]);
  }

  // databases/<collection>/<row>.json -> datastore-row
  const rowMatch = rel.match(/^databases\/([^/]+)\/([^/]+)\.json$/);
  if (rowMatch) {
    return resolveDatastoreRow(path, repo, rowMatch[1], rowMatch[2]);
  }

  // databases/<collection>/ directory -> datastore-table. Includes
  // legacy `databases/tickets/` and `databases/conversations/` folders
  // (created by older app versions); they now render as plain JSON
  // tables instead of the bespoke conversations UI.
  const dirMatch = rel.match(/^databases\/([^/]+)$/);
  if (dirMatch) {
    return resolveDatastoreTable(path, dirMatch[1]);
  }

  // ── Filestore resolvers ──
  // (agents/ and workflows/ no longer have dedicated viewers — files
  // under those folders fall through to the generic file viewer. The
  // backend still reads `agents/triage.md` as the triage system prompt;
  // it just isn't surfaced as a primitive in the workstation.)

  // Top-level entity folders
  const filestoreCollectionMatch = rel.match(/^filestores\/([^/]+)$/);
  // Built-in filestore collections each get their own entity-folder
  // entity so the right-pane title bar + empty-state copy can be
  // tailored. `library` was the only one historically; `skills` +
  // `scripts` join it under PIN-5829. Anything else under filestores/
  // (user-created or dynamic openit-* collection) still routes through
  // the generic `library` rendering path.
  const filestoreSubdir = filestoreCollectionMatch ? filestoreCollectionMatch[1] : null;
  const entityFolderEntry: {
    entity:
      | "knowledge"
      | "knowledge-base"
      | "library"
      | "reports"
      | "skills"
      | "scripts";
  } | null =
    rel === "knowledge"
      ? { entity: "knowledge" }
      : filestoreSubdir === "commands"
        ? { entity: "skills" }
        : filestoreSubdir === "scripts"
          ? { entity: "scripts" }
          : filestoreSubdir
            ? { entity: "library" }
            : rel === "reports"
              ? { entity: "reports" }
              : null;
  if (entityFolderEntry) {
    return resolveEntityFolder(path, rel, repo, entityFolderEntry.entity);
  }

  // Top-level `databases/` parent folder -> databases-list
  if (rel === "databases") {
    return resolveDatabasesList(path);
  }

  // `filestores/` parent -> filestores-list overview
  if (rel === "filestores") {
    return resolveFilestoresList(path);
  }

  return { kind: "file", path };
}
