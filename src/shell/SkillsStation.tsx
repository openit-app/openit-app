import { useEffect, useState } from "react";
import { fsList, fsRead, entityWriteFile } from "../lib/api";
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
  "salesforce-gmail",        // Salesforce + email disconnect
  "backup",                  // Manual backups
  "onboard-offboard",        // Onboarding/offboarding access management
  "salesforce-data-quality",  // Data quality / cleanup in Salesforce
  "slack-to-kb",             // Knowledge trapped in Slack
  "patient-inquiry",          // Patient inquiry handling (Salesforce Cases)
  "drive-search",             // Information scattered across Drive
  "asset-tracking",           // Asset tracking
  "pipeline-outreach",        // Recurring reporting / outreach
  "report",                   // Custom reports
];

/**
 * CommandsStation — flat list of slash commands with a visible Run
 * button on each row. Merges system (.claude/skills/) and custom
 * (filestores/skills/) into one deduplicated list. System commands
 * appear first; extras are behind "Show more".
 */
export function CommandsStation({
  repo,
  onOpen,
}: {
  repo: string;
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
        const prefix = `${root}/`;
        const dirs = nodes.filter((n) => {
          if (!n.is_dir) return false;
          const tail = n.path.startsWith(prefix) ? n.path.slice(prefix.length) : "";
          return tail.length > 0 && !tail.includes("/");
        });
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

      // Custom commands from filestores/skills/
      try {
        const root = `${repo}/filestores/skills`;
        const nodes = await fsList(root);
        const prefix = `${root}/`;
        const files = nodes.filter((n) => {
          if (n.is_dir) return false;
          const tail = n.path.startsWith(prefix) ? n.path.slice(prefix.length) : "";
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
      } catch { /* filestores/skills/ doesn't exist */ }

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
  }, [repo]);

  // Show featured commands by default; hide the rest behind "Show more".
  const featuredCount = commands.filter((c) => c.featured).length;
  const foldAt = Math.max(featuredCount, 1); // always show at least 1
  const visible = showAll ? commands : commands.slice(0, foldAt);
  const hiddenCount = commands.length - foldAt;

  const [newName, setNewName] = useState("");
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
`;
    await entityWriteFile(repo, "filestores/skills", `${slug}.md`, boilerplate);
    setShowNewInput(false);
    setNewName("");
    onOpen(`${repo}/filestores/skills/${slug}.md`);
  };

  return (
    <div className={styles.panel}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 4 }}>
        <p className={styles.tagline} style={{ margin: 0 }}>
          Click a command to view or edit. Hit Run to execute.
        </p>
        <span style={{ flex: 1 }} />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowNewInput((v) => !v)}
        >
          + New
        </Button>
      </div>

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

      {commands.length === 0 ? (
        <div className={styles.empty}>No commands found.</div>
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

          {hiddenCount > 0 && (
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
