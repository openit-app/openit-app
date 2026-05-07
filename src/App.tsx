import { useCallback, useEffect, useRef, useState } from "react";
import { Onboarding } from "./Onboarding";
import { Shell } from "./shell/Shell";
import { CommandPalette } from "./shell/CommandPalette";
import {
  createWorkspace,
  entityWriteFile,
  fsRead,
  intakeStart,
  listWorkspaces,
  projectBootstrap,
  slackConfigRead,
  slackListenerStart,
  slackListenerStatus,
  slackListenerStop,
  stateLoad,
  type SlackConfig,
  type SlackStatus,
} from "./lib/api";
import {
  type DockKind,
  type SkillState,
  injectIntoChat,
  skillStateRead,
} from "./lib/skillState";
import { onFsChanged } from "./lib/fsWatcher";
import { useToast } from "./Toast";
import { Button, TitleRail } from "./ui";
import { StatusChips } from "./shell/StatusBar";
import { syncSkillsToDisk, readSyncedPluginVersion } from "./lib/skillsSync";
import { seedIfEmpty } from "./lib/seed";
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
  // V2 puts the triage agent in a folder; sentinel path moved with it.
  // If V2 path is missing, plugin sync must re-run (covers fresh
  // installs, post-cleanup states, and pre-V2 → V2 schema migrations).
  try {
    await fsRead(`${repo}/agents/triage/triage.json`);
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
      console.log("[migrate] V2 agents/triage/ folder → agents/triage.md");
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
        console.log("[migrate] V1 agents/triage.json → agents/triage.md");
      }
    } catch (e) {
      console.error("[migrate] V1→V3 agent migration failed:", e);
    }
  }
}

