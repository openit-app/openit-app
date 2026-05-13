import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  File as FileIcon,
  Folder as FolderIcon,
  FolderOpen as FolderOpenIcon,
} from "lucide-react";
import sunburstIcon from "../../assets/sunburst.svg";
import { Button } from "../../ui";
import {
  kbDeleteFile,
  kbWriteFileBytes,
} from "../../lib/api";
import type { DataCollection, MemoryItem } from "../../lib/localTypes";
import {
  relPath,
  prettyName,
  friendlyDroppedFilename,
  fileColorClass,
  fileStatusBadge,
  isKbSupported,
} from "./helpers";
import { ContextMenu, type ContextMenuState } from "./ContextMenu";
import { useTreeState } from "./useTreeState";

/**
 * COLLECTION LOADING & SYNC PROCESS
 *
 * 1. ON FIRST CONNECT (user connects):
 *    - loadOnce() fires in background (does NOT block UI)
 *    - Resolves collections: fetches /datacollection/all, creates defaults if missing
 *    - Collections with eventual consistency: 2-sec delay before re-fetching to confirm
 *    - Fetches items and full schema for each collection in parallel
 *    - Enriches collections with schema for disk persistence
 *    - Writes to disk: databases/{name}/_schema.json + *.json for each item
 *    - UI updates progressively as data arrives (not blocked)
 *
 * 2. EVERY 60 SECONDS (background polling):
 *    - pollSilently() runs in background
 *    - Re-resolves collections (creates if still missing due to API lag)
 *    - 10-second cooldown prevents duplicate creation attempts
 *    - Updates UI state if collections changed (no disk writes on poll)
 *
 * 3. DUPLICATE PREVENTION:
 *    - In-memory cache tracks recently created collections
 *    - If collections not in API yet (eventual consistency), returns cached copy
 *    - 10-second cooldown before re-attempting creation
 *    - Avoids creating duplicates when API has lag
 *
 * KEY: Collections are created via REST API POST /datacollection/
 * (NOT MCP tools). Schema comes from GET /datacollection/{id}.
 * Items fetched from /memory/bquery with includeSchema=true.
 */
