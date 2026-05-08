import { useEffect, useState } from "react";
import { fsList, type FileNode } from "../lib/api";
import { scanEscalatedTickets, type TicketSummary } from "../lib/escalatedTickets";
import { listInstalled as listInstalledTools } from "../lib/toolsInstall";
import { ENTITY_META, type EntityKind } from "./entityIcons";

type Station = {
  id: string;
  /** Which entry in ENTITY_META drives the icon, tone, and label. */
  kind: EntityKind;
  /** Path relative to repo root. */
  rel: string;
  /** If set, opens this child path on click instead of `rel`. */
  openRel?: string;
  /** What to count among direct children. */
  countMode: "dirs" | "json-rows" | "files";
};

// Default stations always visible on the workstation.
const DEFAULT_STATIONS: Station[] = [
  { id: "knowledge", kind: "knowledge", rel: "knowledge-bases",   countMode: "files" },
  { id: "commands",  kind: "commands",  rel: "filestores/skills",  countMode: "files" },
];

// Extra stations available via the tile picker.
const EXTRA_STATIONS: Station[] = [
  { id: "reports",    kind: "reports",    rel: "reports",            countMode: "files" },
  { id: "people",     kind: "people",     rel: "databases/people",   countMode: "json-rows" },
  { id: "access",     kind: "access",     rel: "databases/access",   countMode: "json-rows" },
  { id: "assets",     kind: "assets",     rel: "databases/assets",   countMode: "json-rows" },
  { id: "agents",     kind: "agents",     rel: "agents",             countMode: "files" },
  { id: "scripts",    kind: "scripts",    rel: "filestores/scripts", countMode: "files" },
  { id: "tools",      kind: "tools",      rel: "tools",              countMode: "files" },
  { id: "databases",  kind: "databases",  rel: "databases",          countMode: "dirs" },
  { id: "filestores", kind: "filestores", rel: "filestores",         countMode: "dirs" },
];

/** fs_list walks recursively (depth 6), so a naive `.length` over its
 *  result over-counts every station that has nested data — most
 *  egregiously inbox, where it returns Σ(msg-*.json across all
 *  threads) instead of one per thread. Restrict to the direct
 *  children of `rootRel`. */
function directChildren(items: FileNode[], rootAbs: string): FileNode[] {
  const prefix = `${rootAbs}/`;
  return items.filter((n) => {
    if (!n.path.startsWith(prefix)) return false;
    const tail = n.path.slice(prefix.length);
    return tail.length > 0 && !tail.includes("/");
  });
}

function countWithMode(items: FileNode[], mode: Station["countMode"]): number {
  return items.filter((n) => {
    if (n.name.startsWith(".") || n.name === "_schema.json") return false;
    if (n.name.includes(".server.")) return false;
    if (mode === "dirs") return n.is_dir;
    if (mode === "json-rows") return !n.is_dir && n.name.endsWith(".json");
    return !n.is_dir;
  }).length;
}

/**
 * Workbench — the curated front door to the project. Big "Today"
 * inbox card on top, Knowledge + Commands below, tile picker for
 * extras at the bottom.
 */
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
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [escalatedTickets, setEscalatedTickets] = useState<TicketSummary[]>([]);
  const escalatedCount = escalatedTickets.length;
  const [pinnedExtras, setPinnedExtras] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  const allStations = [
    ...DEFAULT_STATIONS,
    ...EXTRA_STATIONS.filter((s) => pinnedExtras.includes(s.id)),
  ];

  useEffect(() => {
    if (!repo) {
      setCounts({});
      setEscalatedTickets([]);
      return;
    }
    let cancelled = false;
    (async () => {
      // Count all stations (default + extras) so counts are ready if
      // the user pins an extra.
      const toCount = [...DEFAULT_STATIONS, ...EXTRA_STATIONS];
      const next: Record<string, number> = {};
      await Promise.all(
        toCount.map(async (s) => {
          if (s.id === "tools") {
            try {
              const cliCount = (await listInstalledTools()).size;
              let mcpCount = 0;
              try {
                const { listInstalledMcps } = await import("../lib/api");
                mcpCount = (await listInstalledMcps(repo ?? undefined)).length;
              } catch { /* MCP scan optional */ }
              next[s.id] = cliCount + mcpCount;
            } catch {
              next[s.id] = 0;
            }
            return;
          }
          if (s.id === "commands") {
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
              customCount = directChildren(customItems, customRoot).filter((n) => !n.is_dir && n.name.endsWith(".md")).length;
            } catch { /* filestores/skills/ may not exist */ }
            next[s.id] = slashCount + customCount;
            return;
          }
          try {
            const rootAbs = `${repo}/${s.rel}`;
            const items = await fsList(rootAbs);
            const direct = directChildren(items, rootAbs);
            next[s.id] = countWithMode(direct, s.countMode);
          } catch {
            next[s.id] = 0;
          }
        }),
      );
      if (!cancelled) setCounts(next);
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

  const openInbox = () => {
    if (repo) onOpen(`${repo}/databases/tickets`);
  };

  const toggleExtra = (id: string) => {
    setPinnedExtras((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const unpinnedExtras = EXTRA_STATIONS.filter(
    (s) => !pinnedExtras.includes(s.id),
  );

  return (
    <div className="workbench">
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
              <span className="workbench-today-clean">Clean inbox. Congrats!</span>
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

      <div className="workbench-stations">
        {allStations.map((s) => {
          const meta = ENTITY_META[s.kind];
          const isPinned = pinnedExtras.includes(s.id);
          return (
            <button
              key={s.id}
              type="button"
              className={`station entity-tone-${meta.tone}`}
              onClick={() => repo && onOpen(`${repo}/${s.openRel ?? s.rel}`)}
              title={meta.label}
            >
              <span className="station-glyph" aria-hidden>
                {meta.icon}
              </span>
              <span className="station-body">
                <span className="station-label">{meta.label}</span>
                <span className="station-count">{counts[s.id] ?? "·"}</span>
              </span>
              {isPinned && (
                <span
                  className="station-unpin"
                  title="Remove from workstation"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleExtra(s.id);
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.stopPropagation();
                      toggleExtra(s.id);
                    }
                  }}
                >
                  ×
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Unified "More" section — tile picker + file explorer */}
      <div className="workbench-more">
        <button
          type="button"
          className="workbench-more-toggle"
          onClick={() => setPickerOpen((v) => !v)}
        >
          <span className="workbench-files-caret">{pickerOpen ? "▾" : "▸"}</span>
          <span>More</span>
        </button>
        {pickerOpen && (
          <div className="workbench-more-body">
            {unpinnedExtras.length > 0 && (
              <>
                <span className="workbench-more-label">Add to workstation</span>
                <div className="workbench-picker-grid">
                  {unpinnedExtras.map((s) => {
                    const meta = ENTITY_META[s.kind];
                    return (
                      <button
                        key={s.id}
                        type="button"
                        className={`station station-picker entity-tone-${meta.tone}`}
                        onClick={() => toggleExtra(s.id)}
                        title={`Add ${meta.label} to workstation`}
                      >
                        <span className="station-glyph" aria-hidden>
                          {meta.icon}
                        </span>
                        <span className="station-body">
                          <span className="station-label">{meta.label}</span>
                        </span>
                        <span className="station-add-hint">+</span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            <button
              type="button"
              className="workbench-files-link"
              onClick={onShowFiles}
            >
              File explorer <span className="arrow" aria-hidden="true">&rarr;</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
