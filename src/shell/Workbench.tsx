import { useCallback, useEffect, useRef, useState } from "react";
import { fsList, entityRemoveDir, type FileNode } from "../lib/api";
import { scanEscalatedTickets, type TicketSummary } from "../lib/escalatedTickets";
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

// ── Helpers ──────────────────────────────────────────────────────────

function directChildren(items: FileNode[], rootAbs: string): FileNode[] {
  const prefix = `${rootAbs}/`;
  return items.filter((n) => {
    if (!n.path.startsWith(prefix)) return false;
    const tail = n.path.slice(prefix.length);
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
}: {
  repo: string | null;
  fsTick: number;
  onOpen: (path: string) => void;
  onShowFiles: () => void;
}) {
  const [config, setConfig] = useState<WorkstationConfig | null>(null);
  const [mainTiles, setMainTiles] = useState<ResolvedTile[]>([]);
  const [moreTiles, setMoreTiles] = useState<ResolvedTile[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const prevCountsRef = useRef<Record<string, number> | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [highlightedStations, setHighlightedStations] = useState<Set<string>>(new Set());
  const [escalatedTickets, setEscalatedTickets] = useState<TicketSummary[]>([]);
  const escalatedCount = escalatedTickets.length;
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
      setEscalatedTickets([]);
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
          // Commands (filestores/skills) — count both .claude/skills dirs + custom skills
          if (t.rel === "filestores/skills") {
            let slashCount = 0;
            let customCount = 0;
            try {
              const slashRoot = `${repo}/.claude/skills`;
              const slashItems = await fsList(slashRoot);
              slashCount = directChildren(slashItems, slashRoot).filter((n) => n.is_dir).length;
            } catch { /* .claude/skills/ may not exist */ }
            try {
              const customRoot = `${repo}/filestores/skills`;
              const customItems = await fsList(customRoot);
              customCount = directChildren(customItems, customRoot).filter(
                (n) => !n.is_dir && n.name.endsWith(".md"),
              ).length;
            } catch { /* filestores/skills/ may not exist */ }
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

      // Highlight stations that gained items
      if (prevCountsRef.current !== null) {
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

      // Escalated tickets
      try {
        const esc = await scanEscalatedTickets(repo);
        if (!cancelled) setEscalatedTickets(esc);
      } catch {
        if (!cancelled) setEscalatedTickets([]);
      }
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
      const ok = window.confirm(
        `Delete "${tile.label}" and all its contents?\n\nThis cannot be undone.`,
      );
      if (!ok) return;
      try {
        await entityRemoveDir(repo, tile.rel);
        await removeTile(tile.rel);
      } catch (err) {
        console.error("[workbench-delete] failed:", err);
      }
    },
    [repo, removeTile],
  );

  const customizeTile = useCallback(
    async (rel: string, icon: string, tone: ToneKey, label: string) => {
      const cfg = configRef.current;
      if (!cfg || !repo) return;
      const update = (tiles: TileConfig[]) =>
        tiles.map((t) =>
          t.rel === rel ? { ...t, icon, tone, label } : t,
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
          more: [...cfg.more, { rel, icon, tone, label }],
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

  const openInbox = () => {
    if (repo) onOpen(`${repo}/databases/tickets`);
  };

  // Tiles that can be deleted (have a folder on disk — not system
  // synthetics like "tools" or parent views like "databases").
  const isDeletable = (rel: string) => {
    return (
      rel.startsWith("databases/") &&
      rel !== "databases" &&
      rel !== "databases/conversations"
    ) ||
    (rel.startsWith("filestores/") && rel !== "filestores") ||
    rel === "knowledge-bases" ||
    rel === "reports";
  };

  return (
    <div className="workbench">
      {/* ── TODAY hero card ───────────────────────────────── */}
      <div
        className={`workbench-today${escalatedCount > 0 ? " has-escalated" : ""}`}
      >
        <button
          type="button"
          className="workbench-today-main"
          onClick={openInbox}
          disabled={!repo}
          title={
            escalatedCount > 0
              ? "Open the Tickets Inbox"
              : "Open the Tickets Inbox (nothing waiting)"
          }
        >
          <span className="workbench-today-topline">
            <span className="workbench-today-eyebrow">TODAY</span>
            <span className="workbench-today-brand" aria-hidden>
              Open<em>IT</em>
            </span>
          </span>
          {escalatedCount === 0 ? (
            <span className="workbench-today-hero workbench-today-hero-clean">
              <span className="workbench-today-clean">Clean inbox</span>
            </span>
          ) : (
            <span className="workbench-today-hero">
              <span className="workbench-today-number">{escalatedCount}</span>
              <span className="workbench-today-label">
                escalated ticket{escalatedCount === 1 ? "" : "s"}
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
              <span
                className="station-unpin"
                title="Remove from main"
                onClick={(e) => {
                  e.stopPropagation();
                  void demote(t.rel);
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.stopPropagation();
                    void demote(t.rel);
                  }
                }}
              >
                ×
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
          onSave={(icon, tone, label) => {
            void customizeTile(customizing.rel, icon, tone, label);
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
