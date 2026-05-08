import { useEffect, useMemo, useRef, useState } from "react";
import { injectIntoChat } from "../lib/skillState";

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

  const actions: Action[] = useMemo(() => {
    const r = repo ?? "";
    const items: Action[] = [
      // ── Go to ──
      { id: "goto-inbox", label: "Inbox", hint: "Tickets & escalations", group: "Go to", run: () => navigate(`${r}/databases/tickets`) },
      { id: "goto-knowledge", label: "Knowledge", hint: "KB articles", group: "Go to", run: () => navigate(`${r}/knowledge-bases`) },
      { id: "goto-commands", label: "Commands", hint: "Slash commands", group: "Go to", run: () => navigate(`${r}/filestores/skills`) },
      { id: "goto-people", label: "People", hint: "Contacts directory", group: "Go to", run: () => navigate(`${r}/databases/people`) },
      { id: "goto-access", label: "Access", hint: "Who has access to what", group: "Go to", run: () => navigate(`${r}/databases/access`) },
      { id: "goto-assets", label: "Assets", hint: "Device & equipment inventory", group: "Go to", run: () => navigate(`${r}/databases/assets`) },
      { id: "goto-reports", label: "Reports", hint: "Generated reports", group: "Go to", run: () => navigate(`${r}/reports`) },
      { id: "goto-scripts", label: "Scripts", hint: "Runnable scripts", group: "Go to", run: () => navigate(`${r}/filestores/scripts`) },
      { id: "goto-tools", label: "Tools", hint: "Installed CLI & MCP tools", group: "Go to", run: () => navigate(`${r}/tools`) },

      // ── Run (featured commands) ──
      { id: "run-salesforce-gmail", label: "/salesforce-gmail", hint: "Bridge Salesforce and Gmail", group: "Run", run: () => injectIntoChat("/salesforce-gmail") },
      { id: "run-backup", label: "/backup", hint: "Export data to Google Drive", group: "Run", run: () => injectIntoChat("/backup") },
      { id: "run-onboard-offboard", label: "/onboard-offboard", hint: "Grant or revoke access", group: "Run", run: () => injectIntoChat("/onboard-offboard") },
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
            path: `${r}/knowledge-bases/untitled.md`,
            subdir: "knowledge-bases",
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
            path: `${r}/filestores/skills/untitled.md`,
            subdir: "filestores/skills",
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
    ];
    return items;
  }, [repo, onConnectSlack, onManualPull, onOpenWelcome, onShowDraft]);

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
          <span className="cmdk-search-icon" aria-hidden>⌘</span>
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
