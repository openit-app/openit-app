import { useCallback, useEffect, useState } from "react";
import {
  loadWorkstationConfig,
  discoverTiles,
  mergeConfigWithDiscovery,
  type ResolvedTile,
} from "../lib/workstationConfig";
import { iconForKey } from "./entityIcons";

/// Collapsed left-sidebar rail — an icon-only column rendered when the
/// user clicks the collapse toggle. Mirrors the Workbench's tile set
/// (main tiles only — "more" stays hidden in collapsed mode) so the
/// user can still jump to any pinned station with a single click.
/// Selected tile is highlighted; tooltip on hover shows the full label.
///
/// Persistence of the collapsed/expanded choice itself lives in Shell.tsx
/// (it's a per-user app-state field, not per-vault), so this component
/// is purely presentational — it owns no toggle state.
export function LeftSidebarRail({
  repo,
  fsTick,
  selectedRel,
  onOpen,
  onExpand,
}: {
  repo: string | null;
  fsTick: number;
  /// Repo-relative path of the currently-open station (e.g. "databases/tickets"),
  /// used to highlight the matching icon. `null` when no station is active.
  selectedRel: string | null;
  onOpen: (path: string) => void;
  /// Click handler for the expand-toggle button at the top of the rail.
  onExpand: () => void;
}) {
  const [mainTiles, setMainTiles] = useState<ResolvedTile[]>([]);

  useEffect(() => {
    if (!repo) {
      setMainTiles([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [cfg, discovered] = await Promise.all([
          loadWorkstationConfig(repo),
          discoverTiles(repo),
        ]);
        if (cancelled) return;
        const { main } = mergeConfigWithDiscovery(cfg, discovered);
        setMainTiles(main);
      } catch (err) {
        console.warn("[left-sidebar-rail] tile load failed:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repo, fsTick]);

  const openTile = useCallback(
    (tile: ResolvedTile) => {
      if (!repo) return;
      onOpen(`${repo}/${tile.openRel ?? tile.rel}`);
    },
    [repo, onOpen],
  );

  return (
    <aside
      className="sidebar-rail"
      aria-label="Workstation (collapsed)"
    >
      <div className="sidebar-rail-tiles">
        {(() => {
          // Pre-compute the longest-prefix-match so a more specific
          // tile (`databases/people`) wins over its primitive parent
          // (`databases`) when both are pinned. Without this both rows
          // would highlight when the user opens `databases/people/x.json`.
          const selectedTileRel =
            selectedRel === null
              ? null
              : (mainTiles
                  .map((t) => t.rel)
                  .filter(
                    (rel) =>
                      selectedRel === rel ||
                      selectedRel.startsWith(`${rel}/`),
                  )
                  .sort((a, b) => b.length - a.length)[0] ?? null);
          return mainTiles.map((t) => {
            const tileIcon = iconForKey(t.icon);
            const isSelected = selectedTileRel === t.rel;
            return (
              <button
                key={t.rel}
                type="button"
                className={`sidebar-rail-tile entity-tone-${t.tone}${
                  isSelected ? " sidebar-rail-tile-selected" : ""
                }`}
                onClick={() => openTile(t)}
                title={t.label}
                aria-label={t.label}
                aria-current={isSelected ? "page" : undefined}
              >
                <span className="sidebar-rail-glyph" aria-hidden>
                  {tileIcon}
                </span>
              </button>
            );
          });
        })()}
      </div>
      <button
        type="button"
        className="sidebar-rail-toggle"
        onClick={onExpand}
        title="Expand sidebar"
        aria-label="Expand sidebar"
        aria-expanded={false}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path
            d="M5 3l4 4-4 4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </aside>
  );
}
