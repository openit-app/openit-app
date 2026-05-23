/// Entity-folder sub-viewer extracted from Viewer.tsx.
/// Handles `entity-folder` rendering — the generic top-level folder
/// view for knowledge-base, library, reports, skills, scripts, and
/// per-ticket attachments.

import { useEffect, useState } from "react";
import { fsReveal } from "../../lib/api";
import type { ViewerSource } from "../viewerTypes";
import { EntityCardGrid } from "../EntityCardGrid";
import { FileThumbnail, isImageFile } from "../FileThumbnail";
import { FileTypeBadge, formatBytes } from "../FileTypeBadge";
import { Button } from "../../ui";
import { writeToActiveSession } from "../activeSession";
import {
  toRepoRelative,
  uploadFilesToSubdir,
  deleteFileInSubdir,
  ENTITY_FOLDER_EMPTY_COPY,
} from "./viewerHelpers";

export function EntityFolderBody({
  source,
  repo,
  onOpenPath,
  onShowSource,
  showToast,
  reportError,
  onFsChange,
}: {
  source: Extract<ViewerSource, { kind: "entity-folder" }>;
  repo: string;
  onOpenPath?: (path: string) => void | Promise<void>;
  onShowSource?: (source: ViewerSource) => void;
  showToast: (msg: string) => void;
  reportError: string | null;
  onFsChange?: () => void;
}) {
  const [sortReversed, setSortReversed] = useState<Record<string, boolean>>({});
  const [folderDragOver, setFolderDragOver] = useState(false);
  const [folderUploadError, setFolderUploadError] = useState<string | null>(null);
  // Optimistically hide deleted files immediately. The viewer's
  // `source.files` is a snapshot from when the path was resolved and
  // doesn't auto-refresh after a delete — so without this the card
  // would stick around until the user navigated away and back, which
  // looked like delete-didn't-work. Reset on path change.
  const [hiddenPaths, setHiddenPaths] = useState<Set<string>>(new Set());
  useEffect(() => {
    setHiddenPaths(new Set());
  }, [source.path]);

  const isReport = source.entity === "reports";
  const reversed = !!sortReversed[source.path];
  const visibleFiles = source.files.filter((f) => !hiddenPaths.has(f.path));
  const orderedFiles = reversed ? [...visibleFiles].reverse() : visibleFiles;
  const cards = orderedFiles.map((f) => {
    let slug = f.displayName;
    let dateLabel = "";
    if (isReport) {
      const m = f.displayName.match(
        /^(\d{4})-(\d{2})-(\d{2})(?:-(\d{2})(\d{2}))?-(.+)$/,
      );
      if (m) {
        const [, yyyy, mm, dd, hh, mi, parsedSlug] = m;
        slug = parsedSlug;
        const monthShort = [
          "Jan", "Feb", "Mar", "Apr", "May", "Jun",
          "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
        ][Math.max(0, Math.min(11, Number(mm) - 1))];
        const yearTail =
          new Date().getFullYear() === Number(yyyy) ? "" : `, ${yyyy}`;
        dateLabel =
          hh && mi
            ? `${monthShort} ${Number(dd)}${yearTail} · ${hh}:${mi}`
            : `${monthShort} ${Number(dd)}${yearTail}`;
      }
    }
    const useTypeBadge =
      (source.entity === "library" ||
        source.entity === "reports" ||
        source.entity === "knowledge-base" ||
        source.entity === "skills" ||
        source.entity === "scripts") &&
      !isImageFile(f.path);
    const sizeLabel = formatBytes(f.size);
    return {
      key: f.path,
      title: isReport ? f.description || slug : f.displayName,
      description: isReport ? undefined : f.description,
      meta: isReport
        ? dateLabel
        : (source.entity === "knowledge" || source.entity === "knowledge-base")
          ? undefined
          : sizeLabel || undefined,
      icon: isImageFile(f.path) ? (
        <FileThumbnail absPath={f.path} />
      ) : useTypeBadge ? (
        <FileTypeBadge filename={f.name} />
      ) : undefined,
      onClick: () => onOpenPath && void onOpenPath(f.path),
      onDelete: repo
        ? async () => {
            const deleted = await deleteFileInSubdir(
              repo,
              source.path,
              f.name,
              setFolderUploadError,
              showToast,
              onFsChange,
            );
            // Optimistic hide only after the file is actually gone.
            // `source.files` is a snapshot, so it'd still include the
            // deleted file until the fs watcher fires a refresh; this
            // bridges that gap. If the user cancelled or the delete
            // failed, `deleted` is false and the card stays put.
            if (deleted) {
              setHiddenPaths((prev) => new Set(prev).add(f.path));
            }
          }
        : undefined,
      onReveal: () => void fsReveal(f.path).catch(console.error),
      onRun:
        source.entity === "scripts" &&
        /\.(mjs|js|cjs|py)$/i.test(f.path) &&
        onShowSource
          ? async () => {
              try {
                const { scriptRun } = await import("../../lib/api");
                const out = await scriptRun(repo, f.path);
                onShowSource({
                  kind: "script-output",
                  script: f.path,
                  stdout: out.stdout,
                  stderr: out.stderr,
                  exitCode: out.exitCode,
                  durationMs: out.durationMs,
                });
              } catch (err) {
                const reason = err instanceof Error ? err.message : String(err);
                console.error(`[script-run] ${f.name} failed:`, err);
                showToast(`Run failed: ${reason}`);
              }
            }
          : undefined,
      onAddToClaude: (() => {
        const rel = repo ? toRepoRelative(repo, f.path) : f.name;
        switch (source.entity) {
          case "skills":
            return () => { void writeToActiveSession(`/${f.displayName}\r`); };
          case "knowledge-base":
            return () => { void writeToActiveSession(`Read the knowledge base article at ${rel}\r`); };
          case "scripts":
            return () => { void writeToActiveSession(`Run the script at ${rel}\r`); };
          case "reports":
            return () => { void writeToActiveSession(`Read the report at ${rel}\r`); };
          default:
            return undefined;
        }
      })(),
    };
  });

  const acceptsDrop =
    source.entity === "library" ||
    source.entity === "knowledge-base" ||
    source.entity === "skills" ||
    source.entity === "scripts";
  const subdir = source.path;
  const showDropZone = acceptsDrop && cards.length === 0;

  return (
    <div
      className={`viewer-summary${
        acceptsDrop ? " viewer-summary-droppable" : ""
      }${acceptsDrop && folderDragOver ? " viewer-summary-drag" : ""}${
        showDropZone ? " viewer-summary-dropzone" : ""
      }`}
      onDragOver={(e) => {
        if (!Array.from(e.dataTransfer.types).includes("Files")) return;
        e.preventDefault();
        e.stopPropagation();
        if (!acceptsDrop || !repo) {
          e.dataTransfer.dropEffect = "none";
          return;
        }
        e.dataTransfer.dropEffect = "copy";
        setFolderDragOver(true);
      }}
      onDragLeave={() => {
        if (acceptsDrop) setFolderDragOver(false);
      }}
      onDrop={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        setFolderDragOver(false);
        if (!acceptsDrop || !repo) return;
        const files = Array.from(e.dataTransfer.files ?? []);
        if (files.length === 0) return;
        await uploadFilesToSubdir(repo, subdir, files, setFolderUploadError, showToast);
      }}
    >
      {source.entity === "reports" && reportError && (
        <p className="viewer-edit-error">{reportError}</p>
      )}
      {folderUploadError && (
        <p className="viewer-edit-error">{folderUploadError}</p>
      )}
      {cards.length > 3 && (
        <div className="viewer-folder-toolbar">
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              setSortReversed((prev) => ({
                ...prev,
                [source.path]: !prev[source.path],
              }))
            }
            title="Reverse sort order"
          >
            {isReport
              ? reversed
                ? "oldest first"
                : "newest first"
              : reversed
                ? "Z → A"
                : "A → Z"}
          </Button>
        </div>
      )}
      <EntityCardGrid
        kind={source.entity}
        cards={cards}
        empty={
          <p className="summary-desc">
            {ENTITY_FOLDER_EMPTY_COPY[source.entity]}
            {showDropZone && (
              <span className="viewer-summary-dropzone-hint">
                Drop files here from Finder to add them.
              </span>
            )}
          </p>
        }
      />
    </div>
  );
}
