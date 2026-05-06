import { useCallback, useEffect, useRef, useState } from "react";
import { Onboarding } from "./Onboarding";
import { Shell } from "./shell/Shell";
import { CommandPalette } from "./shell/CommandPalette";
import {
  entityDeleteFile,
  entityWriteFile,
  fsRead,
  intakeStart,
  projectBootstrap,
  slackConfigRead,
  slackListenerStart,
  slackListenerStatus,
  slackListenerStop,
  stateLoad,
  stateSave,
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
import { syncSkillsToDisk, readSyncedPluginVersion, type Bubble as ManifestBubble } from "./lib/skillsSync";
import { seedIfEmpty } from "./lib/seed";
import { invoke } from "@tauri-apps/api/core";
import { type Bubble as PromptBubble } from "./shell/PromptBubbles";
import "./App.css";

const DEFAULT_BUBBLES: PromptBubble[] = [
  { label: "Reports", prompt: "/reports weekly-digest" },
  { label: "Access", prompt: "/access map" },
  { label: "People", prompt: "/people" },
];

// Default project identity for the local workspace.
// Folder lands at `~/OpenIT/Personal/`. Stable across launches so the
// same local helpdesk is reopened on relaunch.
const LOCAL_ORG_ID = "Personal";
const LOCAL_ORG_NAME = "Personal";

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

function convertBubblesForPrompt(manifestBubbles: ManifestBubble[]): PromptBubble[] {
  return manifestBubbles.map((b) => ({
    label: b.label,
    prompt: b.skill,
  }));
}

// ---------------------------------------------------------------------------
// V1 → V2 folder-layout migration for the triage agent.
// Reads a flat `agents/triage.json` and moves it into the
// `agents/triage/{triage.json, common.md}` folder structure.
// Idempotent: no-ops when the folder layout already exists.
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
  const flatExists = await fileExistsOnDisk(repo, "agents/triage.json");
  const folderExists = await fileExistsOnDisk(repo, "agents/triage/triage.json");
  if (!flatExists || folderExists) return;

  try {
    const content = await fsRead(`${repo}/agents/triage.json`);
    const parsed = JSON.parse(content) as {
      instructions?: unknown;
      [k: string]: unknown;
    };
    const { instructions, ...structured } = parsed;

    await entityWriteFile(
      repo,
      "agents/triage",
      "triage.json",
      JSON.stringify(structured, null, 2),
    );

    if (typeof instructions === "string" && instructions.length > 0) {
      await entityWriteFile(repo, "agents/triage", "common.md", instructions);
    }

    await entityDeleteFile(repo, "agents", "triage.json");
    console.log("[migrate] flat agents/triage.json → agents/triage/ folder");
  } catch (e) {
    console.error("[migrate] V2 folder migration failed:", e);
  }
}

function App() {
  const [repo, setRepo] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [bypassOnboarding, setBypassOnboarding] = useState(false);
  const [bubbles, setBubbles] = useState<PromptBubble[]>(DEFAULT_BUBBLES);
  const [intakeServerUrl, setIntakeServerUrl] = useState<string | null>(null);
  const [slackConfig, setSlackConfig] = useState<SlackConfig | null>(null);
  const [slackStatus, setSlackStatus] = useState<SlackStatus | null>(null);
  // Which secret-paste affordance the chat-anchored SkillActionDock
  // should surface, if any. Driven by the connect-slack skill via
  // `.openit/skill-state/connect-slack.json` — Claude writes
  // `{"skill":"connect-slack","dock":"bot-token-paste"|null}` and the
  // fs-watcher below picks it up.
  const [dock, setDock] = useState<DockKind | undefined>(undefined);
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
      if (paths.some((p) => p.endsWith("/.openit/slack.json"))) {
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

  // Boot sequence — local-only. No auth, no cloud sync.
  // 1. stateLoad() to recover the last-used repo path
  // 2. projectBootstrap into ~/OpenIT/local/ if needed
  // 3. migrateFlatTriage (V1 → V2 folder layout, local-only migration)
  // 4. syncSkillsToDisk if the bundled plugin version is ahead of disk
  // 5. setRepo, setBypassOnboarding(true), finish
  useEffect(() => {
    stateLoad()
      .then(async (s) => {
        // Repos created before we moved out of ~/Documents are stale — TCC blocks
        // fs/git ops there. Discard so we re-bootstrap into the new ~/OpenIT/ root.
        const stale = s.last_repo?.includes("/Documents/OpenIT/") ?? false;
        const lastRepo = stale ? null : s.last_repo;
        if (stale) {
          console.log("[app] discarding legacy ~/Documents/OpenIT/ last_repo");
        }
        console.log("[app] startup state:", {
          hasRepo: !!lastRepo,
          localOnly: true,
        });

        try {
          console.log("[app] local-only bootstrap");
          let projectPath: string;
          if (lastRepo) {
            // Re-run bootstrap so idempotent layout guards in project.rs
            // (e.g. creating new top-level dirs like `reports/` that
            // shipped after the project was first initialized) fire on
            // existing projects. Rust gates first-run side effects on
            // `!already_existed`, so this is safe to call.
            try {
              await projectBootstrap({ orgName: LOCAL_ORG_NAME, orgId: LOCAL_ORG_ID });
            } catch (e) {
              console.warn("[app] local-relaunch bootstrap failed (non-fatal):", e);
            }
            projectPath = lastRepo;
          } else {
            const result = await projectBootstrap({
              orgName: LOCAL_ORG_NAME,
              orgId: LOCAL_ORG_ID,
            });
            projectPath = result.path;
            await stateSave({
              last_repo: projectPath,
              pane_sizes: s.pane_sizes ?? null,
              pinned_bubbles: s.pinned_bubbles ?? null,
              onboarding_complete: s.onboarding_complete ?? false,
            });
          }

          // V1 → V2 migration must complete before syncSkillsToDisk
          // touches `agents/triage/`. Otherwise the bundled plugin
          // writes the folder layout first, the shim sees
          // `folderExists=true` and bails — silently abandoning the
          // user's V1 `instructions` in the orphaned flat file.
          try {
            await migrateFlatTriage(projectPath);
          } catch (e) {
            console.warn("[app] migration failed (non-fatal):", e);
          }

          setRepo(projectPath);
          setBypassOnboarding(true);

          // Sync the bundled plugin if the sentinel triage agent file
          // isn't on disk yet or the version is out of date.
          if (!(await bundledPluginIsCurrent(projectPath))) {
            syncSkillsToDisk(projectPath, null)
              .then((manifest) => {
                console.log("[app] bundled skill sync complete, bubbles:", manifest.bubbles);
                setBubbles(convertBubblesForPrompt(manifest.bubbles));
              })
              .catch((e) => console.error("bundled skill sync failed:", e));
          }
        } catch (e) {
          console.error("[app] local-only bootstrap failed:", e);
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
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
        onContinue={() => setBypassOnboarding(true)}
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
        bubbles={bubbles}
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
