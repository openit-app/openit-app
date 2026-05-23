import { useCallback, useEffect, useRef, useState } from "react";
import { fsList, fsRead, entityRemoveDir, type FileNode } from "../lib/api";
import { listTasks, tallyTasks, type TaskCounts } from "../lib/tasks";
import { listInstalled as listInstalledTools } from "../lib/toolsInstall";
import { iconForKey, type ToneKey } from "./entityIcons";
import {
  loadWorkstationConfig,
  saveWorkstationConfig,
  discoverTiles,
  mergeConfigWithDiscovery,
  type WorkstationConfig,
  type ResolvedTile,
  type TileConfig,
} from "../lib/workstationConfig";
import { IconPicker } from "./IconPicker";
import { Button } from "../ui";
import { confirmDelete } from "./viewers";
import { useToast } from "../Toast";

// ── Helpers ──────────────────────────────────────────────────────────

function directChildren(items: FileNode[], rootAbs: string): FileNode[] {
  // Path separator differs across platforms (Windows `\` vs Unix `/`),
  // and `rootAbs` and `n.path` may not use the same one. Normalize both
  // to forward slashes before the prefix/tail check so the count works
  // on both. (Workstation tile counts were silently 0 on Windows
  // because the prefix `<root>/` never matched paths with `\`.)
  const root = rootAbs.replace(/\\/g, "/");
  const prefix = `${root}/`;
  return items.filter((n) => {
    const p = n.path.replace(/\\/g, "/");
    if (!p.startsWith(prefix)) return false;
    const tail = p.slice(prefix.length);
    return tail.length > 0 && !tail.includes("/");
  });
}

function countWithMode(
  items: FileNode[],
  mode: "dirs" | "json-rows" | "files" | "custom",
): number {
  return items.filter((n) => {
    if (n.name.startsWith(".") || n.name === "_schema.json") return false;
    if (n.name.includes(".server.")) return false;
    if (mode === "dirs") return n.is_dir;
    if (mode === "json-rows") return !n.is_dir && n.name.endsWith(".json");
    return !n.is_dir;
  }).length;
}

type GridLayout = "single" | "grid";

// ── Component ────────────────────────────────────────────────────────

