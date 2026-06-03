import { useCallback, useEffect, useRef, useState } from "react";
import { Onboarding } from "./Onboarding";
import { Shell } from "./shell/Shell";
import { CommandPalette } from "./shell/CommandPalette";
import {
  createWorkspace,
  entityWriteFile,
  fsRead,
  listWorkspaces,
  projectBootstrap,
  stateLoad,
} from "./lib/api";
import { onFsChanged } from "./lib/fsWatcher";
import { useToast } from "./Toast";
import { Button, TitleRail, UpdateChip } from "./ui";
import { useUpdateChecker } from "./lib/updater";
import { syncSkillsToDisk, readSyncedPluginVersion } from "./lib/skillsSync";
import { seedIfEmpty } from "./lib/seed";
import { basename, fsNorm } from "./lib/paths";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";


/// Is the bundled plugin already synced at the *current* manifest version?
/// Returns true when both (a) the triage-agent install sentinel exists
/// (so we know a sync ran successfully at some point) AND (b) the
/// version sentinel matches the bundled manifest's version (so we know
/// the on-disk files reflect the current build, not an older one).
///
/// Falsely returning true would skip syncing newly-added manifest files
/// onto existing projects (which is exactly what happened when reports
/// shipped — the script never reached `.claude/scripts/`). Falsely
/// returning false re-runs the sync, which is idempotent on the .claude/
/// scaffolding and a no-op commit on the rest, so it's the safer error.
///
/// Why two sentinels rather than one: the triage file lives outside
/// .claude/ (user-editable). Deleting it as the version cue would
/// destroy admin edits. The plugin-version sentinel inside .openit/ is
/// owned exclusively by the sync.
async function bundledPluginIsCurrent(repo: string): Promise<boolean> {
  // V3 agents are single .md files. If the triage agent is missing,
  // plugin sync must re-run (covers fresh installs, post-cleanup
  // states, and V2 → V3 migrations where the .md wasn't written).
  try {
    await fsRead(`${repo}/agents/triage.md`);
  } catch {
    return false;
  }
  try {
    const bundledManifestJson = await invoke<string>("skills_fetch_bundled_manifest");
    const bundledVersion = (JSON.parse(bundledManifestJson) as { version?: string }).version;
    if (!bundledVersion) return true; // no version field → can't tell, treat as current
    const onDisk = await readSyncedPluginVersion(repo);
    return onDisk === bundledVersion;
  } catch (e) {
    console.warn("[app] plugin-version probe failed:", e);
    return true; // err on the side of not re-syncing
  }
}


// ---------------------------------------------------------------------------
// V1 → V2 folder-layout migration for the triage agent.
// Reads a flat `agents/triage.json` and moves it into the
// Agent migration: V1 (flat JSON) and V2 (folder with 4 files) both
// collapse to V3 (single markdown file). Idempotent.
// ---------------------------------------------------------------------------

async function fileExistsOnDisk(repo: string, relPath: string): Promise<boolean> {
  try {
    await invoke<string>("fs_read", { path: `${repo}/${relPath}` });
    return true;
  } catch {
    return false;
  }
}

async function migrateFlatTriage(repo: string): Promise<void> {
  // Already on V3 — single markdown file
  if (await fileExistsOnDisk(repo, "agents/triage.md")) return;

  // V2 → V3: merge common.md + local.md into triage.md
  const hasCommon = await fileExistsOnDisk(repo, "agents/triage/common.md");
  const hasLocal = await fileExistsOnDisk(repo, "agents/triage/local.md");
  if (hasCommon || hasLocal) {
    try {
      let content = "";
      if (hasCommon) {
        content += await fsRead(`${repo}/agents/triage/common.md`);
      }
      if (hasLocal) {
        const local = await fsRead(`${repo}/agents/triage/local.md`);
        content += (content ? "\n\n## Runtime context\n\n" : "") + local;
      }
      await entityWriteFile(repo, "agents", "triage.md", content);
      // Clean up old folder — delete all files inside, then the dir itself
      try {
        const { fsList, fsDelete } = await import("./lib/api");
        const old = await fsList(`${repo}/agents/triage`);
        for (const f of old) {
          if (!f.is_dir) await fsDelete(f.path).catch(() => {});
        }
        // Remove empty dir via invoke (no dedicated command, but
        // entity_clear_dir wipes contents; the dir stays but is empty)
        await invoke("entity_clear_dir", { repo, subdir: "agents/triage" }).catch(() => {});
      } catch { /* cleanup is best-effort */ }
      console.debug("[migrate] V2 agents/triage/ folder → agents/triage.md");
    } catch (e) {
      console.error("[migrate] V2→V3 agent migration failed:", e);
    }
    return;
  }

  // V1 → V3: flat triage.json with instructions field
  if (await fileExistsOnDisk(repo, "agents/triage.json")) {
    try {
      const raw = await fsRead(`${repo}/agents/triage.json`);
      const parsed = JSON.parse(raw) as { instructions?: unknown };
      const instructions = typeof parsed.instructions === "string" ? parsed.instructions : "";
      if (instructions) {
        await entityWriteFile(repo, "agents", "triage.md", instructions);
        console.debug("[migrate] V1 agents/triage.json → agents/triage.md");
      }
    } catch (e) {
      console.error("[migrate] V1→V3 agent migration failed:", e);
    }
  }
}

