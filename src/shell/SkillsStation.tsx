import { useEffect, useState } from "react";
import { fsList, fsRead } from "../lib/api";
import { writeToActiveSession } from "./activeSession";
import { Button } from "../ui";
import styles from "./ToolsPanel.module.css";

type CommandEntry = {
  name: string;
  description: string;
  path: string;
  /** System commands (.claude/skills/) are shown by default;
   *  custom commands (filestores/skills/) are hidden behind "Show more". */
  isSystem: boolean;
};

/** How many commands to show before the "Show more" fold. */
const VISIBLE_COUNT = 8;

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
            systemEntries.push({ name: d.name, description, path: skillMdPath, isSystem: true });
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
            customEntries.push({ name, description, path: f.path, isSystem: false });
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
      // Sort within each group alphabetically, system first.
      deduped.sort((a, b) => {
        if (a.isSystem !== b.isSystem) return a.isSystem ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      if (!cancelled) setCommands(deduped);
    })();
    return () => { cancelled = true; };
  }, [repo]);

  const visible = showAll ? commands : commands.slice(0, VISIBLE_COUNT);
  const hiddenCount = commands.length - VISIBLE_COUNT;

  return (
    <div className={styles.panel}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 4 }}>
        <p className={styles.tagline} style={{ margin: 0 }}>
          Run a command or click its name to view the definition.
        </p>
        <span style={{ flex: 1 }} />
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            writeToActiveSession(
              "Help me create a new command for this project. Ask me what I want it to do.\r",
            )
          }
        >
          + New
        </Button>
      </div>

      {commands.length === 0 ? (
        <div className={styles.empty}>No commands found.</div>
      ) : (
        <div className={styles.grid}>
          {visible.map((cmd) => (
            <div key={cmd.name} className={styles.card}>
              <div className={styles.cardHeader}>
                <button
                  type="button"
                  onClick={() => onOpen(cmd.path)}
                  style={{
                    all: "unset",
                    cursor: "pointer",
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
                </button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => writeToActiveSession(`/${cmd.name}\r`)}
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
