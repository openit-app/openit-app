import { useEffect, useState } from "react";
import { fsList, fsRead, scriptRun, entityWriteFile } from "../lib/api";
import { isDirectChild } from "../lib/paths";
import { Button } from "../ui";
import styles from "./ToolsPanel.module.css";

type ScriptEntry = {
  name: string;
  description: string;
  path: string;
};

/**
 * ScriptsStation — flat list of user-created scripts from
 * `filestores/scripts/` with a visible Run button on each row.
 * System scripts under `.claude/scripts/` are plumbing and stay hidden.
 */
export function ScriptsStation({
  repo,
  fsTick,
  onOpen,
  onShowSource,
}: {
  repo: string;
  fsTick?: number;
  onOpen: (path: string) => void;
  onShowSource?: (source: { kind: "script-output"; script: string; stdout: string; stderr: string; exitCode: number; durationMs: number }) => void;
}) {
  const [scripts, setScripts] = useState<ScriptEntry[]>([]);
  const [showNewInput, setShowNewInput] = useState(false);
  const [newName, setNewName] = useState("");
  const [search, setSearch] = useState("");

  const q = search.toLowerCase();
  const visible = q
    ? scripts.filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q))
    : scripts;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries: ScriptEntry[] = [];
      try {
        const root = `${repo}/filestores/scripts`;
        const nodes = await fsList(root);
        const files = nodes.filter((n) => {
          if (n.is_dir || !isDirectChild(root, n.path)) return false;
          return n.name.endsWith(".mjs") || n.name.endsWith(".js") || n.name.endsWith(".cjs") || n.name.endsWith(".py");
        });
        for (const f of files) {
          entries.push({ name: f.name, description: extractComment(await fsRead(f.path).catch(() => "")), path: f.path });
        }
      } catch { /* filestores/scripts/ doesn't exist */ }

      entries.sort((a, b) => a.name.localeCompare(b.name));
      if (!cancelled) setScripts(entries);
    })();
    return () => { cancelled = true; };
  }, [repo, fsTick]);

  const runScript = async (script: ScriptEntry) => {
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

  const createNewScript = async () => {
    const slug = newName.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-_.]/g, "");
    if (!slug) return;
    const filename = slug.endsWith(".mjs") || slug.endsWith(".js") || slug.endsWith(".py")
      ? slug
      : `${slug}.mjs`;
    const boilerplate = `#!/usr/bin/env node
// ${slug} — describe what this script does

async function main() {
  // Your code here
  console.log(JSON.stringify({ ok: true }));
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: e.message }));
  process.exit(1);
});
`;
    await entityWriteFile(repo, "filestores/scripts", filename, boilerplate);
    setShowNewInput(false);
    setNewName("");
    onOpen(`${repo}/filestores/scripts/${filename}`);
  };

  return (
    <div className={styles.panel}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <p className={styles.tagline} style={{ margin: 0 }}>
          Click a script to run it.
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
        placeholder="Search scripts…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {showNewInput && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
          <input
            className={styles.search}
            type="text"
            placeholder="script-name.mjs"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void createNewScript();
              if (e.key === "Escape") { setShowNewInput(false); setNewName(""); }
            }}
            autoFocus
          />
          <Button variant="secondary" size="sm" onClick={() => void createNewScript()}>
            Create
          </Button>
        </div>
      )}

      {visible.length === 0 ? (
        <div className={styles.empty}>{q ? "No matching scripts." : "No scripts found."}</div>
      ) : (
        <div className={styles.grid}>
          {visible.map((s) => (
            <div
              key={s.name}
              className={styles.card}
              style={{ cursor: "pointer" }}
              onClick={() => runScript(s)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") void runScript(s);
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
                  {s.name}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen(s.path);
                  }}
                  title={`View source of ${s.name}`}
                  aria-label={`View source of ${s.name}`}
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                </Button>
              </div>
              {s.description && (
                <p className={styles.cardDesc}>{s.description}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function extractComment(raw: string): string {
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#!/")) continue;
    if (trimmed.startsWith("//") || trimmed.startsWith("#")) {
      return trimmed.replace(/^(\/\/|#)\s*/, "").slice(0, 120);
    }
    if (trimmed.startsWith("/*")) {
      return trimmed.replace(/^\/\*\s*/, "").replace(/\*\/\s*$/, "").slice(0, 120);
    }
    if (trimmed && !trimmed.startsWith("import") && !trimmed.startsWith("const")) break;
  }
  return "";
}
