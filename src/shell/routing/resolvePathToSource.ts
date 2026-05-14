import type { ViewerSource } from "../viewerTypes";
import {
  resolveTracesList,
  resolveTraceFolder,
  resolveTraceFile,
} from "./resolvers/traceResolvers";
import {
  resolveDatastoreSchema,
  resolveDatastoreRow,
  resolveConversationsList,
  resolveConversationThread,
  resolveDatastoreTable,
  resolveDatabasesList,
} from "./resolvers/datastoreResolvers";
import {
  resolveAgentMd,
  resolveAgentJson,
  resolveWorkflow,
} from "./resolvers/agentResolvers";
import {
  resolveAttachmentsTicket,
  resolveEntityFolder,
  resolveFilestoresList,
  resolveAttachmentsFolder,
} from "./resolvers/filestoreResolvers";

/**
 * Given an absolute file path, determine if it's an entity file
 * (database row, agent, workflow, schema) and return the appropriate
 * ViewerSource. Falls back to { kind: "file", path } for regular files.
 *
 * `opts.rawTickets` skips the `databases/tickets` -> conversations-list
 * shortcut and falls through to the generic datastore-table rule. Used
 * by the file-explorer click so the tree node renders the underlying
 * table, while the Inbox station (and other inbox entry points) keep
 * the curated card list.
 */
export async function resolvePathToSource(
  path: string,
  repo: string | null,
  opts?: { rawTickets?: boolean },
): Promise<ViewerSource> {
  if (!repo) return { kind: "file", path };

  // Handle both path separators — Windows yields backslashes, Unix yields
  // forward slashes, and the two sides (repo and path) may even disagree.
  // Normalize both before deriving the rel-path. Without this, clicking a
  // folder in the file explorer on Windows resolved as a generic file view
  // and surfaced "Access is denied. (os error 5)" as the viewer tried to
  // read the directory as a file.
  const repoFs = repo.replace(/\\/g, "/");
  const pathFs = path.replace(/\\/g, "/");
  const rel = pathFs.startsWith(repoFs + "/")
    ? pathFs.slice(repoFs.length + 1)
    : null;
  if (!rel) return { kind: "file", path };

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

  // databases/tickets/ -> conversations-list
  if (
    !opts?.rawTickets &&
    (rel === "databases/tickets" || rel === "databases/conversations")
  ) {
    return resolveConversationsList(repo);
  }

  // databases/conversations/<ticketId>/ directory -> conversation-thread
  const threadMatch = rel.match(/^databases\/conversations\/([^/]+)$/);
  if (threadMatch) {
    return resolveConversationThread(path, repo, threadMatch[1]);
  }

  // databases/<collection>/ directory -> datastore-table
  const dirMatch = rel.match(/^databases\/([^/]+)$/);
  if (dirMatch) {
    return resolveDatastoreTable(path, dirMatch[1]);
  }

  // ── Agent & workflow resolvers ──

  // agents/<name>.md -> render as a regular file
  const agentMdMatch = rel.match(/^agents\/([^/]+)\.md$/);
  if (agentMdMatch) {
    return resolveAgentMd(path);
  }

  // agents/<name>.json -> agent (legacy V1/V2)
  const agentJsonMatch = rel.match(/^agents\/(.+)\.json$/);
  if (agentJsonMatch) {
    return resolveAgentJson(path);
  }

  // workflows/<name>.json -> workflow
  const workflowMatch = rel.match(/^workflows\/(.+)\.json$/);
  if (workflowMatch) {
    return resolveWorkflow(path);
  }

  // ── Filestore resolvers ──

  // filestores/attachments/<ticketId>/ -> entity-folder
  const attachmentsTicketMatch = rel.match(
    /^filestores\/attachments\/([^/]+)$/,
  );
  if (attachmentsTicketMatch) {
    return resolveAttachmentsTicket(path, rel);
  }

  // Top-level entity folders
  const filestoreCollectionMatch = rel.match(/^filestores\/([^/]+)$/);
  const isAttachmentsParent =
    filestoreCollectionMatch && filestoreCollectionMatch[1] === "attachments";
  // Built-in filestore collections each get their own entity-folder
  // entity so the right-pane title bar + empty-state copy can be
  // tailored. `library` was the only one historically; `skills` +
  // `scripts` join it under PIN-5829. Anything else under filestores/
  // (user-created or dynamic openit-* collection) still routes through
  // the generic `library` rendering path.
  const filestoreSubdir = filestoreCollectionMatch && !isAttachmentsParent
    ? filestoreCollectionMatch[1]
    : null;
  const entityFolderEntry: {
    entity:
      | "agents"
      | "workflows"
      | "knowledge"
      | "knowledge-base"
      | "library"
      | "reports"
      | "skills"
      | "scripts";
  } | null =
    rel === "agents"
      ? { entity: "agents" }
      : rel === "workflows"
        ? { entity: "workflows" }
        : rel === "knowledge"
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

  // `knowledge/` -> flat list of all KB articles (markdown files).
  // No more collection/subfolder concept -- articles live directly in
  // knowledge/ and render as a plain entity-folder.

  // `filestores/attachments/` -> list of per-ticket subfolders
  if (rel === "filestores/attachments") {
    return resolveAttachmentsFolder(path);
  }

  return { kind: "file", path };
}
