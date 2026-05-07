import { useCallback, useEffect, useState } from "react";
import { fsList, fsRead, fsDelete } from "../lib/api";
import { writeToActiveSession } from "./activeSession";
import { EntityCardGrid, type EntityCard } from "./EntityCardGrid";
import { Button } from "../ui";
import styles from "./ToolsPanel.module.css";

type SkillEntry = {
  name: string;
  description: string;
  /** Absolute path to the file the card opens / deletes. */
  path: string;
};

/**
 * Skills station — tabbed view of slash commands (.claude/skills/)
 * and custom skills (filestores/skills/). Rendered when the admin
 * clicks the Skills station tile on the Workbench.
 */
export function SkillsStation({
  repo,
  onOpen,
}: {
  repo: string;
  onOpen: (path: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<"slash" | "custom">("slash");
  const [slashCommands, setSlashCommands] = useState<SkillEntry[]>([]);
  const [customSkills, setCustomSkills] = useState<SkillEntry[]>([]);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  // ── Load slash commands from .claude/skills/ ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries: SkillEntry[] = [];
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
              const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
              if (fmMatch) {
                const descLine = fmMatch[1]
                  .split("\n")
                  .find((l) => l.trim().startsWith("description:"));
                if (descLine) {
                  description = descLine
                    .replace(/^description:\s*/, "")
                    .replace(/^["']|["']$/g, "")
                    .trim();
                }
              }
              if (!description) {
                const body = fmMatch ? raw.slice(fmMatch[0].length) : raw;
                for (const line of body.split("\n")) {
                  const trimmed = line.trim();
                  if (!trimmed || trimmed.startsWith("#")) continue;
                  description = trimmed.slice(0, 140);
                  break;
                }
              }
            } catch { /* SKILL.md missing */ }
            entries.push({ name: d.name, description, path: skillMdPath });
          }),
        );
      } catch { /* .claude/skills/ doesn't exist */ }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      if (!cancelled) setSlashCommands(entries);
    })();
    return () => { cancelled = true; };
  }, [repo, tick]);

  // ── Load custom skills from filestores/skills/ ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries: SkillEntry[] = [];
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
              // Try frontmatter description first
              const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
              if (fmMatch) {
                const descLine = fmMatch[1]
                  .split("\n")
                  .find((l) => l.trim().startsWith("description:"));
                if (descLine) {
                  description = descLine
                    .replace(/^description:\s*/, "")
                    .replace(/^["']|["']$/g, "")
                    .trim();
                }
              }
              if (!description) {
                const body = fmMatch ? raw.slice(fmMatch[0].length) : raw;
                for (const line of body.split("\n")) {
                  const trimmed = line.trim();
                  if (!trimmed || trimmed.startsWith("#")) continue;
                  description = trimmed.slice(0, 140);
                  break;
                }
              }
            } catch { /* unreadable */ }
            entries.push({ name, description, path: f.path });
          }),
        );
      } catch { /* filestores/skills/ doesn't exist */ }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      if (!cancelled) setCustomSkills(entries);
    })();
    return () => { cancelled = true; };
  }, [repo, tick]);

  // ── Card builders ──

  const slashCards: EntityCard[] = slashCommands.map((s) => ({
    key: `slash-${s.name}`,
    title: s.name,
    description: s.description || undefined,
    onClick: () => onOpen(s.path),
    onAddToClaude: async () => { await writeToActiveSession(`/${s.name}\r`); },
    onDelete: async () => {
      if (!window.confirm(`Delete slash command "${s.name}"?`)) return;
      await fsDelete(s.path);
      refresh();
    },
  }));

  const customCards: EntityCard[] = customSkills.map((s) => ({
    key: `custom-${s.name}`,
    title: s.name,
    description: s.description || undefined,
    onClick: () => onOpen(s.path),
    onAddToClaude: async () => {
      await writeToActiveSession(
        `Read and follow the custom skill at filestores/skills/${s.name}.md\r`,
      );
    },
    onDelete: async () => {
      if (!window.confirm(`Delete custom skill "${s.name}"?`)) return;
      await fsDelete(s.path);
      refresh();
    },
  }));

  return (
    <div className={styles.panel}>
      <div className={styles.tabStrip} style={{ display: "flex", alignItems: "center" }}>
        <button
          type="button"
          className={`${styles.tab} ${activeTab === "slash" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("slash")}
        >
          Slash Commands
        </button>
        <button
          type="button"
          className={`${styles.tab} ${activeTab === "custom" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("custom")}
        >
          Custom Skills
        </button>
        <span style={{ flex: 1 }} />
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            writeToActiveSession(
              activeTab === "slash"
                ? "Help me create a new slash command for this project. Ask me what I want it to do.\r"
                : "Help me create a custom skill for this project and save it to filestores/skills/. Ask me what I want it to do.\r",
            )
          }
        >
          + New
        </Button>
      </div>

      {activeTab === "slash" && (
        <>
          <p className={styles.tagline}>
            Pre-installed commands you can run with <code>/</code> in Claude.
          </p>
          <EntityCardGrid
            kind="skills"
            cards={slashCards}
            empty="No slash commands yet. Click + New to create one."
          />
        </>
      )}

      {activeTab === "custom" && (
        <>
          <p className={styles.tagline}>
            Workflow prompts you or Claude have captured. Reusable across sessions.
          </p>
          <EntityCardGrid
            kind="skills"
            cards={customCards}
            empty="No custom skills yet. Click + New to create one."
          />
        </>
      )}
    </div>
  );
}
