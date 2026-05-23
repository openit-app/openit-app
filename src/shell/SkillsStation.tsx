import { useEffect, useState } from "react";
import { fsRead, entityWriteFile } from "../lib/api";
import { listCommands } from "../lib/commandsCatalog";
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
      // Discovery + dedup lives in commandsCatalog so the tile counter
      // and this viewer always agree on what counts as a command.
      const refs = await listCommands(repo);
      const entries: CommandEntry[] = await Promise.all(
        refs.map(async (r) => {
          let description = "";
          try {
            const raw = await fsRead(r.path);
            description = extractDescription(raw);
          } catch { /* unreadable / SKILL.md missing */ }
          return {
            name: r.name,
            description,
            path: r.path,
            featured: FEATURED_COMMANDS.includes(r.name),
          };
        }),
      );

      // Featured commands first (in Lisa's priority order), then the
      // rest alphabetically behind "Show more".
      entries.sort((a, b) => {
        const aIdx = FEATURED_COMMANDS.indexOf(a.name);
        const bIdx = FEATURED_COMMANDS.indexOf(b.name);
        const aFeat = aIdx !== -1;
        const bFeat = bIdx !== -1;
        if (aFeat && bFeat) return aIdx - bIdx;
        if (aFeat) return -1;
        if (bFeat) return 1;
        return a.name.localeCompare(b.name);
      });

      if (!cancelled) setCommands(entries);
    })();
    return () => { cancelled = true; };
  }, [repo, fsTick]);

  const [search, setSearch] = useState("");
  const [newName, setNewName] = useState("");

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
    const boilerplate = `---
description: "Describe what this command does in one sentence."
---

# /${slug}

<!-- This is a slash command. When you type /${slug} in the chat,
     Claude will follow these instructions step by step. -->

## What this command does

Describe the goal here.

## Steps

1. First, ask the user what they need.
2. Then, do the work.
3. Finally, confirm the result.

## Notes

- Add any tips, edge cases, or context here.

## After this run

Before signing off, re-read this command body. If the admin's choices narrowed any defaults this run, rewrite the relevant sections to match — and snapshot the prior body to \`filestores/commands/${slug}/_history/<ms>.md\` first. Tell the admin in one line what changed.
`;
    await entityWriteFile(repo, "filestores/commands", `${slug}.md`, boilerplate);
    setShowNewInput(false);
    setNewName("");
    onOpen(`${repo}/filestores/commands/${slug}.md`);
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
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
          <input
            className={styles.search}
            type="text"
            placeholder="command-name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void createNewCommand();
              if (e.key === "Escape") { setShowNewInput(false); setNewName(""); }
            }}
            autoFocus
          />
          <Button variant="secondary" size="sm" onClick={() => void createNewCommand()}>
            Create
          </Button>
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
