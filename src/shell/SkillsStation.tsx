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
 * Skills station — unified list of all skills from .claude/skills/.
 * Every skill is a slash command in Claude (type `/name` to invoke).
 * Custom skills authored under filestores/skills/ are mirrored here
 * by skillMirror, so one list covers everything.
 */
export function SkillsStation({
  repo,
  onOpen,
}: {
  repo: string;
  onOpen: (path: string) => void;
}) {
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

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
      if (!cancelled) setSkills(entries);
    })();
    return () => { cancelled = true; };
  }, [repo, tick]);

  const cards: EntityCard[] = skills.map((s) => ({
    key: s.name,
    title: s.name,
    description: s.description || undefined,
    onClick: () => onOpen(s.path),
    onAddToClaude: async () => { await writeToActiveSession(`/${s.name}\r`); },
    onDelete: async () => {
      if (!window.confirm(`Delete skill "${s.name}"?`)) return;
      await fsDelete(s.path);
      refresh();
    },
  }));

  return (
    <div className={styles.panel}>
      <div className={styles.tabStrip} style={{ display: "flex", alignItems: "center" }}>
        <span className={styles.tagline} style={{ flex: 1 }}>
          Type <code>/name</code> in Claude to run a skill.
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            writeToActiveSession(
              "Help me create a new skill for this project. Ask me what I want it to do.\r",
            )
          }
        >
          + New
        </Button>
      </div>

      <EntityCardGrid
        kind="skills"
        cards={cards}
        empty="No skills yet. Click + New to create one."
      />
    </div>
  );
}
