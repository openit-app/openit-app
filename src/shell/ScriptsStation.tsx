import { useEffect, useRef, useState } from "react";
import { fsList, fsRead, scriptRun, entityWriteFile } from "../lib/api";
import { isDirectChild } from "../lib/paths";
import { Button } from "../ui";
import { PlayIcon } from "./PlayIcon";
import styles from "./ToolsPanel.module.css";

type ScriptEntry = {
  name: string;
  description: string;
  path: string;
};

/**
 * ScriptsStation — flat list of user-created scripts from
 * `filestores/scripts/` with a visible Run button on each row.
 * System scripts under `.claude/scripts/` are plumbing and stay
 * hidden.
 *
 * Click-on-tile and the explicit Run button both trigger the run.
 * While a run is in flight the button shows a spinner instead of the
 * play glyph and rejects further activations so the user can't queue
 * up four runs in a row by accident.
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
  // Per-script "is currently running" flag, keyed by absolute path.
  // Used to swap the play glyph for a spinner and gate re-entry.
  //
  // Two parallel stores: a ref for the *synchronous* read/add inside
  // `runScript` (state updates would only land on the next render, so
  // two rapid-fire clicks both pass an `if (state.has(path)) return`
  // guard and spawn two concurrent runs), and a state set for the UI
  // render trigger. Always mutate the ref first, then mirror to state.
  const runningRef = useRef<Set<string>>(new Set());
  const [runningPaths, setRunningPaths] = useState<Set<string>>(new Set());
  // Last-run error keyed by absolute path. Cleared whenever the same
  // script is re-run successfully. Shown as a one-liner under the
  // card title so the user doesn't have to open the output viewer
  // to see "Node.js not found".
  const [errors, setErrors] = useState<Record<string, string>>({});

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
    // Synchronous guard against double-fires: rapid tile+button
    // clicks both used to pass an `if (state.has(path)) return`
    // check because React batches state updates. The ref is read
    // and mutated atomically (single JS turn), so the second
    // invocation here sees the path already present and bails
    // before reaching `scriptRun`.
    if (runningRef.current.has(script.path)) return;
    runningRef.current.add(script.path);
    setRunningPaths((prev) => {
      const next = new Set(prev);
      next.add(script.path);
      return next;
    });
    setErrors((prev) => {
      if (!(script.path in prev)) return prev;
      const next = { ...prev };
      delete next[script.path];
      return next;
    });
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
      const reason = e instanceof Error ? e.message : String(e);
      console.error("[scripts] run failed:", e);
      setErrors((prev) => ({ ...prev, [script.path]: reason }));
    } finally {
      runningRef.current.delete(script.path);
      setRunningPaths((prev) => {
        const next = new Set(prev);
        next.delete(script.path);
        return next;
      });
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
          {visible.map((s) => {
            const isRunning = runningPaths.has(s.path);
            const err = errors[s.path];
            return (
              <div
                key={s.name}
                className={styles.card}
                style={{ cursor: isRunning ? "progress" : "pointer", opacity: isRunning ? 0.85 : 1 }}
                onClick={() => void runScript(s)}
                role="button"
                aria-busy={isRunning}
                aria-disabled={isRunning}
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
                  <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    {/*
                      Primary "Run" button — explicit affordance so
                      users don't have to discover that the whole
                      tile is clickable. Always visible (no hover-
                      reveal) per Ben's Slack feedback. Click handler
                      stops propagation so the tile-level onClick
                      doesn't double-fire.
                    */}
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        void runScript(s);
                      }}
                      disabled={isRunning}
                      title={isRunning ? `Running ${s.name}…` : `Run ${s.name}`}
                      aria-label={isRunning ? `Running ${s.name}` : `Run ${s.name}`}
                    >
                      {isRunning ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                          <RunSpinner /> Running…
                        </span>
                      ) : (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                          <PlayIcon /> Run
                        </span>
                      )}
                    </Button>
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
                </div>
                {s.description && (
                  <p className={styles.cardDesc}>{s.description}</p>
                )}
                {err && (
                  <p
                    className={styles.cardDesc}
                    style={{ color: "#b04028" }}
                    role="alert"
                  >
                    {err}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/// 12px spinner shown next to "Running…" while a script is in
/// flight. Reuses the global `sc-spin` keyframe defined in App.css;
/// the SVG is local so we don't pull in another helper.
function RunSpinner() {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      style={{ animation: "sc-spin 0.85s linear infinite" }}
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" />
    </svg>
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