function App() {
  const [repo, setRepo] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [bypassOnboarding, setBypassOnboarding] = useState(false);
  const [intakeServerUrl, setIntakeServerUrl] = useState<string | null>(null);
  const [slackConfig, setSlackConfig] = useState<SlackConfig | null>(null);
  const [slackStatus, setSlackStatus] = useState<SlackStatus | null>(null);
  // Which secret-paste affordance the chat-anchored SkillActionDock
  // should surface, if any. Driven by the connect-slack skill via
  // `.openit/skill-state/connect-slack.json` — Claude writes
  // `{"skill":"connect-slack","dock":"bot-token-paste"|null}` and the
  // fs-watcher below picks it up.
  const [dock, setDock] = useState<DockKind | undefined>(undefined);

  /// Open a vault: bootstrap its layout, run migrations, sync plugin,
  /// set as active repo. Shared by boot (registry has an active path)
  /// and the vault picker (user chose a new folder).
  const openVault = useCallback(async (vaultPath: string) => {
    try {
      const result = await projectBootstrap(vaultPath);
      console.log("[app] vault bootstrapped:", result.path, result.created ? "(new)" : "(existing)");

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
          .then(() => console.log("[app] plugin sync complete"))
          .catch((e) => console.error("plugin sync failed:", e));
      }

      // Auto-seed sample data on every launch (idempotent — skips
      // files that already exist, so user data is never overwritten).
      seedIfEmpty({ repo: result.path, onLog: (msg) => console.log(`[seed] ${msg}`) })
        .catch((e) => console.error("seed failed:", e));
    } catch (e) {
      console.error("[app] openVault failed:", e);
      setLoaded(true);
    }
  }, []);
  // xoxb- token staged in App-level state between the bot-token-paste
  // and app-token-paste moments. Survives re-renders / unmounts of
  // the SkillActionDock. In-memory only — Keychain takes over after
  // slackConnect succeeds.
  const [stagedSlackBotToken, setStagedSlackBotToken] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const manualPullRef = useRef<(() => void) | null>(null);

  // Single-source-of-truth handler for "kick off the Slack flow":
  //   inject /connect-slack into Claude.
  // Used by the cmd-K palette AND the bottom-bar Slack pill so both
  // surfaces behave identically.
  const triggerSlackFlow = useCallback(async () => {
    if (!repo) return;
    injectIntoChat("/connect-slack").catch((e) =>
      console.warn("[app] inject /connect-slack failed:", e),
    );
  }, [repo]);

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
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen]);

  const toast = useToast();

  // Watch `.openit/flash.json` for ephemeral confirmations posted by
  // plugin scripts ("✓ Manifest copied", "✓ Slack disconnected", etc).
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
      if (paths.some((p) => p.endsWith("/.openit/flash.json"))) {
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

  // Watch the connect-slack skill side-channel for dock state. The
  // skill writes `{"skill":"connect-slack","dock":"bot-token-paste"|...}`
  // when it reaches a paste step in chat; the dock under the chat
  // surfaces the matching button. When dock is null/absent, the dock
  // renders nothing.
  const ACTIVE_DOCK_SKILL = "connect-slack";
  useEffect(() => {
    if (!repo) {
      setDock(undefined);
      return;
    }
    let mounted = true;
    const refresh = () =>
      skillStateRead(repo, ACTIVE_DOCK_SKILL)
        .then((s: SkillState | null) => {
          if (mounted) setDock(s?.dock ?? null);
        })
        .catch((e) => console.warn("[app] dock state read failed:", e));
    refresh();
    let unlistenFn: (() => void) | null = null;
    onFsChanged((paths) => {
      if (paths.some((p) => p.includes("/.openit/skill-state/"))) {
        refresh();
      }
    })
      .then((un) => {
        if (mounted) unlistenFn = un;
        else un();
      })
      .catch((e) => console.warn("[app] dock watcher init failed:", e));
    return () => {
      mounted = false;
      unlistenFn?.();
    };
  }, [repo]);

  // Slack lifecycle:
  //
  //   1. On project open (repo set), read .openit/slack.json. If
  //      present, auto-start the listener as soon as the intake
  //      server URL is also known. Both are required because the
  //      listener needs OPENIT_INTAKE_URL.
  //   2. While a project is open, poll status every 5s so the
  //      header pill flips between running/stopped without user
  //      action. Cheap call — just reads supervisor state.
  //   3. On project switch / null repo: stop the listener and clear
  //      state. The supervisor's stop is idempotent (safe to call
  //      when nothing's running), so no need to gate on
  //      slackStatus?.running.
  const slackOrgId = "local";
  // Declared up here (rather than next to the auto-start effect
  // below) because the slack-config effect's fs-watcher resets it
  // when slack.json disappears, so the next reconnect can re-arm
  // auto-start. Both effects close over the same ref.
  const slackAutoStartedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!repo) {
      setSlackConfig(null);
      setSlackStatus(null);
      // Best-effort: stop a listener that might still be pointed at
      // the previous project. Errors are fine to ignore — if there
      // was nothing running, stop is a no-op.
      slackListenerStop().catch(() => {});
      return;
    }
    let mounted = true;
    const refreshConfig = () =>
      slackConfigRead(repo)
        .then((cfg) => {
          if (mounted) setSlackConfig(cfg);
        })
        .catch((e) => console.warn("[app] slack config read failed:", e));
    refreshConfig();
    const refreshStatus = () =>
      slackListenerStatus()
        .then((s) => {
          if (mounted) setSlackStatus(s);
        })
        .catch(() => {});
    refreshStatus();
    const id = setInterval(refreshStatus, 5_000);
    // Re-read slack.json whenever it changes on disk — covers the
    // disconnect-script path, where the script removes the file
    // (and tokens, and listener) without going through the FE. The
    // refresh flips slackConfig to null, which in turn flips the
    // status pill from "connected" back to the unconnected pill.
    let unlistenFn: (() => void) | null = null;
    onFsChanged((paths) => {
      if (paths.some((p) => p.endsWith("/.openit/slack.json") || p.includes("/.openit/skill-state/connect-slack"))) {
        refreshConfig();
        // Reset the auto-start latch so the next reconnect (if any)
        // is allowed to bring the listener back up.
        slackAutoStartedRef.current = null;
      }
    })
      .then((un) => {
        if (mounted) unlistenFn = un;
        else un();
      })
      .catch((e) => console.warn("[app] slack.json watcher init failed:", e));
    return () => {
      mounted = false;
      clearInterval(id);
      unlistenFn?.();
    };
  }, [repo]);

  // Auto-start: when both repo and intakeServerUrl are known and a
  // slack config exists, start the listener — exactly ONCE per
  // (repo, intakeUrl) pair. We deliberately do NOT re-fire when
  // the supervisor flips back to stopped: a listener that crashes
  // because of a bad token would thrash-restart every 5s. After
  // an unexpected exit, the user clicks the Slack pill to re-run
  // /connect-slack; Claude surfaces the captured exit error in
  // chat and the dock's app-token field lets the user re-paste.
  useEffect(() => {
    if (!repo || !intakeServerUrl || !slackConfig) return;
    const key = `${repo}|${intakeServerUrl}`;
    if (slackAutoStartedRef.current === key) return;
    slackAutoStartedRef.current = key;
    let cancelled = false;
    (async () => {
      try {
        await slackListenerStart({
          repo,
          intakeUrl: intakeServerUrl,
          orgId: slackOrgId,
        });
        if (!cancelled) {
          // Re-read status immediately so the pill flips green
          // without waiting for the 5s interval tick.
          slackListenerStatus()
            .then((s) => setSlackStatus(s))
            .catch(() => {});
        }
      } catch (e) {
        console.warn("[app] slack listener auto-start failed:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repo, intakeServerUrl, slackConfig, slackOrgId]);

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
  // Writes the bundled sample tickets/people/conversations/KB articles
  // to disk. Per-target gate is just "is the local folder empty?" so
  // re-clicks after content exists are no-ops, not clobber.
  useEffect(() => {
    const onCreateSamples = () => {
      if (!repo) {
        console.warn("[app] create-samples clicked before repo is ready");
        return;
      }
      seedIfEmpty({ repo, onLog: (msg) => console.log(`[seed] ${msg}`) })
        .then((res) => console.log(`[app] create-samples wrote ${res.wrote} file(s)`))
        .catch((e) => console.error("[app] create-samples failed:", e));
    };
    window.addEventListener("openit:create-samples", onCreateSamples);
    return () => window.removeEventListener("openit:create-samples", onCreateSamples);
  }, [repo]);

  // Boot sequence — registry-driven.
  // 1. Read workspace registry for the active vault path
  // 2. If no workspaces, show the vault picker (onboarding)
  // 3. If active workspace exists, bootstrap it and load
  useEffect(() => {
    listWorkspaces()
      .then(async (reg) => {
        const activePath = reg.active;
        console.log("[app] startup:", {
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
              const name = s.last_repo.split("/").filter(Boolean).pop() ?? "Personal";
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

  // Localhost ticket-intake server lifecycle. Tied to `repo` — start
  // when a project opens, transparently restart with the new path on
  // project switch. The Rust side enforces single-instance semantics:
  // intakeStart awaits an internal stop_inner before binding, so calling
  // it with a new repo cleanly swaps the previous server.
  //
  // Why no intakeStop in cleanup: a rapid repo change A → B can have
  // intakeStart(A)'s promise still pending when B's effect runs. If
  // A's cleanup called intakeStop and then A's promise resolved, the
  // resolve handler would see `cancelled=true`. Worse: if the cleanup
  // *and* a follow-up resolve both call intakeStop, the second one
  // kills server B that B's effect just brought up. Trusting Rust's
  // swap semantics + skipping cleanup-stop is simpler and race-free.
  // App close kills the spawned task via the tokio runtime drop on
  // process exit — no manual stop needed there either.
  const intakeGenRef = useRef(0);
  useEffect(() => {
    // Bump the generation counter unconditionally — including when
    // repo transitions to null. Without this, a still-pending
    // intakeStart from the previous repo could resolve after we set
    // the URL to null and overwrite it with a stale value (its gen
    // would still match because we didn't increment).
    const myGen = ++intakeGenRef.current;
    if (!repo) {
      setIntakeServerUrl(null);
      return;
    }
    intakeStart(repo)
      .then((url) => {
        if (intakeGenRef.current !== myGen) return;
        console.log("[app] intake server up at", url);
        setIntakeServerUrl(url);
      })
      .catch((e) => {
        if (intakeGenRef.current !== myGen) return;
        console.error("[app] intake start failed:", e);
        setIntakeServerUrl(null);
      });
  }, [repo]);

  const showOnboarding = loaded && !bypassOnboarding;

  if (!loaded) {
    return <div className="shell-loading">Loading…</div>;
  }

  if (showOnboarding) {
    return (
      <Onboarding
        onOpenVault={async (path: string) => {
          const name = path.split("/").filter(Boolean).pop() ?? "Vault";
          await createWorkspace(path, name);
          await openVault(path);
        }}
      />
    );
  }

  return (
    <>
    <main className="app">
      <TitleRail
        left={
          <StatusChips
            intakeUrl={intakeServerUrl}
            slackConfig={slackConfig}
            slackStatus={slackStatus}
            onConnectSlack={triggerSlackFlow}
          />
        }
        right={
          <>
            <Button
              variant="cmdk"
              size="md"
              onClick={() => setPaletteOpen(true)}
              title="Command palette"
            >
              <kbd>⌘</kbd>
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
        intakeUrl={intakeServerUrl}
        dock={dock}
        slackOrgId={slackOrgId}
        stagedSlackBotToken={stagedSlackBotToken}
        onStagedSlackBotTokenChange={setStagedSlackBotToken}
        registerManualPull={(fn) => { manualPullRef.current = fn; }}
      />
    </main>
    <CommandPalette
      open={paletteOpen}
      onClose={() => setPaletteOpen(false)}
      onConnectSlack={triggerSlackFlow}
      onManualPull={() => manualPullRef.current?.()}
      onOpenWelcome={() => window.dispatchEvent(new CustomEvent("openit:open-welcome"))}
    />
    </>
  );
}

export default App;
