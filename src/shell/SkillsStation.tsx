import { useEffect, useState } from "react";
import { fsList, fsRead, entityWriteFile } from "../lib/api";
import { isDirectChild } from "../lib/paths";
import { writeToActiveSession } from "./activeSession";
import { Button } from "../ui";
import styles from "./ToolsPanel.module.css";

type CommandEntry = {
  name: string;
  description: string;
  path: string;
  /** Whether this is a featured command that Lisa cares about. */
  featured: boolean;
};

// Commands that map directly to Lisa's pain points, in priority order.
// Everything not in this list goes behind "Show more".
const FEATURED_COMMANDS: string[] = [
  "load-sample-data",        // Populate workspace with sample data
  "cleanup",                 // Remove sample data
  "salesforce-gmail",        // Salesforce + email disconnect
  "backup",                  // Manual backups
  "onboard",                 // Onboarding new employees
  "offboard",                // Offboarding departing employees
  "salesforce-data-quality",  // Data quality / cleanup in Salesforce
  "slack-to-knowledge",             // Knowledge trapped in Slack
  "patient-inquiry",          // Patient inquiry handling (Salesforce Cases)
  "drive-search",             // Information scattered across Drive
  "asset-tracking",           // Asset tracking
  "pipeline-outreach",        // Recurring reporting / outreach
  "report",                   // Custom reports
];

/**
 * CommandsStation — flat list of slash commands with a visible Run
 * button on each row. Merges system (.claude/skills/) and custom
 * (filestores/commands/) into one deduplicated list. System commands
 * appear first; extras are behind "Show more".
 */