export function FileExplorer({
  repo,
  onSelect,
  fsTick,
  onFsChange,
  selectedPath,
  active,
  onBack,
}: {
  repo: string | null;
  onSelect: (path: string) => void;
  fsTick?: number;
  onFsChange?: () => void;
  /** Absolute path of the row to mark as active. Derived in Shell from
   *  `nav.source`, so every canvas-changing entry point (Workbench tile,
   *  Inbox row, file click) keeps the tree's highlight in sync. Null when
   *  the current ViewerSource has no tree representation (sync, diff,
   *  agent-trace). */
  selectedPath?: string | null;
  /** Whether the Files tab is the visible left-pane tab. Controls
   *  scroll-into-view: we only yank the tree when the user can actually
   *  see it, so background canvas changes don't move scroll position. */
  active?: boolean;
  /** When set, a back arrow renders in the toolbar to return to the
   *  Workbench overview. Omit when the explorer is the only left-pane
   *  view (future full-time explorer mode). */
  onBack?: () => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const [rejectedFiles, setRejectedFiles] = useState<string[]>([]);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  // System-file visibility toggle: CLAUDE.md and `_*` files are
  // scaffolding the user usually doesn't want to see. Default off;
  // toolbar icon toggles.
  const [showSystemFiles, setShowSystemFiles] = useState(false);

  // Virtual resource state
  const [datastores] = useState<DataCollection[]>([]);
  const [datastoreItems] = useState<
    Record<string, { items: MemoryItem[]; hasMore: boolean; schema?: any }>
  >({});
  // (agents/workflows in-memory state was only used by the drag-emit
  // entity blob, which is now path-only. The engine's start*Sync calls
  // in App.tsx own the actual sync; FileExplorer reads them off disk
  // via fsList for tree rendering.)
  // (loadingResources removed — initial load is fast enough)

  const {
    error,
    collapsed,
    visible,
    conflictPaths,
    reload,
    toggle,
    toggleAll,
    toggleTitle,
    allExpanded,
    selectedRowRef,
  } = useTreeState(repo, fsTick, selectedPath, active, showSystemFiles);

  const onDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const targetPath = dropTargetPath;
    setDropTargetPath(null);
    setRejectedFiles([]);
    if (!repo) return;
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length === 0) return;

    // Pull URL-list out of the drag payload so we can recover original
    // filenames for web-app drags (Slack / Drive / etc.) where the
    // browser-exposed `File.name` is an opaque CDN id like
    // `T06KC1QJMSP-U07KXMWSZR7-1a3826e7787f-…`. The url-list typically
    // carries the public link whose path basename is the human name.
    const dragUrls: string[] = [];
    const uriList = e.dataTransfer.getData("text/uri-list");
    if (uriList) {
      for (const line of uriList.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#")) dragUrls.push(trimmed);
      }
    }
    if (dragUrls.length === 0) {
      const text = e.dataTransfer.getData("text/plain");
      if (text && /^https?:\/\//.test(text.trim())) dragUrls.push(text.trim());
    }

    // Determine which directory was the drop target
    const targetRel = targetPath ? relPath(repo, targetPath) : null;
    // Resolve the target's specific filestore subdirectory.
    let filestoreSubdir: string | null = null;
    if (targetRel) {
      const collectionMatch = targetRel.match(/^filestores\/([^/]+)/);
      if (collectionMatch) {
        const collection = collectionMatch[1];
        // Block drops on attachments — it's a server-managed surface.
        if (collection !== "attachments") {
          filestoreSubdir = `filestores/${collection}`;
        }
      } else if (targetRel === "filestores" || targetRel === "filestore") {
        filestoreSubdir = "filestores/library";
      }
    }

    if (filestoreSubdir) {
      // Drop into the resolved collection subdir — no file type
      // restriction.
      for (let i = 0; i < files.length; i += 1) {
        const f = files[i];
        const filename = friendlyDroppedFilename(f.name, dragUrls[i]);
        try {
          const buf = await f.arrayBuffer();
          const { fsStoreWriteFileBytes } = await import("../../lib/api");
          await fsStoreWriteFileBytes(repo, filename, buf, filestoreSubdir);
        } catch (err) {
          console.error(
            `failed to import ${filename} to ${filestoreSubdir}:`,
            err,
          );
        }
      }
      reload();
      return;
    }

    // Default: drop into the knowledge base (`knowledge/`)
    // with file type filtering.
    const acceptedRecords: { file: File; filename: string }[] = [];
    const rejected: string[] = [];
    for (let i = 0; i < files.length; i += 1) {
      const f = files[i];
      const filename = friendlyDroppedFilename(f.name, dragUrls[i]);
      if (isKbSupported(filename)) {
        acceptedRecords.push({ file: f, filename });
      } else {
        rejected.push(filename);
      }
    }
    if (rejected.length > 0) setRejectedFiles(rejected);

    for (const { file: f, filename } of acceptedRecords) {
      try {
        const buf = await f.arrayBuffer();
        await kbWriteFileBytes(repo, filename, buf);
      } catch (err) {
        console.error(`failed to import ${filename}:`, err);
      }
    }
    if (acceptedRecords.length > 0) reload();
  };

  if (!repo) {
    return <div className="explorer empty">No project folder open</div>;
  }
  if (error) {
    return <div className="explorer error">{error}</div>;
  }

  // KB articles live directly in `knowledge/`.
  const KB_PREFIX = "knowledge/";
  const isDeletable = (node: { is_dir: boolean; path: string }) => {
    if (node.is_dir || !repo) return false;
    return relPath(repo, node.path).startsWith(KB_PREFIX);
  };

  const handleDelete = async (node: { is_dir: boolean; path: string; name: string }) => {
    if (!isDeletable(node) || !repo) return;
    const filename = relPath(repo, node.path).slice(KB_PREFIX.length);
    await kbDeleteFile(repo, filename);
    reload();
    onFsChange?.();
  };

  // Icon mirrors the cycle state: collapse-all when fully expanded,
  // expand-all otherwise. Half-state leans toward "expand more".
  const ToggleIconCmp = allExpanded ? ChevronsDownUp : ChevronsUpDown;

  return (
    <div
      className={`explorer ${dragOver ? "drag-over" : ""}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <div className="explorer-toolbar">
        {onBack && (
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            onClick={onBack}
            title="Back to overview"
          >
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          onClick={toggleAll}
          title={toggleTitle}
        >
          <ToggleIconCmp size={14} strokeWidth={2} aria-hidden />
        </Button>
        <Button
          variant={showSystemFiles ? "subtle" : "ghost"}
          size="sm"
          iconOnly
          onClick={() => setShowSystemFiles((v) => !v)}
          title={
            showSystemFiles
              ? "Hide system files (CLAUDE.md, _schema.json, .claude/)"
              : "Show system files (CLAUDE.md, _schema.json, .claude/)"
          }
          aria-pressed={showSystemFiles}
        >
          <img src={sunburstIcon} alt="" className="explorer-system-icon" />
        </Button>
      </div>

      <ul className="tree">
        {/* Real file tree */}
        {visible.map((n) => {
          const rel = n.path.startsWith(repo + "/") ? n.path.slice(repo.length + 1) : n.name;
          const depth = rel.split("/").length - 1;
          const isCollapsedRow = collapsed.has(n.path);
          const colorClass = repo ? fileColorClass(n, repo, conflictPaths) : "";
          const badge = repo ? fileStatusBadge(n, repo, conflictPaths) : null;
          return (
            <li
              key={n.path}
              ref={n.path === selectedPath ? selectedRowRef : undefined}
              className={`tree-item ${n.is_dir ? "dir" : "file"} ${colorClass}${dropTargetPath === n.path ? " drop-target" : ""}${n.path === selectedPath ? " selected" : ""}`}
              style={{ paddingLeft: 8 + depth * 12 }}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ x: e.clientX, y: e.clientY, path: n.path, isDir: n.is_dir });
              }}
              onDragOver={(e) => {
                if (n.is_dir && e.dataTransfer.types.includes("Files")) {
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = "copy";
                  setDropTargetPath(n.path);
                }
              }}
              onDragLeave={() => {
                if (dropTargetPath === n.path) setDropTargetPath(null);
              }}
              onClick={() => {
                if (n.is_dir) {
                  toggle(n.path);
                  // Open viewer for:
                  //   - top-level `databases/` parent → databases-list
                  //     (collections overview with empty state)
                  //   - top-level datastore dirs (databases/<col>/) → table
                  //   - conversation thread subfolders
                  //     (databases/conversations/<ticketId>/) → chat thread
                  //   - top-level entity dirs (agents, workflows,
                  //     knowledge-base, filestore) → entity-folder view
                  //     so empty folders show a friendly notice instead
                  //     of nothing.
                  if (
                    rel === "databases" ||
                    rel.match(/^databases\/[^/]+$/) ||
                    rel.match(/^databases\/conversations\/[^/]+$/) ||
                    rel === "agents" ||
                    rel === "workflows" ||
                    // Flat KB directory: all articles in knowledge/
                    rel === "knowledge" ||
                    // 2026-04-27 filestore split:
                    //   - `filestores/`             → two-card overview
                    //   - `filestores/attachments/` → welcome stub +
                    //                                 per-ticket subfolders
                    //   - `filestores/library/`     → curated entity-folder
                    rel === "filestores" ||
                    rel === "filestores/attachments" ||
                    rel.match(/^filestores\/attachments\/[^/]+$/) ||
                    // Any direct child of filestores/ (library, docs-*, or
                    // any user-created collection) renders as an
                    // entity-folder file list.
                    rel.match(/^filestores\/[^/]+$/) ||
                    // On-demand markdown reports — sorted newest-first
                    // in the entity-folder view via filename prefix.
                    rel === "reports" ||
                    // Per-ticket traces folder → agent-trace-list
                    // view (every turn stacked with separators).
                    rel.match(/^traces\/[^/]+$/)
                  ) {
                    onSelect(n.path);
                  }
                  return;
                }
                onSelect(n.path);
              }}
              draggable={
                !n.is_dir ||
                rel.match(/^databases\/[^/]+$/) !== null ||
                rel.match(/^databases\/conversations\/[^/]+$/) !== null
              }
              onDragStart={(e) => {
                // Drop the file (or collection-directory) path as the
                // reference.
                e.dataTransfer.setData("application/x-openit-path", n.path);
                e.dataTransfer.setData("text/plain", n.path);
                e.dataTransfer.effectAllowed = "copy";
              }}
            >
              {n.is_dir ? (
                isCollapsedRow ? (
                  <ChevronRight size={12} strokeWidth={2} className="tree-chevron" aria-hidden />
                ) : (
                  <ChevronDown size={12} strokeWidth={2} className="tree-chevron" aria-hidden />
                )
              ) : (
                <span className="tree-chevron tree-chevron-spacer" aria-hidden />
              )}
              {n.is_dir ? (
                isCollapsedRow ? (
                  <FolderIcon size={14} strokeWidth={1.75} className="tree-icon tree-icon-folder" aria-hidden />
                ) : (
                  <FolderOpenIcon size={14} strokeWidth={1.75} className="tree-icon tree-icon-folder" aria-hidden />
                )
              ) : (
                <FileIcon size={14} strokeWidth={1.75} className="tree-icon tree-icon-file" aria-hidden />
              )}
              <span className="tree-item-name">{prettyName(n.name, rel, datastores, datastoreItems)}</span>
              {badge && <span className={`tree-badge ${colorClass}`}>{badge}</span>}
              {isDeletable(n) && (
                <Button
                  variant="ghost"
                  tone="destructive"
                  size="sm"
                  iconOnly
                  className="tree-delete-btn"
                  title={`Delete ${n.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(n);
                  }}
                >
                  ✕
                </Button>
              )}
            </li>
          );
        })}

        {/* No virtual sections — entities are written to disk and appear in the real tree */}
      </ul>

      {/* Rejected files message */}
      {rejectedFiles.length > 0 && (
        <div className="kb-conflicts">
          <div className="kb-conflicts-header">Unsupported files skipped</div>
          <ul>
            {rejectedFiles.map((name) => (
              <li key={name}>
                <code>{name}</code>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="explorer-toggle"
            onClick={() => setRejectedFiles([])}
            style={{ marginTop: 4 }}
          >
            Dismiss
          </button>
        </div>
      )}

      {contextMenu && (
        <ContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onDeleted={() => reload()}
        />
      )}
    </div>
  );
}