export function Workbench({
  repo,
  fsTick,
  onOpen,
  onShowFiles,
  onCollapse,
}: {
  repo: string | null;
  fsTick: number;
  onOpen: (path: string) => void;
  onShowFiles: () => void;
  /// Optional collapse-sidebar handler. When provided, a small chevron
  /// button appears next to the TODAY hero card. Omit to hide the
  /// toggle (e.g. embeds that don't own sidebar layout).
  onCollapse?: () => void;
}) {
  const [config, setConfig] = useState<WorkstationConfig | null>(null);
  const [mainTiles, setMainTiles] = useState<ResolvedTile[]>([]);
  const [moreTiles, setMoreTiles] = useState<ResolvedTile[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const { show: showToast } = useToast();
  // Per-tile in-flight delete tracking (PIN-6612). Rapid clicks on the
  // same store's trash glyph dedupe to a single backend
  // `entityRemoveDir`; failure surfaces as a critical toast instead of
  // silent `console.error`.
  const deletingTilesRef = useRef<Set<string>>(new Set());
  const prevCountsRef = useRef<Record<string, number> | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Suppress count-based highlights for the first 15 seconds after
  // mount. The plugin sync (syncSkillsToDisk) writes skills/scripts
  // asynchronously after vault open — file counts jump as those files
  // land, which would flash tiles on every fresh install. The grace
  // period lets the sync settle before we start watching for real
  // content changes. Imperative highlights via highlight.json are
  // NOT suppressed — they're always intentional.
  const mountedAtRef = useRef(Date.now());
  const lastHighlightTsRef = useRef(0);
  // On first successful read of highlight.json, seed the timestamp
  // without pulsing — prevents stale highlights from a previous
  // session replaying on every app launch. If the file doesn't
  // exist (fresh install), the flag stays false so the first real
  // write by the getting-started tour fires normally.
  const highlightSeededRef = useRef(false);
  const [highlightedStations, setHighlightedStations] = useState<Set<string>>(new Set());
  const [taskCounts, setTaskCounts] = useState<TaskCounts>({ todo: 0, inProgress: 0, complete: 0, total: 0 });
  const openTaskCount = taskCounts.todo + taskCounts.inProgress;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [layout, setLayout] = useState<GridLayout>("single");
  const [customizing, setCustomizing] = useState<ResolvedTile | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    tile: ResolvedTile;
    x: number;
    y: number;
    section: "main" | "more";
  } | null>(null);

  // Load config + discover tiles + count items
  useEffect(() => {
    if (!repo) {
      setCounts({});
      setTaskCounts({ todo: 0, inProgress: 0, complete: 0, total: 0 });
      setMainTiles([]);
      setMoreTiles([]);
      return;
    }
    let cancelled = false;

    (async () => {
      // Load config and discover in parallel
      const [cfg, discovered] = await Promise.all([
        loadWorkstationConfig(repo),
        discoverTiles(repo),
      ]);
      if (cancelled) return;
      setConfig(cfg);

      const { main, more } = mergeConfigWithDiscovery(cfg, discovered);
      setMainTiles(main);
      setMoreTiles(more);

      // Count items for all tiles
      const allTiles = [...main, ...more];
      const next: Record<string, number> = {};

      await Promise.all(
        allTiles.map(async (t) => {
          // Tools — custom counting via which detection
          if (t.rel === "tools") {
            try {
              const cliCount = (await listInstalledTools()).size;
              let mcpCount = 0;
              try {
                const { listInstalledMcps } = await import("../lib/api");
                mcpCount = (await listInstalledMcps(repo ?? undefined)).length;
              } catch { /* MCP scan optional */ }
              next[t.rel] = cliCount + mcpCount;
            } catch {
              next[t.rel] = 0;
            }
            return;
          }
          // Commands (filestores/commands) — count both .claude/skills dirs + custom skills
          if (t.rel === "filestores/commands") {
            let slashCount = 0;
            let customCount = 0;
            try {
              const slashRoot = `${repo}/.claude/skills`;
              const slashItems = await fsList(slashRoot);
              slashCount = directChildren(slashItems, slashRoot).filter((n) => n.is_dir).length;
            } catch { /* .claude/skills/ may not exist */ }
            try {
              const customRoot = `${repo}/filestores/commands`;
              const customItems = await fsList(customRoot);
              customCount = directChildren(customItems, customRoot).filter(
                (n) => !n.is_dir && n.name.endsWith(".md"),
              ).length;
            } catch { /* filestores/commands/ may not exist */ }
            next[t.rel] = slashCount + customCount;
            return;
          }
          // Everything else — standard counting
          try {
            const rootAbs = `${repo}/${t.rel}`;
            const items = await fsList(rootAbs);
            const direct = directChildren(items, rootAbs);
            next[t.rel] = countWithMode(direct, t.countMode);
          } catch {
            next[t.rel] = 0;
          }
        }),
      );

      if (cancelled) return;

      // Highlight stations that gained items (suppressed during the
      // post-mount grace period so plugin sync doesn't flash tiles).
      const settled = Date.now() - mountedAtRef.current > 15_000;
      if (prevCountsRef.current !== null && settled) {
        const newHighlights = new Set<string>();
        for (const rel of Object.keys(next)) {
          const prev = prevCountsRef.current[rel] ?? 0;
          if (next[rel] > prev) newHighlights.add(rel);
        }
        if (newHighlights.size > 0) {
          setHighlightedStations(newHighlights);
          clearTimeout(highlightTimerRef.current);
          highlightTimerRef.current = setTimeout(
            () => setHighlightedStations(new Set()),
            5000,
          );
        }
      }
      prevCountsRef.current = next;
      setCounts(next);

      // Task counts for the hero card.
      try {
        const tasks = await listTasks(repo);
        if (!cancelled) setTaskCounts(tallyTasks(tasks));
      } catch {
        if (!cancelled) setTaskCounts({ todo: 0, inProgress: 0, complete: 0, total: 0 });
      }

      // Imperative tile highlight via .openit/highlight.json.
      // Claude writes {"tiles":["knowledge"],"ts":<ms>} when
      // it wants a tile to flash (e.g. during the getting-started
      // tour). We deduplicate by timestamp like flash.json.
      try {
        const raw = await fsRead(`${repo}/.openit/highlight.json`);
        const parsed = JSON.parse(raw);
        if (
          parsed &&
          Array.isArray(parsed.tiles) &&
          typeof parsed.ts === "number" &&
          parsed.ts > lastHighlightTsRef.current
        ) {
          lastHighlightTsRef.current = parsed.ts;
          // First successful read after mount: seed the timestamp
          // so stale highlights from a previous session don't
          // replay. Skip the pulse this one time only.
          if (!highlightSeededRef.current) {
            highlightSeededRef.current = true;
          } else if (!cancelled) {
            setHighlightedStations(new Set(parsed.tiles));
            clearTimeout(highlightTimerRef.current);
            highlightTimerRef.current = setTimeout(
              () => setHighlightedStations(new Set()),
              5000,
            );
          }
        }
      } catch { /* highlight.json doesn't exist or is malformed — fine */ }
    })();

    return () => {
      cancelled = true;
    };
  }, [repo, fsTick]);

  // Dismiss context menu on click outside
  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = () => setContextMenu(null);
    window.addEventListener("click", dismiss);
    return () => window.removeEventListener("click", dismiss);
  }, [contextMenu]);

  // ── Config mutation helpers ──────────────────────────────────────
  // Use a ref so callbacks always read the latest config — avoids the
  // stale-closure race where two rapid operations (e.g. promote then
  // customize) both read the same snapshot and the second overwrites
  // the first on disk.
  const configRef = useRef<WorkstationConfig | null>(config);
  configRef.current = config;
  const mainTilesRef = useRef(mainTiles);
  mainTilesRef.current = mainTiles;
  const moreTilesRef = useRef(moreTiles);
  moreTilesRef.current = moreTiles;

  const persistConfig = useCallback(
    async (newConfig: WorkstationConfig) => {
      configRef.current = newConfig;
      setConfig(newConfig);
      if (repo) await saveWorkstationConfig(repo, newConfig);
    },
    [repo],
  );

  const promote = useCallback(
    async (rel: string) => {
      const cfg = configRef.current;
      if (!cfg || !repo) return;
      // The tile may be in config.more (previously persisted) or only in
      // the resolved moreTiles (auto-discovered, not yet in config).
      const tile = cfg.more.find((t) => t.rel === rel) ?? { rel };
      const newConfig: WorkstationConfig = {
        main: [...cfg.main, tile],
        more: cfg.more.filter((t) => t.rel !== rel),
      };
      await persistConfig(newConfig);
      const movedTile = moreTilesRef.current.find((t) => t.rel === rel);
      if (movedTile) setMainTiles((prev) => [...prev, movedTile]);
      setMoreTiles((prev) => prev.filter((t) => t.rel !== rel));
    },
    [repo, persistConfig],
  );

  const demote = useCallback(
    async (rel: string) => {
      const cfg = configRef.current;
      if (!cfg || !repo) return;
      const tile = cfg.main.find((t) => t.rel === rel);
      if (!tile) return;
      const newConfig: WorkstationConfig = {
        main: cfg.main.filter((t) => t.rel !== rel),
        more: [...cfg.more, tile],
      };
      await persistConfig(newConfig);
      const movedTile = mainTilesRef.current.find((t) => t.rel === rel);
      if (movedTile) setMoreTiles((prev) => [...prev, movedTile]);
      setMainTiles((prev) => prev.filter((t) => t.rel !== rel));
    },
    [repo, persistConfig],
  );

  const removeTile = useCallback(
    async (rel: string) => {
      const cfg = configRef.current;
      if (!cfg || !repo) return;
      const newConfig: WorkstationConfig = {
        main: cfg.main.filter((t) => t.rel !== rel),
        more: cfg.more.filter((t) => t.rel !== rel),
      };
      await persistConfig(newConfig);
      setMainTiles((prev) => prev.filter((t) => t.rel !== rel));
      setMoreTiles((prev) => prev.filter((t) => t.rel !== rel));
    },
    [repo, persistConfig],
  );

  const deleteStore = useCallback(
    async (tile: ResolvedTile) => {
      if (!repo) return;
      // Claim the lock BEFORE awaiting the confirm dialog — otherwise
      // a rapid second click also passes this gate (the first call is
      // still awaiting confirm, hasn't called `add` yet) and both
      // dialogs end up opening. PIN-6612 ensemble-review finding.
      if (deletingTilesRef.current.has(tile.rel)) return;
      deletingTilesRef.current.add(tile.rel);
      let confirmed = false;
      try {
        const ok = await confirmDelete(
          `Delete "${tile.label}" and all its contents?\n\nThis cannot be undone.`,
          "Delete store?",
        );
        if (!ok) return;
        confirmed = true;
        await entityRemoveDir(repo, tile.rel);
        await removeTile(tile.rel);
        showToast({ message: `Deleted ${tile.label}`, tone: "success" });
      } catch (err) {
        if (!confirmed) {
          // Threw during the confirm phase — propagate as silent
          // failure of the dialog, not a user-visible delete error.
          console.error("[workbench-delete] confirm failed:", err);
          return;
        }
        const reason = err instanceof Error ? err.message : String(err);
        console.error("[workbench-delete] failed:", err);
        showToast({
          title: `Failed to delete ${tile.label}`,
          message: reason,
          tone: "critical",
        });
      } finally {
        deletingTilesRef.current.delete(tile.rel);
      }
    },
    [repo, removeTile, showToast],
  );

  const customizeTile = useCallback(
    async (rel: string, icon: string, tone: ToneKey, label: string, description?: string) => {
      const cfg = configRef.current;
      if (!cfg || !repo) return;
      const patch: Record<string, unknown> = { icon, tone, label };
      if (description !== undefined) patch.description = description || undefined;
      const update = (tiles: TileConfig[]) =>
        tiles.map((t) =>
          t.rel === rel ? { ...t, ...patch } : t,
        );
      const inMain = cfg.main.some((t) => t.rel === rel);
      const inMore = cfg.more.some((t) => t.rel === rel);
      let newConfig: WorkstationConfig;
      if (inMain) {
        newConfig = { main: update(cfg.main), more: cfg.more };
      } else if (inMore) {
        newConfig = { main: cfg.main, more: update(cfg.more) };
      } else {
        newConfig = {
          main: cfg.main,
          more: [...cfg.more, { rel, ...patch }],
        };
      }
      await persistConfig(newConfig);
      const updateResolved = (tiles: ResolvedTile[]) =>
        tiles.map((t) =>
          t.rel === rel ? { ...t, icon, tone, label } : t,
        );
      setMainTiles(updateResolved);
      setMoreTiles(updateResolved);
    },
    [repo, persistConfig],
  );

  // ── Derived state ────────────────────────────────────────────────

  const openTasks = () => {
    if (repo) onOpen(`${repo}/tasks`);
  };

  // Tiles that can be deleted (have a folder on disk — not system
  // synthetics like "tools" or parent views like "databases").
  // Only the primitive container folders (top-level containers) and
  // system entities are non-deletable. Everything inside them is fair
  // game. `agents/` is no longer a workstation primitive (CC is the
  // only agent), but the folder is still backend-relevant — guard
  // against deletion in case a stale config still surfaces a tile for
  // it. `tasks` is the new pure-task-list primitive (PR #180).
  const PRIMITIVES = new Set(["databases", "filestores", "knowledge", "reports", "agents", "tasks"]);
  const SYSTEM = new Set(["tools", "traces"]);
  const isDeletable = (rel: string) => {
    return !PRIMITIVES.has(rel) && !SYSTEM.has(rel);
  };

  return (
    <div className="workbench">
      {/* ── Collapse toggle ───────────────────────────────── */}
      {onCollapse && (
        <div className="workbench-collapse-bar">
          <button
            type="button"
            className="workbench-collapse-btn"
            onClick={onCollapse}
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
            aria-expanded={true}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path
                d="M9 3l-4 4 4 4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      )}
      {/* ── TODAY hero card — count of open tasks (todo + in-progress) ── */}
      <div
        className={`workbench-today${openTaskCount > 0 ? " has-escalated" : ""}`}
      >
        <button
          type="button"
          className="workbench-today-main"
          onClick={openTasks}
          disabled={!repo}
          title={
            openTaskCount > 0
              ? "Open your task list"
              : "Open your task list (nothing waiting)"
          }
        >
          <span className="workbench-today-topline">
            <span className="workbench-today-eyebrow">TODAY</span>
            <span className="workbench-today-brand" aria-hidden>
              Open<em>IT</em>
            </span>
          </span>
          {openTaskCount === 0 ? (
            <span className="workbench-today-hero workbench-today-hero-clean">
              <span className="workbench-today-clean">Clean slate</span>
            </span>
          ) : (
            <span className="workbench-today-hero">
              <span className="workbench-today-number">{openTaskCount}</span>
              <span className="workbench-today-label">
                open task{openTaskCount === 1 ? "" : "s"}
              </span>
            </span>
          )}
        </button>
      </div>

      {/* ── Main station cards ────────────────────────────── */}
      <div className={`workbench-stations workbench-stations-${layout}`}>
        {mainTiles.map((t) => {
          const tileIcon = iconForKey(t.icon);
          return (
            <button
              key={t.rel}
              type="button"
              className={`station entity-tone-${t.tone}${highlightedStations.has(t.rel) ? " station-highlight" : ""}`}
              onClick={() => repo && onOpen(`${repo}/${t.openRel ?? t.rel}`)}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ tile: t, x: e.clientX, y: e.clientY, section: "main" });
              }}
              title={t.label}
            >
              <span className="station-glyph" aria-hidden>
                {tileIcon}
              </span>
              <span className="station-body">
                <span className="station-label">{t.label}</span>
                <span className="station-count">
                  {counts[t.rel] ?? "·"}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/* ── More section ──────────────────────────────────── */}
      <div className="workbench-more">
        <button
          type="button"
          className="workbench-more-toggle"
          onClick={() => setPickerOpen((v) => !v)}
        >
          <span className="workbench-files-caret">
            {pickerOpen ? "▾" : "▸"}
          </span>
          <span>More</span>
        </button>
        {pickerOpen && (
          <div className="workbench-more-body">
            {moreTiles.length > 0 && (
              <div className="workbench-picker-grid">
                {moreTiles.map((t) => {
                  const tileIcon = iconForKey(t.icon);
                  return (
                    <button
                      key={t.rel}
                      type="button"
                      className={`station station-picker entity-tone-${t.tone}`}
                      onClick={() =>
                        repo && onOpen(`${repo}/${t.openRel ?? t.rel}`)
                      }
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setContextMenu({ tile: t, x: e.clientX, y: e.clientY, section: "more" });
                      }}
                      title={t.label}
                    >
                      <span className="station-glyph" aria-hidden>
                        {tileIcon}
                      </span>
                      <span className="station-body">
                        <span className="station-label">{t.label}</span>
                      </span>
                      <span
                        className="station-add-hint"
                        title={`Pin ${t.label} to workstation`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void promote(t.rel);
                        }}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.stopPropagation();
                            void promote(t.rel);
                          }
                        }}
                      >
                        +
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            <button
              type="button"
              className="workbench-files-link"
              onClick={onShowFiles}
            >
              File explorer{" "}
              <span className="arrow" aria-hidden="true">
                &rarr;
              </span>
            </button>
          </div>
        )}
      </div>

      {/* ── Context menu ──────────────────────────────────── */}
      {contextMenu && (
        <>
          <div
            className="context-menu-overlay"
            onClick={() => setContextMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu(null);
            }}
          />
          <div
            className="context-menu"
            style={{ top: contextMenu.y, left: contextMenu.x }}
            role="menu"
          >
            {contextMenu.section === "more" && (
              <Button
                variant="ghost"
                className="context-menu-item"
                onClick={() => {
                  void promote(contextMenu.tile.rel);
                  setContextMenu(null);
                }}
              >
                Add to main
              </Button>
            )}
            {contextMenu.section === "main" && (
              <Button
                variant="ghost"
                className="context-menu-item"
                onClick={() => {
                  void demote(contextMenu.tile.rel);
                  setContextMenu(null);
                }}
              >
                Move to More
              </Button>
            )}
            <Button
              variant="ghost"
              className="context-menu-item"
              onClick={() => {
                setCustomizing(contextMenu.tile);
                setContextMenu(null);
              }}
            >
              Customize
            </Button>
            {isDeletable(contextMenu.tile.rel) && (
              <Button
                variant="ghost"
                tone="destructive"
                className="context-menu-item"
                onClick={() => {
                  void deleteStore(contextMenu.tile);
                  setContextMenu(null);
                }}
              >
                Delete
              </Button>
            )}
          </div>
        </>
      )}

      {/* ── Icon/tone customizer ──────────────────────────── */}
      {customizing && (
        <IconPicker
          currentIcon={customizing.icon}
          currentTone={customizing.tone}
          currentLabel={customizing.label}
          currentDescription={
            configRef.current
              ? [...configRef.current.main, ...configRef.current.more].find((t) => t.rel === customizing.rel)?.description
              : undefined
          }
          onSave={(icon, tone, label, description) => {
            void customizeTile(customizing.rel, icon, tone, label, description);
            setCustomizing(null);
          }}
          onCancel={() => setCustomizing(null)}
        />
      )}

      {/* ── Layout toggle ─────────────────────────────────── */}
      <div className="workbench-layout-bar">
        <button
          type="button"
          className={`workbench-layout-btn${layout === "single" ? " active" : ""}`}
          onClick={() => setLayout("single")}
          title="Single column"
          aria-label="Single column layout"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <rect
              x="1" y="1" width="12" height="3.5" rx="1"
              stroke="currentColor" strokeWidth="1.2"
            />
            <rect
              x="1" y="6.5" width="12" height="3.5" rx="1"
              stroke="currentColor" strokeWidth="1.2"
            />
          </svg>
        </button>
        <button
          type="button"
          className={`workbench-layout-btn${layout === "grid" ? " active" : ""}`}
          onClick={() => setLayout("grid")}
          title="Two columns"
          aria-label="Two column layout"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <rect
              x="1" y="1" width="5" height="5" rx="1"
              stroke="currentColor" strokeWidth="1.2"
            />
            <rect
              x="8" y="1" width="5" height="5" rx="1"
              stroke="currentColor" strokeWidth="1.2"
            />
            <rect
              x="1" y="8" width="5" height="5" rx="1"
              stroke="currentColor" strokeWidth="1.2"
            />
            <rect
              x="8" y="8" width="5" height="5" rx="1"
              stroke="currentColor" strokeWidth="1.2"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