function App() {
  const updateState = useUpdateChecker();
  const [repo, setRepo] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [bypassOnboarding, setBypassOnboarding] = useState(false);

  /// Open a vault: bootstrap its layout, run migrations, sync plugin,
  /// set as active repo. Shared by boot (registry has an active path)
  /// and the vault picker (user chose a new folder).
  const openVault = useCallback(async (vaultPath: string) => {
    try {
      const result = await projectBootstrap(vaultPath);
      console.debug("[app] vault bootstrapped:", result.path, result.created ? "(new)" : "(existing)");

      try {
        await migrateFlatTriage(result.path);
      } catch (e) {
        console.warn("[app] migration failed (non-fatal):", e);
      }

      setRepo(result.path);
      setBypassOnboarding(true);
      setLoaded(true);

      if (!(await bundledPluginIsCurrent(result.path))) {
        syncSkillsToDisk(result.path)
          .then(() => console.debug("[app] plugin sync complete"))
          .catch((e) => console.error("plugin sync failed:", e));
      }

      // Sample data is NOT auto-seeded on install. Users can opt in
      // via the "Load sample data" CTA in getting-started.md, which
      // dispatches the `openit:create-samples` event handled below.
    } catch (e) {
      console.error("[app] openVault failed:", e);
      setLoaded(true);
    }
  }, []);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const manualPullRef = useRef<(() => void) | null>(null);

  // Global cmd-K / ctrl-K listener — opens the command palette from
  // anywhere in the app. We use a window listener (not document
  // capture) so xterm's own input still works; we just preventDefault
  // when the chord matches so the terminal doesn't see the K.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isCmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      if (isCmdK) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (e.key === "Escape" && paletteOpen) {
        setPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [paletteOpen]);

  const toast = useToast();

  // Watch `.openit/flash.json` for ephemeral confirmations posted by
  // plugin scripts ("✓ Manifest copied", etc).
  // The script overwrites the file with a fresh `{message, ts}`; we
  // de-dupe by `ts` so a re-render doesn't replay the same toast.
  const lastFlashTsRef = useRef<number>(0);
  useEffect(() => {
    if (!repo) return;
    let mounted = true;
    const flashPath = `${repo}/.openit/flash.json`;
    const consume = async () => {
      try {
        const raw = await fsRead(flashPath);
        const parsed = JSON.parse(raw) as { message?: string; ts?: number };
        const ts = typeof parsed.ts === "number" ? parsed.ts : 0;
        if (!parsed.message || ts <= lastFlashTsRef.current) return;
        lastFlashTsRef.current = ts;
        if (mounted) toast.show(parsed.message);
      } catch {
        // File missing / unparseable — nothing to flash.
      }
    };
    // Don't fire on initial mount — only react to NEW flashes after
    // the user is in-session. Initialize lastFlashTsRef with the
    // current file's ts (if any) so a stale flash from a previous
    // session doesn't pop up as soon as you launch.
    fsRead(flashPath)
      .then((raw) => {
        try {
          const parsed = JSON.parse(raw) as { ts?: number };
          if (typeof parsed.ts === "number") lastFlashTsRef.current = parsed.ts;
        } catch {}
      })
      .catch(() => {});
    let unlistenFn: (() => void) | null = null;
    onFsChanged((paths) => {
      // Normalize separators so the substring match works on Windows
      // (the fs watcher returns native paths, with `\` on win32).
      if (paths.some((p) => fsNorm(p).endsWith("/.openit/flash.json"))) {
        consume();
      }
    })
      .then((un) => {
        if (mounted) unlistenFn = un;
        else un();
      })
      .catch((e) => console.warn("[app] flash watcher init failed:", e));
    return () => {
      mounted = false;
      unlistenFn?.();
    };
  }, [repo, toast]);

  useEffect(() => {
    // Stop the WebView from navigating to a dropped file when the drop
    // happens outside our explicit handlers. Without this, dragging an
    // image anywhere in the window replaces the whole page with the
    // file preview.
    const stopDefault = (e: Event) => e.preventDefault();
    window.addEventListener("dragover", stopDefault);
    window.addEventListener("drop", stopDefault);
    return () => {
      window.removeEventListener("dragover", stopDefault);
      window.removeEventListener("drop", stopDefault);
    };
  }, []);

  // getting-started.md's "Create sample dataset" CTA dispatches this
  // event (Viewer.tsx::ExternalAnchor catches `openit://create-samples`).
  // Writes the bundled sample tasks/people/KB articles to disk.
  // Per-file gate skips anything already on disk, so re-clicks after
  // content exists are no-ops, not clobber.
  useEffect(() => {
    const onCreateSamples = () => {
      if (!repo) {
        console.warn("[app] create-samples clicked before repo is ready");
        return;
      }
      seedIfEmpty({ repo, onLog: (msg) => console.debug(`[seed] ${msg}`) })
        .then((res) => console.debug(`[app] create-samples wrote ${res.wrote} file(s)`))
        .catch((e) => console.error("[app] create-samples failed:", e));
    };
    window.addEventListener("openit:create-samples", onCreateSamples);
    return () => window.removeEventListener("openit:create-samples", onCreateSamples);
  }, [repo]);

  // "Change vault" from command palette — reset to onboarding
  useEffect(() => {
    const onChangeVault = () => {
      setBypassOnboarding(false);
      setRepo(null);
    };
    window.addEventListener("openit:change-vault", onChangeVault);
    return () => window.removeEventListener("openit:change-vault", onChangeVault);
  }, []);

  // Boot sequence — registry-driven.
  // 1. Read workspace registry for the active vault path
  // 2. If no workspaces, show the vault picker (onboarding)
  // 3. If active workspace exists, bootstrap it and load
  useEffect(() => {
    listWorkspaces()
      .then(async (reg) => {
        const activePath = reg.active;
        console.debug("[app] startup:", {
          workspaces: reg.workspaces.length,
          active: activePath,
        });

        if (!activePath) {
          // No workspace — show the vault picker (onboarding).
          // Also check legacy stateLoad for migration from Phase 1.
          try {
            const s = await stateLoad();
            if (s.last_repo && !s.last_repo.includes("/Documents/OpenIT/")) {
              // Migrate: register the legacy repo as a workspace
              const name = basename(s.last_repo) || "Personal";
              await createWorkspace(s.last_repo, name);
              await openVault(s.last_repo);
              return;
            }
          } catch {
            // No legacy state — show picker
          }
          setLoaded(true);
          return;
        }

        await openVault(activePath);
      })
      .catch((e) => {
        console.error("[app] boot failed:", e);
        setLoaded(true);
      });
  }, []);

  const showOnboarding = loaded && !bypassOnboarding;

  if (!loaded) {
    return <div className="shell-loading">Loading…</div>;
  }

  if (showOnboarding) {
    return (
      <Onboarding
        onOpenVault={async (path: string) => {
          // Always create OpenIT/Personal inside the chosen directory,
          // unless the user picked a path that already IS an OpenIT vault.
          let vaultPath = path;
          if (vaultPath) {
            const norm = vaultPath.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
            const endsWithVault = norm.endsWith("/openit");
            if (!endsWithVault) {
              const sep = vaultPath.includes("\\") ? "\\" : "/";
              vaultPath = vaultPath.replace(/[\\/]+$/, "") + sep + "OpenIT";
            }
          }
          const result = await projectBootstrap(vaultPath || undefined);
          const resolved = result.path;
          const sep = resolved.includes("\\") ? "\\" : "/";
          const name = resolved.split(sep).filter(Boolean).pop() ?? "Personal";
          await createWorkspace(resolved, name);
          await openVault(resolved);
        }}
      />
    );
  }

  return (
    <>
    <main className="app">
      <TitleRail
        left={<UpdateChip update={updateState} />}
        right={
          <>
            <Button
              variant="cmdk"
              size="md"
              onClick={() => setPaletteOpen(true)}
              title="Command palette"
            >
              <kbd>{navigator.userAgent.includes("Mac") ? "⌘" : "Ctrl"}</kbd>
              <kbd>K</kbd>
              <span>jump anywhere</span>
            </Button>
            <Button
              variant="ghost"
              size="md"
              onClick={() =>
                window.dispatchEvent(new CustomEvent("openit:open-welcome"))
              }
              title="Open the welcome / getting-started doc"
            >
              Getting Started
            </Button>
          </>
        }
      />
      <Shell
        key={repo ?? "none"}
        repo={repo}
        registerManualPull={(fn) => { manualPullRef.current = fn; }}
      />
    </main>
    <CommandPalette
      open={paletteOpen}
      onClose={() => setPaletteOpen(false)}
      repo={repo}
      onManualPull={() => manualPullRef.current?.()}
      onOpenWelcome={() => window.dispatchEvent(new CustomEvent("openit:open-welcome"))}
      onShowDraft={(source) => window.dispatchEvent(new CustomEvent("openit:show-draft", { detail: source }))}
    />
    </>
  );
}

export default App;