export function CommandsStation({
  repo,
  fsTick,
  onOpen,
}: {
  repo: string;
  fsTick?: number;
  onOpen: (path: string) => void;
}) {
  const [commands, setCommands] = useState<CommandEntry[]>([]);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const systemEntries: CommandEntry[] = [];
      const customEntries: CommandEntry[] = [];

      // System commands from .claude/skills/
      try {
        const root = `${repo}/.claude/skills`;
        const nodes = await fsList(root);
        const dirs = nodes.filter((n) => n.is_dir && isDirectChild(root, n.path));
        await Promise.all(
          dirs.map(async (d) => {
            const skillMdPath = `${d.path}/SKILL.md`;
            let description = "";
            try {
              const raw = await fsRead(skillMdPath);
              description = extractDescription(raw);
            } catch { /* SKILL.md missing */ }
            systemEntries.push({ name: d.name, description, path: skillMdPath, featured: FEATURED_COMMANDS.includes(d.name) });
          }),
        );
      } catch { /* .claude/skills/ doesn't exist */ }

      // Custom commands from filestores/commands/
      try {
        const root = `${repo}/filestores/commands`;
        const nodes = await fsList(root);
        const prefix = `${root.replace(/\\/g, "/")}/`;
        const files = nodes.filter((n) => {
          if (n.is_dir) return false;
          const p = n.path.replace(/\\/g, "/");
          const tail = p.startsWith(prefix) ? p.slice(prefix.length) : "";
          if (!tail || tail.includes("/")) return false;
          if (n.name.includes(".server.")) return false;
          return n.name.endsWith(".md");
        });
        await Promise.all(
          files.map(async (f) => {
            const name = f.name.replace(/\.md$/, "");
            let description = "";
            try {
              const raw = await fsRead(f.path);
              description = extractDescription(raw);
            } catch { /* unreadable */ }
            customEntries.push({ name, description, path: f.path, featured: FEATURED_COMMANDS.includes(name) });
          }),
        );
      } catch { /* filestores/commands/ doesn't exist */ }

      // Deduplicate: if a name exists in both system and custom, keep
      // the system version (it's the curated one).
      const seen = new Set<string>();
      const deduped: CommandEntry[] = [];
      // System first so they win on collisions and sort to the top.
      for (const e of systemEntries) {
        if (!seen.has(e.name)) {
          seen.add(e.name);
          deduped.push(e);
        }
      }
      for (const e of customEntries) {
        if (!seen.has(e.name)) {
          seen.add(e.name);
          deduped.push(e);
        }
      }
      // Featured commands first (in Lisa's priority order), then the
      // rest alphabetically behind "Show more".
      deduped.sort((a, b) => {
        const aIdx = FEATURED_COMMANDS.indexOf(a.name);
        const bIdx = FEATURED_COMMANDS.indexOf(b.name);
        const aFeat = aIdx !== -1;
        const bFeat = bIdx !== -1;
        if (aFeat && bFeat) return aIdx - bIdx;
        if (aFeat) return -1;
        if (bFeat) return 1;
        return a.name.localeCompare(b.name);
      });

      if (!cancelled) setCommands(deduped);
    })();
    return () => { cancelled = true; };
  }, [repo, fsTick]);

  const [search, setSearch] = useState("");
  const [newName, setNewName] = useState("");
  const [newIntent, setNewIntent] = useState("");

  // When searching, show all matches (ignore fold). Otherwise fold at featured.
  const q = search.toLowerCase();
  const filtered = q
    ? commands.filter((c) => c.name.includes(q) || c.description.toLowerCase().includes(q))
    : commands;
  const featuredCount = filtered.filter((c) => c.featured).length;
  const foldAt = Math.max(featuredCount, 1);
  const visible = q || showAll ? filtered : filtered.slice(0, foldAt);
  const hiddenCount = filtered.length - foldAt;
  const [showNewInput, setShowNewInput] = useState(false);

  const createNewCommand = async () => {
    const slug = newName.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    if (!slug) return;
    // Intent is required — captured before any file is written or any
    // Claude call is made. The single text field carries the user's
    // ask through to Claude's initial turn so it stops guessing from
    // the filename alone. (PIN-6607.)
    const intent = newIntent.trim();
    if (!intent) return;
    // One-line description for the YAML frontmatter — keep the user's
    // exact phrasing so it round-trips through the commands list and
    // Claude has it in its working set.
    const safeIntentForFrontmatter = intent
      .replace(/\r?\n/g, " ")
      .replace(/"/g, '\\"');
    const boilerplate = `---
description: "${safeIntentForFrontmatter}"
---

# /${slug}

<!-- This is a slash command. When you type /${slug} in the chat,
     Claude will follow these instructions step by step. -->

## What this command does

${intent}

## Steps

1. First, ask the user what they need.
2. Then, do the work.
3. Finally, confirm the result.

## Notes

- Add any tips, edge cases, or context here.

## After this run

Before signing off, re-read this command body. If the admin's choices narrowed any defaults this run, rewrite the relevant sections to match — and snapshot the prior body to \`filestores/commands/${slug}/_history/<ms>.md\` first. Tell the admin in one line what changed.
`;
    const relPath = `filestores/commands/${slug}.md`;
    const absPath = `${repo}/${relPath}`;
    await entityWriteFile(repo, "filestores/commands", `${slug}.md`, boilerplate);
    setShowNewInput(false);
    setNewName("");
    setNewIntent("");
    onOpen(absPath);
    // Hand the intent off to Claude alongside the file path. Building
    // this prompt server-side (here) instead of relying on the
    // template means Claude gets the user's ask verbatim in its first
    // turn, even if it never reads the file. The file watcher in the
    // viewer then re-renders as Claude writes.
    const ccPrompt = `I just created a new slash command at \`${relPath}\`. Please build it out so it does the following:\n\n${intent}\n\nRead the file first to see the scaffold I dropped (YAML frontmatter, Steps, Notes), then rewrite the body so /${slug} actually does the above. Keep the frontmatter \`description\` matching the goal. When you're done, tell me in one line what /${slug} now does.\r`;
    await writeToActiveSession(ccPrompt);
  };

  const cancelNewCommand = () => {
    setShowNewInput(false);
    setNewName("");
    setNewIntent("");
  };

  return (
    <div className={styles.panel}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <p className={styles.tagline} style={{ margin: 0 }}>
          Click a command to view or edit. Hit Run to execute.
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowNewInput((v) => !v)}
        >
          + New
        </Button>
      </div>

      <input
        className={styles.search}
        type="text"
        placeholder="Search commands…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {showNewInput && (
        <div
          style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}
          role="dialog"
          aria-label="Create new command"
        >
          <input
            className={styles.search}
            type="text"
            placeholder="command-name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") cancelNewCommand();
            }}
            autoFocus
          />
          <textarea
            className={styles.search}
            placeholder="What should this command do? Describe the goal."
            value={newIntent}
            onChange={(e) => setNewIntent(e.target.value)}
            onKeyDown={(e) => {
              // Submit on Cmd/Ctrl+Enter so plain Enter still inserts
              // a newline inside the textarea — matches the modern
              // chat-input convention.
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                void createNewCommand();
              }
              if (e.key === "Escape") cancelNewCommand();
            }}
            rows={3}
            style={{ resize: "vertical", minHeight: 64, fontFamily: "inherit" }}
            aria-label="What should this command do? Describe the goal."
          />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
            <span style={{ fontSize: 11, color: "var(--text-muted)", marginRight: "auto" }}>
              Cmd/Ctrl+Enter to create
            </span>
            <Button variant="ghost" size="sm" onClick={cancelNewCommand}>
              Cancel
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void createNewCommand()}
              disabled={!newName.trim() || !newIntent.trim()}
            >
              Create
            </Button>
          </div>
        </div>
      )}

      {visible.length === 0 ? (
        <div className={styles.empty}>{q ? "No matching commands." : "No commands found."}</div>
      ) : (
        <div className={styles.grid}>
          {visible.map((cmd) => (
            <div
              key={cmd.name}
              className={styles.card}
              style={{ cursor: "pointer" }}
              onClick={() => onOpen(cmd.path)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") onOpen(cmd.path);
              }}
            >
              <div className={styles.cardHeader}>
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: "var(--text)",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>/</span>
                  {cmd.name}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    writeToActiveSession(`/${cmd.name}\r`);
                  }}
                >
                  Run
                </Button>
              </div>
              {cmd.description && (
                <p className={styles.cardDesc}>{cmd.description}</p>
              )}
            </div>
          ))}

          {hiddenCount > 0 && !q && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              style={{
                all: "unset",
                cursor: "pointer",
                textAlign: "center",
                padding: "10px 0",
                fontSize: 13,
                color: "var(--text-muted)",
                fontWeight: 500,
              }}
            >
              {showAll
                ? "Show less"
                : `Show ${hiddenCount} more command${hiddenCount === 1 ? "" : "s"}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Extract a one-line description from markdown with optional YAML frontmatter. */
function extractDescription(raw: string): string {
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fmMatch) {
    const descLine = fmMatch[1]
      .split("\n")
      .find((l) => l.trim().startsWith("description:"));
    if (descLine) {
      return descLine
        .replace(/^description:\s*/, "")
        .replace(/^["']|["']$/g, "")
        .trim();
    }
  }
  const body = fmMatch ? raw.slice(fmMatch[0].length) : raw;
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    return trimmed.slice(0, 140);
  }
  return "";
}

// Keep backward-compatible export name for existing import sites.
export { CommandsStation as SkillsStation };
