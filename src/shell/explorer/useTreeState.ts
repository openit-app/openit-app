import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fsList, type FileNode } from "../../lib/api";
import { subscribeConflicts, type AggregatedConflict } from "../../lib/syncEngine";

/**
 * Manages the file-explorer tree: node list, collapse state,
 * scroll-to-active, visibility filtering, and bulk toggle.
 */
export function useTreeState(
  repo: string | null,
  fsTick: number | undefined,
  selectedPath: string | null | undefined,
  active: boolean | undefined,
  showSystemFiles: boolean,
) {
  const [nodes, setNodes] = useState<FileNode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Engine conflict aggregate — drives the per-file conflict marker
  // (⚠) on canonicals so the user can see at a glance which files
  // need resolution. The shadow files themselves are hidden from the
  // tree (see `visible` below).
  const [engineConflicts, setEngineConflicts] = useState<AggregatedConflict[]>([]);
  useEffect(() => subscribeConflicts(setEngineConflicts), []);
  const conflictPaths = useMemo(
    () => new Set(engineConflicts.map((c) => c.workingTreePath)),
    [engineConflicts],
  );

  // Ref captures the latest selectedPath without forcing reload to
  // re-fire on every canvas change.
  const selectedPathRef = useRef(selectedPath);
  useEffect(() => {
    selectedPathRef.current = selectedPath;
  }, [selectedPath]);

  const hasCollapsedOnceRef = useRef(false);

  const reload = useCallback(() => {
    if (!repo) {
      setNodes([]);
      return;
    }
    fsList(repo)
      .then((n) => {
        setNodes(n);
        setError(null);
        // Collapse all dirs on first load only
        if (!hasCollapsedOnceRef.current && n.length > 0) {
          hasCollapsedOnceRef.current = true;
          const next = new Set(n.filter((nd) => nd.is_dir).map((nd) => nd.path));
          // Pre-expand ancestors of the active canvas item so the
          // highlight is visible the moment the user lands on Files.
          const sp = selectedPathRef.current;
          if (sp && sp.startsWith(`${repo}/`)) {
            let cursor = sp;
            while (true) {
              const slash = cursor.lastIndexOf("/");
              if (slash <= repo.length) break;
              cursor = cursor.slice(0, slash);
              next.delete(cursor);
            }
          }
          setCollapsed(next);
        }
      })
      .catch((e) => setError(String(e)));
  }, [repo]);

  useEffect(() => {
    reload();
  }, [reload, fsTick]);

  // Ref + last-scrolled marker so we only yank the tree once per
  // (path, becoming-active) transition.
  const selectedRowRef = useRef<HTMLLIElement | null>(null);
  const lastScrolledPathRef = useRef<string | null>(null);

  // Reveal the active canvas item: drop every ancestor of `selectedPath`
  // out of the `collapsed` set so the row is rendered.
  useEffect(() => {
    if (!selectedPath || !repo) return;
    if (!selectedPath.startsWith(`${repo}/`)) return;
    setCollapsed((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set(prev);
      let changed = false;
      let cursor = selectedPath;
      while (true) {
        const slash = cursor.lastIndexOf("/");
        if (slash <= repo.length) break;
        cursor = cursor.slice(0, slash);
        if (next.delete(cursor)) changed = true;
      }
      return changed ? next : prev;
    });
  }, [selectedPath, repo]);

  // System / scaffolding entries hidden by default.
  const isSystemEntry = (n: FileNode): boolean => {
    if (!repo) return false;
    const rel = n.path.startsWith(repo + "/") ? n.path.slice(repo.length + 1) : n.path;
    if (rel === "CLAUDE.md") return true;
    if (rel === ".claude" || rel.startsWith(".claude/")) return true;
    if (rel === ".openit" || rel.startsWith(".openit/")) return true;
    if (n.name.startsWith("_")) return true;
    return false;
  };

  const visible = useMemo(() => {
    if (!repo) return [];
    return nodes.filter((n) => {
      // Hide conflict shadows from the tree.
      if (!n.is_dir && n.name.includes(".server.")) return false;
      if (!showSystemFiles && isSystemEntry(n)) return false;
      // PIN-5793: `databases/conversations/` is now a synced collection
      // (`openit-conversations`) — the file explorer renders it like
      // any other database.
      for (const c of collapsed) {
        if (n.path !== c && n.path.startsWith(c + "/")) return false;
      }
      return true;
    });
  }, [nodes, collapsed, repo, showSystemFiles]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `visible`
  // is intentionally part of the dep set so we re-attempt scroll once
  // the ancestor-expand effect renders the row.
  useEffect(() => {
    if (!active || !selectedPath) return;
    if (lastScrolledPathRef.current === selectedPath) return;
    const el = selectedRowRef.current;
    if (!el) return;
    el.scrollIntoView({ block: "nearest", behavior: "auto" });
    lastScrolledPathRef.current = selectedPath;
  }, [selectedPath, active, visible]);

  const toggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  // Bulk toggle helpers
  const allDirs = nodes.filter((n) => n.is_dir).map((n) => n.path);
  const repoPrefix = repo ? `${repo}/` : "";
  const topLevelDirs = repo
    ? allDirs.filter((p) => p.startsWith(repoPrefix) && !p.slice(repoPrefix.length).includes("/"))
    : [];
  const deeperDirs = allDirs.filter((p) => !topLevelDirs.includes(p));
  const allCollapsed = allDirs.length > 0 && allDirs.every((d) => collapsed.has(d));
  const allExpanded = allDirs.length > 0 && collapsed.size === 0;
  const topLevelOnly =
    topLevelDirs.length > 0 &&
    topLevelDirs.every((d) => !collapsed.has(d)) &&
    deeperDirs.every((d) => collapsed.has(d));

  // Cycle: all-collapsed → top-level-only → fully-expanded → back.
  const toggleAll = () => {
    if (allCollapsed) {
      setCollapsed(new Set(deeperDirs));
    } else if (topLevelOnly) {
      setCollapsed(new Set());
    } else {
      setCollapsed(new Set(allDirs));
    }
  };

  // Title hint reflects what the NEXT click will do.
  const toggleTitle = allCollapsed
    ? "Open top-level folders"
    : topLevelOnly
      ? "Expand all"
      : "Collapse all";

  return {
    nodes,
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
  };
}
