import { useCallback, useEffect, useState } from "react";
import { fsList, fsRead, fsDelete, scriptRun } from "../lib/api";
import { writeToActiveSession } from "./activeSession";
import { EntityCardGrid, type EntityCard } from "./EntityCardGrid";
import { Button } from "../ui";
import styles from "./ToolsPanel.module.css";

type ScriptEntry = {
  name: string;
  description: string;
  path: string;
};

// Persist active tab across remounts.
let lastScriptsTab: "system" | "custom" = "system";

export function ScriptsStation({
  repo,
  onOpen,
  onShowSource,
}: {
  repo: string;
  onOpen: (path: string) => void;
  onShowSource?: (source: { kind: "script-output"; script: string; stdout: string; stderr: string; exitCode: number; durationMs: number }) => void;
}) {
  const [activeTab, setActiveTabRaw] = useState<"system" | "custom">(lastScriptsTab);
  const setActiveTab = (tab: "system" | "custom") => {
    lastScriptsTab = tab;
    setActiveTabRaw(tab);
  };
  const [systemScripts, setSystemScripts] = useState<ScriptEntry[]>([]);
  const [customScripts, setCustomScripts] = useState<ScriptEntry[]>([]);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  // Load system scripts from .claude/scripts/
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries: ScriptEntry[] = [];
      try {
        const root = `${repo}/.claude/scripts`;
        const nodes = await fsList(root);
        const prefix = `${root}/`;
        const files = nodes.filter((n) => {
          if (n.is_dir) return false;
          const tail = n.path.startsWith(prefix) ? n.path.slice(prefix.length) : "";
          if (!tail || tail.includes("/")) return false;
          return n.name.endsWith(".mjs") || n.name.endsWith(".js") || n.name.endsWith(".cjs");
        });
        for (const f of files) {
          let description = "";
          try {
            const raw = await fsRead(f.path);
            // Extract description from first comment line
            for (const line of raw.split("\n")) {
              const trimmed = line.trim();
              if (trimmed.startsWith("#!/")) continue;
              if (trimmed.startsWith("//")) {
                description = trimmed.replace(/^\/\/\s*/, "").slice(0, 120);
                break;
              }
              if (trimmed.startsWith("/*")) {
                description = trimmed.replace(/^\/\*\s*/, "").replace(/\*\/\s*$/, "").slice(0, 120);
                break;
              }
              if (trimmed && !trimmed.startsWith("import") && !trimmed.startsWith("const") && !trimmed.startsWith("let")) {
                break; // Non-comment, non-import line — stop looking
              }
            }
          } catch { /* unreadable */ }
          entries.push({ name: f.name, description, path: f.path });
        }
      } catch { /* .claude/scripts/ doesn't exist */ }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      if (!cancelled) setSystemScripts(entries);
    })();
    return () => { cancelled = true; };
  }, [repo, tick]);

  // Load custom scripts from filestores/scripts/
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries: ScriptEntry[] = [];
      try {
        const root = `${repo}/filestores/scripts`;
        const nodes = await fsList(root);
        const prefix = `${root}/`;
        const files = nodes.filter((n) => {
          if (n.is_dir) return false;
          const tail = n.path.startsWith(prefix) ? n.path.slice(prefix.length) : "";
          if (!tail || tail.includes("/")) return false;
          return n.name.endsWith(".mjs") || n.name.endsWith(".js") || n.name.endsWith(".cjs") || n.name.endsWith(".py");
        });
        for (const f of files) {
          let description = "";
          try {
            const raw = await fsRead(f.path);
            for (const line of raw.split("\n")) {
              const trimmed = line.trim();
              if (trimmed.startsWith("#!/")) continue;
              if (trimmed.startsWith("//") || trimmed.startsWith("#")) {
                description = trimmed.replace(/^(\/\/|#)\s*/, "").slice(0, 120);
                break;
              }
              if (trimmed && !trimmed.startsWith("import")) break;
            }
          } catch { /* unreadable */ }
          entries.push({ name: f.name, description, path: f.path });
        }
      } catch { /* filestores/scripts/ doesn't exist */ }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      if (!cancelled) setCustomScripts(entries);
    })();
    return () => { cancelled = true; };
  }, [repo, tick]);

  const onRunScript = async (script: ScriptEntry) => {
    try {
      const result = await scriptRun(repo, script.path);
      if (onShowSource) {
        onShowSource({
          kind: "script-output",
          script: script.path,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
        });
      }
    } catch (e) {
      console.error("[scripts] run failed:", e);
    }
  };

  const buildCards = (scripts: ScriptEntry[], isSystem: boolean): EntityCard[] =>
    scripts.map((s) => ({
      key: `${isSystem ? "sys" : "custom"}-${s.name}`,
      title: s.name,
      description: s.description || undefined,
      onClick: () => onOpen(s.path),
      onRun: () => onRunScript(s),
      onDelete: isSystem ? undefined : async () => {
        if (!window.confirm(`Delete script "${s.name}"?`)) return;
        await fsDelete(s.path);
        refresh();
      },
    }));

  return (
    <div className={styles.panel}>
      <div className={styles.tabStrip} style={{ display: "flex", alignItems: "center" }}>
        <button
          type="button"
          className={`${styles.tab} ${activeTab === "system" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("system")}
        >
          System
        </button>
        <button
          type="button"
          className={`${styles.tab} ${activeTab === "custom" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("custom")}
        >
          Custom
        </button>
        <span style={{ flex: 1 }} />
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            writeToActiveSession(
              "Help me create a new script for this project and save it to filestores/scripts/. Ask me what I want it to do.\r",
            )
          }
        >
          + New
        </Button>
      </div>

      {activeTab === "system" && (
        <>
          <p className={styles.tagline}>
            Scripts that ship with OpenIT. Power slash commands and internal operations.
          </p>
          <EntityCardGrid
            kind="scripts"
            cards={buildCards(systemScripts, true)}
            empty="No system scripts found."
          />
        </>
      )}

      {activeTab === "custom" && (
        <>
          <p className={styles.tagline}>
            Scripts you or Claude have created. Runnable from the terminal or via slash commands.
          </p>
          <EntityCardGrid
            kind="scripts"
            cards={buildCards(customScripts, false)}
            empty="No custom scripts yet. Click + New to create one."
          />
        </>
      )}
    </div>
  );
}
