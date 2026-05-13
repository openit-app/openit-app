import { useEffect, useMemo, useRef, useState } from "react";
import { injectIntoChat } from "../lib/skillState";
import {
  loadWorkstationConfig,
  discoverTiles,
  mergeConfigWithDiscovery,
  type ResolvedTile,
} from "../lib/workstationConfig";

type Action = {
  id: string;
  label: string;
  hint?: string;
  group: "Go to" | "Run" | "New" | "Connect" | "System";
  run: () => void | Promise<void> | Promise<boolean>;
};

function navigate(relPath: string) {
  window.dispatchEvent(
    new CustomEvent("openit:navigate", { detail: { path: relPath } }),
  );
}

export function CommandPalette({
  open,
  onClose,
  repo,
  onConnectSlack,
  onManualPull,
  onOpenWelcome,
  onShowDraft,
}: {
  open: boolean;
  onClose: () => void;
  repo: string | null;
  onConnectSlack: () => void;
  onManualPull: () => void;
  onOpenWelcome: () => void;
  onShowDraft?: (source: {
    kind: "draft-file";
    path: string;
    subdir: string;
    filename: string;
    initialContent: string;
  }) => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [dynamicTiles, setDynamicTiles] = useState<ResolvedTile[]>([]);

  // Load workstation tiles for dynamic "Go to" entries
  useEffect(() => {
    if (!repo || !open) return;
    let cancelled = false;
    (async () => {
      const [cfg, discovered] = await Promise.all([
        loadWorkstationConfig(repo),
        discoverTiles(repo),
      ]);
      if (cancelled) return;
      const { main, more } = mergeConfigWithDiscovery(cfg, discovered);
      setDynamicTiles([...main, ...more]);
    })();
    return () => { cancelled = true; };
  }, [repo, open]);

  const actions: Action[] = useMemo(() => {
    const r = repo ?? "";

    // Generate "Go to" entries from workstation tiles
    const gotoEntries: Action[] = dynamicTiles.length > 0
      ? dynamicTiles.map((t) => ({
          id: `goto-${t.rel}`,
          label: t.label,
          hint: t.rel,
          group: "Go to" as const,
          run: () => navigate(`${r}/${t.openRel ?? t.rel}`),
        }))
      : [
          // Fallback to hardcoded entries if tiles haven't loaded yet
          { id: "goto-inbox", label: "Inbox", hint: "Tickets & escalations", group: "Go to" as const, run: () => navigate(`${r}/databases/tickets`) },
          { id: "goto-knowledge", label: "Knowledge", hint: "KB articles", group: "Go to" as const, run: () => navigate(`${r}/knowledge`) },
          { id: "goto-commands", label: "Commands", hint: "Slash commands", group: "Go to" as const, run: () => navigate(`${r}/filestores/commands`) },
          { id: "goto-people", label: "People", hint: "Contacts directory", group: "Go to" as const, run: () => navigate(`${r}/databases/people`) },
          { id: "goto-access", label: "Access", hint: "Who has access to what", group: "Go to" as const, run: () => navigate(`${r}/databases/access`) },
          { id: "goto-assets", label: "Assets", hint: "Device & equipment inventory", group: "Go to" as const, run: () => navigate(`${r}/databases/assets`) },
          { id: "goto-reports", label: "Reports", hint: "Generated reports", group: "Go to" as const, run: () => navigate(`${r}/reports`) },
          { id: "goto-scripts", label: "Scripts", hint: "Runnable scripts", group: "Go to" as const, run: () => navigate(`${r}/filestores/scripts`) },
          { id: "goto-tools", label: "Tools", hint: "Installed CLI & MCP tools", group: "Go to" as const, run: () => navigate(`${r}/tools`) },
          { id: "goto-traces", label: "Traces", hint: "Agent activity logs", group: "Go to" as const, run: () => navigate(`${r}/traces`) },
        ];
    // Inbox is a primitive (not discovered as a tile) — always present.
    if (dynamicTiles.length > 0) {
      gotoEntries.unshift({
        id: "goto-inbox",
        label: "Inbox",
        hint: "Tickets & escalations",
        group: "Go to",
        run: () => navigate(`${r}/databases/tickets`),
      });
    }

    const items: Action[] = [
      // ── Go to (dynamic) ──
      ...gotoEntries,

      // ── Run (featured commands) ──
      { id: "run-salesforce-gmail", label: "/salesforce-gmail", hint: "Bridge Salesforce and Gmail", group: "Run", run: () => injectIntoChat("/salesforce-gmail") },
      { id: "run-backup", label: "/backup", hint: "Export data to Google Drive", group: "Run", run: () => injectIntoChat("/backup") },
      { id: "run-onboard", label: "/onboard", hint: "Grant access for a new employee", group: "Run", run: () => injectIntoChat("/onboard") },
      { id: "run-offboard", label: "/offboard", hint: "Revoke access for a departing employee", group: "Run", run: () => injectIntoChat("/offboard") },
      { id: "run-salesforce-data-quality", label: "/salesforce-data-quality", hint: "Find and fix dirty data", group: "Run", run: () => injectIntoChat("/salesforce-data-quality") },
      { id: "run-slack-to-kb", label: "/slack-to-kb", hint: "Mine Slack into KB articles", group: "Run", run: () => injectIntoChat("/slack-to-kb") },
      { id: "run-patient-inquiry", label: "/patient-inquiry", hint: "Patient inquiry agent", group: "Run", run: () => injectIntoChat("/patient-inquiry") },
      { id: "run-drive-search", label: "/drive-search", hint: "Search Google Drive", group: "Run", run: () => injectIntoChat("/drive-search") },
      { id: "run-asset-tracking", label: "/asset-tracking", hint: "Query device inventory", group: "Run", run: () => injectIntoChat("/asset-tracking") },
      { id: "run-pipeline-outreach", label: "/pipeline-outreach", hint: "Pipeline reports & emails", group: "Run", run: () => injectIntoChat("/pipeline-outreach") },
      { id: "run-report", label: "/report", hint: "Generate a custom report", group: "Run", run: () => injectIntoChat("/report") },
      { id: "run-answer-ticket", label: "/answer-ticket", hint: "Reply to an escalated ticket", group: "Run", run: () => injectIntoChat("/answer-ticket") },
      { id: "run-cleanup", label: "/cleanup", hint: "Remove sample data", group: "Run", run: () => injectIntoChat("/cleanup") },

      // ── New ──
      {
        id: "new-article",
        label: "New article",
        hint: "Knowledge base article",
        group: "New",
        run: () => {
          if (!onShowDraft || !r) return;
          onShowDraft({
            kind: "draft-file",
            path: `${r}/knowledge/untitled.md`,
            subdir: "knowledge",
            filename: "untitled.md",
            initialContent: "# Untitled article\n\nWrite your article here.\n",
          });
        },
      },
      {
        id: "new-command",
        label: "New command",
        hint: "Slash command",
        group: "New",
        run: () => {
          if (!onShowDraft || !r) return;
          onShowDraft({
            kind: "draft-file",
            path: `${r}/filestores/commands/untitled.md`,
            subdir: "filestores/commands",
            filename: "untitled.md",
            initialContent: `---\ndescription: "Describe what this command does."\n---\n\n# /untitled\n\n## What this command does\n\nDescribe the goal here.\n\n## Steps\n\n1. First, ask the user what they need.\n2. Then, do the work.\n3. Finally, confirm the result.\n`,
          });
        },
      },
      {
        id: "new-person",
        label: "New person",
        hint: "Contacts directory",
        group: "New",
        run: () => {
          if (!onShowDraft || !r) return;
          onShowDraft({
            kind: "draft-file",
            path: `${r}/databases/people/untitled.md`,
            subdir: "databases/people",
            filename: "untitled.md",
            initialContent: `# Contact\n\n- **Name:** \n- **Email:** \n- **Title:** \n- **Department:** \n- **Phone:** \n\n## Notes\n\n`,
          });
        },
      },
      {
        id: "new-script",
        label: "New script",
        hint: "Runnable script",
        group: "New",
        run: () => {
          if (!onShowDraft || !r) return;
          onShowDraft({
            kind: "draft-file",
            path: `${r}/filestores/scripts/untitled.mjs`,
            subdir: "filestores/scripts",
            filename: "untitled.mjs",
            initialContent: `#!/usr/bin/env node\n// Describe what this script does\n\nasync function main() {\n  console.log(JSON.stringify({ ok: true }));\n}\n\nmain().catch((e) => {\n  console.error(JSON.stringify({ ok: false, error: e.message }));\n  process.exit(1);\n});\n`,
          });
        },
      },

      // ── Connect ──
      { id: "connect-slack", label: "Connect Slack", hint: "Set up the OpenIT bot", group: "Connect", run: () => onConnectSlack() },

      // ── System ──
      { id: "sys-welcome", label: "Open Welcome", hint: "Getting-started guide", group: "System", run: () => onOpenWelcome() },
      { id: "sys-refresh", label: "Refresh from disk", hint: "Re-read files from vault", group: "System", run: () => onManualPull() },
      { id: "sys-change-vault", label: "Change vault", hint: "Pick a different vault folder", group: "System", run: () => window.dispatchEvent(new CustomEvent("openit:change-vault")) },
    ];
    return items;
  }, [repo, dynamicTiles, onConnectSlack, onManualPull, onOpenWelcome, onShowDraft]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter(
      (a) =>
        a.label.toLowerCase().includes(q) ||
        (a.hint?.toLowerCase().includes(q) ?? false) ||
        a.group.toLowerCase().includes(q),
    );
  }, [actions, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const item = list.querySelector(".cmdk-item.active") as HTMLElement | null;
    if (item) item.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const runActive = async () => {
    const a = filtered[active];
    if (!a) return;
    onClose();
    try {
      await a.run();
    } catch (e) {
      console.warn("[command-palette] action failed:", e);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      void runActive();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  // Group filtered results — preserve display order
  const groupOrder = ["Go to", "Run", "New", "Connect", "System"];
  const groups: Record<string, { action: Action; index: number }[]> = {};
  filtered.forEach((a, i) => {
    if (!groups[a.group]) groups[a.group] = [];
    groups[a.group].push({ action: a, index: i });
  });

  return (
    <div className="cmdk-overlay" onClick={onClose}>
      <div className="cmdk-panel" onClick={(e) => e.stopPropagation()}>
        <div className="cmdk-search">
          <span className="cmdk-search-icon" aria-hidden>{navigator.userAgent.includes("Mac") ? "⌘" : "⌕"}</span>
          <input
            ref={inputRef}
            className="cmdk-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="What do you want to do?"
          />
          <span className="cmdk-esc" onClick={onClose}>esc</span>
        </div>
        <div className="cmdk-list" ref={listRef}>
          {filtered.length === 0 ? (
            <div className="cmdk-empty">
              No matches.
            </div>
          ) : (
            groupOrder
              .filter((g) => groups[g])
              .map((group) => (
                <div key={group} className="cmdk-group">
                  <div className="cmdk-group-label">{group.toUpperCase()}</div>
                  {groups[group].map(({ action: a, index }) => (
                    <button
                      key={a.id}
                      className={`cmdk-item ${index === active ? "active" : ""}`}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => {
                        setActive(index);
                        void runActive();
                      }}
                    >
                      <span className="cmdk-item-label">{a.label}</span>
                      {a.hint && <span className="cmdk-item-hint">{a.hint}</span>}
                    </button>
                  ))}
                </div>
              ))
          )}
        </div>
        <div className="cmdk-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> select</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
