import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import {
  agentTraceLatest,
  entityWriteFile,
  fsDelete,
  fsRead,
  stateLoad,
  type AppPersistedState,
} from "../lib/api";
import { fsWatchStart, fsWatchStop, onFsChanged } from "../lib/fsWatcher";
// Auto-commit disabled in local-first mode.
import { startSkillMirrorDriver, stopSkillMirrorDriver } from "../lib/skillMirror";
import { ChatPane } from "./ChatPane";
import { ChatShellHeader } from "./ChatShellHeader";
import { PaneDragHandle } from "./PaneDragHandle";
// StatusBar is no longer rendered at the bottom of the shell. The
// status chips (project, cloud, intake, slack, changes) now live in
// the TitleRail at the top — see src/App.tsx. The bottom of the
// window is pure cream gutter, fixing the "panes look chipped off"
// feedback. The StatusChips export is consumed there.
import { Workbench } from "./Workbench";
import { ConflictBanner } from "./ConflictBanner";
import { FileExplorer } from "./FileExplorer";
import { EscalatedTicketBanner } from "./EscalatedTicketBanner";
import { AgentActivityBanner } from "./AgentActivityBanner";
// SourceControl removed — local-first mode has no commit/push UI.
// Phase 2 re-introduces it gated to syncMode === "git".
import { Viewer, type ViewerSource } from "./Viewer";
// Tab, TabStrip, PaneBody removed — left pane is now just FileExplorer.
import type { DockKind } from "../lib/skillState";
import { resolvePathToSource } from "./entityRouting";
import { sourceToTreePath } from "./sourceToTreePath";
import { SkillActionDock } from "./SkillActionDock";

/// Stable id for each pane. Used to drive reordering — the user can
/// drag a pane's grip onto another pane and the layout state tracks
/// where each id lives. Insert-before semantics, like VS Code's tab
/// strip.
type PaneId = "left" | "center" | "right";
const DEFAULT_PANE_ORDER: PaneId[] = ["left", "center", "right"];
// Per-pane minimums (percentages). Tuned against the Tauri window
// minWidth of 1080px so even at the smallest allowed window each
// pane keeps room for its content:
//   left   22% of 1080 ≈ 238px — fits the 2-col Workbench stations
//   center 28% of 1080 ≈ 302px — keeps markdown / cards readable
//   right  26% of 1080 ≈ 281px — keeps the xterm legible
// Sum 76, leaving 24% slack for the user to redistribute.
const PANE_MIN: Record<PaneId, number> = { left: 22, center: 28, right: 26 };
const PANE_DEFAULT: Record<PaneId, number> = { left: 24, center: 40, right: 36 };

/// Module-level reentrancy guard for Claude-triggered pushes. Hoisted
/// out of the useEffect closure so a transient cleanup race (effect
/// re-runs faster than the async fs-watcher subscription tears down)
/// can't end up with two listeners that each have their own
/// `pushInFlight` flag — without this, a single push-request marker
/// fanned out into 3 parallel push runs in the wild.
const pushInFlightByRepo = new Set<string>();

/// Stable identity for a ViewerSource — used by the nav-history wrapper
/// to distinguish "refresh of the current view" (fs-tick re-resolve,
/// agent-trace reload, sync-line append) from "user navigated to a new
/// view". Refreshes replace in place; navigations push onto the back
/// stack. Without this, every fs change would stack a duplicate entry
/// and the back arrow would feel broken.
function sourceKey(s: ViewerSource): string {
  if (!s) return "null";
  switch (s.kind) {
    case "file":
      return `file:${s.path}`;
    case "sync":
      return "sync";
    case "diff":
      return "diff";
    case "datastore-table":
      return `datastore-table:${s.collection.name}`;
    case "datastore-row":
      return `datastore-row:${s.collection.name}:${(s.item as { key?: string }).key ?? ""}`;
    case "datastore-schema":
      return `datastore-schema:${s.collection.name}`;
    case "agent":
      return `agent:${(s.agent as { name?: string }).name ?? ""}`;
    case "workflow":
      return `workflow:${(s.workflow as { name?: string }).name ?? ""}`;
    case "conversation-thread":
      return `conversation-thread:${s.ticketId}`;
    case "conversations-list":
      return "conversations-list";
    case "people-list":
      return "people-list";
    case "agent-trace":
      return `agent-trace:${s.ticketId}`;
    case "agent-trace-list":
      return `agent-trace-list:${s.ticketId}`;
    case "entity-folder":
      return `entity-folder:${s.entity}:${s.path}`;
    case "databases-list":
      return "databases-list";
    case "filestores-list":
      return "filestores-list";
    case "attachments-folder":
      return "attachments-folder";
    case "knowledge-bases-list":
      return "knowledge-bases-list";
    case "tools":
      return "tools";
    case "skills-station":
      return "skills-station";
    case "scripts-station":
      return "scripts-station";
    case "access-list":
      return "access-list";
    case "assets-list":
      return "assets-list";
    case "script-output":
      return `script-output:${s.script}`;
    case "draft-file":
      return `draft-file:${s.path}`;
  }
}

const NAV_HISTORY_CAP = 50;

function capStack(s: ViewerSource[]): ViewerSource[] {
  return s.length > NAV_HISTORY_CAP ? s.slice(s.length - NAV_HISTORY_CAP) : s;
}

export function Shell({
  repo,
  intakeUrl,
  dock,
  slackOrgId,
  stagedSlackBotToken,
  onStagedSlackBotTokenChange,
  registerManualPull,
}: {
  repo: string | null;
  /** Current intake server URL (or null if not yet started). Substituted
   *  into `{{INTAKE_URL}}` placeholders in markdown content (e.g. the
   *  welcome doc). */
  intakeUrl: string | null;
  /** Which secret-paste affordance the chat-anchored
   *  SkillActionDock should surface, if any. Driven by the
   *  `.openit/skill-state/connect-slack.json` side channel (read in
   *  App.tsx). The dock renders nothing when this is null/undefined.
   */
  dock: DockKind | undefined;
  /** orgId (or "" for local-only) — needed by
   *  SkillActionDock when it calls slack_connect (Keychain slot is
   *  scoped per org). */
  slackOrgId: string;
  /** xoxb- token staged in App-level state between the bot-token
   *  paste and the app-token paste. App.tsx owns the value so the
   *  paste flow survives the dock unmount/remount cycle that
   *  happens when Claude flips the dock kind between paste steps. */
  stagedSlackBotToken: string | null;
  /** Setter for the staged bot token. */
  onStagedSlackBotTokenChange: (t: string | null) => void;
  /** Register the manual-pull handler so the command palette can call it. */
  registerManualPull: (fn: () => void) => void;
}) {
  const [state, setState] = useState<AppPersistedState | null>(null);
  // Local sync-line log — used by SourceControl's commit flow and by the
  // push-from-marker watcher. Previously owned by App.tsx for cloud
  // sync; now purely local.
  const [syncLines, setSyncLines] = useState<string[]>([]);
  const onSyncLine = useCallback((line: string) => {
    setSyncLines((prev) => [...prev, line]);
  }, []);
  /// Single combined nav state for the center-pane viewer. Source +
  /// back/forward stacks live together so every transition is one
  /// pure `setNav` call — earlier split-state version had side-effect
  /// setState calls nested inside another setState updater, which
  /// React StrictMode (enabled in main.tsx) double-invoked, doubling
  /// every history push and corrupting the stacks. The combined state
  /// makes the updater pure: same input → same output, safe to invoke
  /// twice.
  const [nav, setNav] = useState<{
    source: ViewerSource;
    back: ViewerSource[];
    forward: ViewerSource[];
  }>({ source: null, back: [], forward: [] });
  const source = nav.source;
  const canGoBack = nav.back.length > 0;
  const canGoForward = nav.forward.length > 0;
  const setSource = useCallback(
    (next: ViewerSource | ((prev: ViewerSource) => ViewerSource)) => {
      setNav((prev) => {
        const resolved =
          typeof next === "function"
            ? (next as (p: ViewerSource) => ViewerSource)(prev.source)
            : next;
        if (sourceKey(prev.source) === sourceKey(resolved)) {
          // Same logical view — refresh in place, leave history alone.
          return { ...prev, source: resolved };
        }
        // Real navigation: push prev.source (if non-null) onto back,
        // clear forward.
        const nextBack =
          prev.source !== null ? capStack([...prev.back, prev.source]) : prev.back;
        return { source: resolved, back: nextBack, forward: [] };
      });
    },
    [],
  );
  const goBack = useCallback(() => {
    setNav((prev) => {
      if (prev.back.length === 0) return prev;
      const target = prev.back[prev.back.length - 1];
      const nextBack = prev.back.slice(0, -1);
      const nextForward =
        prev.source !== null
          ? capStack([...prev.forward, prev.source])
          : prev.forward;
      return { source: target, back: nextBack, forward: nextForward };
    });
  }, []);
  const goForward = useCallback(() => {
    setNav((prev) => {
      if (prev.forward.length === 0) return prev;
      const target = prev.forward[prev.forward.length - 1];
      const nextForward = prev.forward.slice(0, -1);
      const nextBack =
        prev.source !== null
          ? capStack([...prev.back, prev.source])
          : prev.back;
      return { source: target, back: nextBack, forward: nextForward };
    });
  }, []);
  const [fsTick, setFsTick] = useState(0);
  const [showFiles, setShowFiles] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [paneOrder, setPaneOrder] = useState<PaneId[]>(DEFAULT_PANE_ORDER);
  const [draggingPaneId, setDraggingPaneId] = useState<PaneId | null>(null);
  const [dragOverPaneId, setDragOverPaneId] = useState<PaneId | null>(null);
  const [chatSessionKey, setChatSessionKey] = useState(0);
  const [chatResume, setChatResume] = useState(false);
  const bumpFs = useCallback(() => setFsTick((t) => t + 1), []);

  /// Drag-source / drop-target wiring. The grip in each pane's header
  /// sets `draggingPaneId`; hovering another pane sets `dragOverPaneId`.
  /// On drop we splice the moving pane out of its slot and reinsert it
  /// at the target's slot. Position-aware: when dragging rightward we
  /// insert AFTER the target, when dragging leftward we insert BEFORE.
  /// This is the intuitive "drop the pane where I dropped it" behavior
  /// — without it, dragging chat from the leftmost slot onto the
  /// rightmost pane lands chat in the middle rather than the right
  /// (insert-before of the rightmost = middle), and dragging chat from
  /// the middle onto the rightmost is a no-op.
  const reorderPane = useCallback((movingId: PaneId, targetId: PaneId) => {
    if (movingId === targetId) return;
    setPaneOrder((prev) => {
      const movingIdx = prev.indexOf(movingId);
      const targetIdx = prev.indexOf(targetId);
      if (movingIdx < 0 || targetIdx < 0) return prev;
      const movingRightward = movingIdx < targetIdx;
      const without = prev.filter((id) => id !== movingId);
      const targetInWithout = without.indexOf(targetId);
      const insertAt = targetInWithout + (movingRightward ? 1 : 0);
      return [
        ...without.slice(0, insertAt),
        movingId,
        ...without.slice(insertAt),
      ];
    });
  }, []);

  const onPaneDragStart = useCallback(
    (paneId: PaneId, e: React.DragEvent) => {
      e.dataTransfer.setData("application/x-openit-pane", paneId);
      e.dataTransfer.effectAllowed = "move";
      setDraggingPaneId(paneId);
    },
    [],
  );

  const onPaneDragEnd = useCallback(() => {
    setDraggingPaneId(null);
    setDragOverPaneId(null);
  }, []);

  const onPaneDragOver = useCallback(
    (paneId: PaneId, e: React.DragEvent) => {
      // Only respond to our own MIME — won't interfere with the chat
      // pane's file-drop handlers which use x-openit-path / x-openit-ref.
      if (!e.dataTransfer.types.includes("application/x-openit-pane")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDragOverPaneId((prev) => (prev === paneId ? prev : paneId));
    },
    [],
  );

  const onPaneDragLeave = useCallback(
    (paneId: PaneId, e: React.DragEvent) => {
      // Filter child→child transitions (dragLeave fires on every
      // descendant boundary). Only clear when the drag is going to a
      // node OUTSIDE the current pane.
      const next = e.relatedTarget as Node | null;
      const current = e.currentTarget as Node;
      if (next && current.contains(next)) return;
      setDragOverPaneId((prev) => (prev === paneId ? null : prev));
    },
    [],
  );

  const onPaneDrop = useCallback(
    (paneId: PaneId, e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes("application/x-openit-pane")) return;
      e.preventDefault();
      const fromId = e.dataTransfer.getData(
        "application/x-openit-pane",
      ) as PaneId;
      if (fromId && fromId !== paneId) reorderPane(fromId, paneId);
      setDraggingPaneId(null);
      setDragOverPaneId(null);
    },
    [reorderPane],
  );

  const newChatSession = useCallback(() => {
    setChatResume(false);
    setChatSessionKey((k) => k + 1);
  }, []);

  const resumeChatSession = useCallback(() => {
    setChatResume(true);
    setChatSessionKey((k) => k + 1);
  }, []);

  // Manual pull is a no-op in local-only mode (no cloud to pull from).
  // Kept as a stub so the command palette registration doesn't break.
  const handleManualPull = useCallback(async () => {
    if (!repo || pulling) return;
    setPulling(true);
    onSyncLine("─── local mode: nothing to pull ───");
    bumpFs();
    setPulling(false);
  }, [repo, pulling, bumpFs, onSyncLine]);

  useEffect(() => {
    stateLoad().then(setState).catch(console.error);
  }, []);

  // Expose the manual-pull and tab-switch handlers up to App so the
  // command palette can call them. Re-register on every render so the
  // closure captures the current dependencies (cheap; React refs).
  useEffect(() => {
    registerManualPull(() => void handleManualPull());
  }, [registerManualPull, handleManualPull]);

  // Home button handler — flip back to the Workbench in the left pane.
  useEffect(() => {
    const onHome = () => setShowFiles(false);
    window.addEventListener("openit:show-home", onHome);
    return () => window.removeEventListener("openit:show-home", onHome);
  }, []);

  // Auto-open getting-started.md on first load — and re-open on demand
  // when the App-header "Getting Started" button dispatches the
  // `openit:open-welcome` custom event. Listening for the event here
  // (rather than plumbing a callback through props) keeps the
  // viewer-state ownership inside Shell.
  //
  // If the welcome is already the active source when the event fires,
  // we bump `welcomeFlashKey` instead of resolving again. The Viewer
  // observes this key and runs a brief yellow-flash animation, so the
  // user gets visual feedback that their click did something — without
  // it, clicking Getting Started while already on the welcome looked
  // like a no-op.
  const [welcomeFlashKey, setWelcomeFlashKey] = useState(0);
  useEffect(() => {
    if (!repo) return;
    const welcomePath = `${repo}/getting-started.md`;
    const openWelcome = () => {
      const onWelcome =
        source && source.kind === "file" && source.path === welcomePath;
      if (onWelcome) {
        setWelcomeFlashKey((k) => k + 1);
        return;
      }
      resolvePathToSource(welcomePath, repo)
        .then(setSource)
        .catch((e) => console.error("[shell] welcome resolution failed:", e));
    };
    window.addEventListener("openit:open-welcome", openWelcome);
    return () => {
      window.removeEventListener("openit:open-welcome", openWelcome);
    };
  }, [repo, source]);

  // Re-resolve conversation views when the filesystem changes. The
  // conversations-list reads ticket files for subject/status (so a
  // ticket status flip from "incoming" → "open" should refresh the
  // pill). The conversation-thread view reads each message file (so
  // a new turn from Claude should append to the bubbles). Both are
  // computed at click time in entityRouting; without this effect they
  // stay frozen at the snapshot.
  // Stash `source` in a ref so the fs-tick re-resolver below can read
  // the current value without subscribing to it. Without this, every
  // re-resolve produces a new source object, the effect's `source` dep
  // re-fires, the resolver kicks off again — an infinite loop that
  // also raced with click-driven setSource calls and made viewer
  // updates feel flaky ("opens/closes but doesn't always show").
  const sourceRef = useRef<ViewerSource>(source);
  useEffect(() => {
    sourceRef.current = source;
  }, [source]);

  useEffect(() => {
    if (!repo || fsTick === 0) return;
    const current = sourceRef.current;
    if (!current) return;
    const isConversation =
      current.kind === "conversations-list" ||
      current.kind === "conversation-thread";
    const isEntityFolder = current.kind === "entity-folder";
    const isDatabasesList = current.kind === "databases-list";
    const isFilestoresList = current.kind === "filestores-list";
    const isAttachmentsFolder = current.kind === "attachments-folder";
    const isKnowledgeBasesList = current.kind === "knowledge-bases-list";
    const isPeopleList = current.kind === "people-list";
    const isDatastoreTable = current.kind === "datastore-table";
    if (
      !isConversation &&
      !isEntityFolder &&
      !isDatabasesList &&
      !isFilestoresList &&
      !isAttachmentsFolder &&
      !isKnowledgeBasesList &&
      !isPeopleList &&
      !isDatastoreTable
    )
      return;
    const path =
      current.kind === "conversations-list"
        ? `${repo}/databases/conversations`
        : current.kind === "conversation-thread"
          ? `${repo}/databases/conversations/${current.ticketId}`
          : current.kind === "entity-folder"
            // Source carries an explicit `path` post-2026-04-27 splits
            // (KB collections + filestores/library); fall back to the
            // entity name for built-ins that still match 1:1 (agents,
            // workflows).
            ? `${repo}/${current.path}`
            : current.kind === "databases-list"
              ? `${repo}/databases`
              : current.kind === "filestores-list"
                ? `${repo}/filestores`
                : current.kind === "attachments-folder"
                  ? `${repo}/filestores/attachments`
                  : current.kind === "knowledge-bases-list"
                    ? `${repo}/knowledge-bases`
                    : current.kind === "people-list"
                      ? `${repo}/databases/people`
                      : current.kind === "datastore-table"
                        ? `${repo}/databases/${current.collection.name}`
                        : "";
    if (!path) return;
    let cancelled = false;
    resolvePathToSource(path, repo)
      .then((s) => {
        if (!cancelled) setSource(s);
      })
      .catch((e) => console.warn("[shell] re-resolve failed:", e));
    return () => {
      cancelled = true;
    };
  }, [fsTick, repo]);

  // Re-fetch the live agent trace whenever the fs watcher ticks. The
  // chat-intake server writes a partial trace file after each event
  // during the turn (see `LiveTracePersister` in `intake.rs`); this
  // effect pulls the latest snapshot in so the timeline animates
  // through the agent's actions instead of waiting for the turn to
  // finish.
  useEffect(() => {
    if (!repo || fsTick === 0) return;
    const current = sourceRef.current;
    if (!current || current.kind !== "agent-trace") return;
    const ticketId = current.ticketId;
    const subject = current.subject;
    let cancelled = false;
    agentTraceLatest(repo, ticketId)
      .then((doc) => {
        if (cancelled) return;
        // Only update if events actually changed — comparing
        // lengths is a cheap proxy that avoids re-rendering the
        // viewer for unrelated fs ticks (KB push, ticket status
        // flips, etc.) when the trace file itself hasn't grown.
        const currentLen = current.doc?.events.length ?? -1;
        const nextLen = doc?.events.length ?? -1;
        const outcomeChanged = (current.doc?.outcome ?? "") !== (doc?.outcome ?? "");
        if (currentLen === nextLen && !outcomeChanged) return;
        setSource({ kind: "agent-trace", ticketId, subject, doc });
      })
      .catch((e) => console.warn("[shell] agent-trace reload failed:", e));
    return () => {
      cancelled = true;
    };
  }, [fsTick, repo]);

  // Auto-open getting-started.md in the center pane on first load
  // so new users see the welcome guide immediately. The Workbench
  // overview stays in the left pane.
  useEffect(() => {
    if (repo && !source) {
      const welcomePath = `${repo}/getting-started.md`;
      resolvePathToSource(welcomePath, repo)
        .then(setSource)
        .catch((e) => console.error("[shell] welcome resolution failed:", e));
    }
  }, [repo]); // eslint-disable-line react-hooks/exhaustive-deps


  useEffect(() => {
    if (syncLines.length > 0) setSource({ kind: "sync", lines: syncLines });
  }, [syncLines]);

  // Native filesystem watcher — emits fsTick bumps on real changes,
  // and acts as the trigger for `.openit/push-request.json` (the file
  // `scripts/openit-plugin/sync-push.mjs` writes when Claude wants to
  // push). When it appears, run pushAllEntities and write
  // `.openit/push-result.json` so the script's poll loop can exit.
  useEffect(() => {
    if (!repo) return;
    let unlisten: (() => void) | null = null;

    const runPushFromMarker = async () => {
      // Module-level guard so concurrent listeners (transient
      // useEffect cleanup race) can't each kick off a separate push.
      if (pushInFlightByRepo.has(repo)) return;
      pushInFlightByRepo.add(repo);
      try {
        const requestPath = `${repo}/.openit/push-request.json`;

        // Confirm the marker actually exists.
        try {
          await fsRead(requestPath);
        } catch {
          return;
        }

        // We own this request. Delete the marker first so a watcher
        // event for the deletion itself doesn't loop us.
        try {
          await fsDelete(requestPath);
        } catch (e) {
          console.warn("[shell] failed to delete push-request:", e);
        }

        // Local-only mode: git has been removed. Just write a success
        // result file so the script's poll loop can exit.
        onSyncLine("─── push triggered by Claude (local-only, no-op) ───");
        onSyncLine("▸ git removed — nothing to commit");

        const payload = JSON.stringify(
          { status: "ok", lines: ["git removed — nothing to commit"], finishedAt: new Date().toISOString() },
          null,
          2,
        );
        try {
          await entityWriteFile(repo, ".openit", "push-result.json", payload);
        } catch (e) {
          console.error("[shell] failed to write push-result:", e);
        }
      } finally {
        pushInFlightByRepo.delete(repo);
      }
    };

    (async () => {
      try {
        await fsWatchStart(repo);
        unlisten = await onFsChanged((paths) => {
          bumpFs();
          // Look for the push-request marker in the change set. The
          // watcher is recursive over the repo root, so paths here are
          // absolute. Match either the absolute or repo-relative form.
          const marker = ".openit/push-request.json";
          const hit = paths.some(
            (p) => p.endsWith(`/${marker}`) || p.endsWith(marker),
          );
          if (hit) void runPushFromMarker();
        });
        // Auto-commit disabled in local-first mode — user controls
        // git explicitly in Phase 2 git mode. Files save to disk and
        // that's the sync gesture.
        // Mirror filestore-side skills + scripts into `.claude/` so
        // Claude Code's slash registry and Bash tool find them
        // natively. Source of truth stays in `filestores/`. (PIN-5829.)
        await startSkillMirrorDriver(repo);
      } catch (e) {
        console.warn("[shell] fs watcher failed to start:", e);
      }
    })();

    return () => {
      unlisten?.();
      void stopSkillMirrorDriver();
      fsWatchStop().catch(() => {});
    };
  }, [repo, bumpFs, onSyncLine]);

  if (!state) return <div className="shell-loading">Loading…</div>;

  return (
    <div className="shell">
      <ConflictBanner />
      <AgentActivityBanner
        repo={repo}
        fsTick={fsTick}
        onOpenTrace={async (ticketId, subject) => {
          if (!repo) return;
          try {
            const doc = await agentTraceLatest(repo, ticketId);
            // doc may be null when the click lands during the first
            // turn for a brand-new ticket (the trace file is written
            // only after the turn completes). Push the source anyway
            // — the viewer renders a "composing" placeholder and the
            // fs-watcher reload below swaps in the real doc once it
            // lands.
            setSource({ kind: "agent-trace", ticketId, subject, doc });
          } catch (e) {
            console.warn("[shell] agent-trace open failed:", e);
          }
        }}
      />
      <EscalatedTicketBanner
        repo={repo}
        fsTick={fsTick}
        onOpenPath={async (path) => {
          const resolved = await resolvePathToSource(path, repo);
          setSource(resolved);
        }}
      />
      {(() => {
        const paneClass = (id: PaneId) =>
          `${id === "left" ? "left-pane" : id === "center" ? "center-pane" : "right-pane"} ${
            draggingPaneId === id ? "pane-dragging" : ""
          } ${
            dragOverPaneId === id && draggingPaneId && draggingPaneId !== id
              ? "pane-drop-target"
              : ""
          }`;

        const paneContent: Record<PaneId, React.ReactNode> = {
          left: (
            <div
              className={paneClass("left")}
              onDragOver={(e) => onPaneDragOver("left", e)}
              onDragLeave={(e) => onPaneDragLeave("left", e)}
              onDrop={(e) => onPaneDrop("left", e)}
            >
              {showFiles ? (
                <FileExplorer
                  repo={repo}
                  onSelect={async (path) => {
                    const resolved = await resolvePathToSource(path, repo, {
                      rawTickets: true,
                    });
                    setSource(resolved);
                  }}
                  fsTick={fsTick}
                  onFsChange={bumpFs}
                  selectedPath={sourceToTreePath(source, repo)}
                  active={true}
                  onBack={() => setShowFiles(false)}
                />
              ) : (
                <Workbench
                  repo={repo}
                  fsTick={fsTick}
                  onOpen={async (path) => {
                    const resolved = await resolvePathToSource(path, repo);
                    setSource(resolved);
                  }}
                  onShowFiles={() => setShowFiles(true)}
                />
              )}
            </div>
          ),
          center: (
            <div
              className={paneClass("center")}
              onDragOver={(e) => onPaneDragOver("center", e)}
              onDragLeave={(e) => onPaneDragLeave("center", e)}
              onDrop={(e) => onPaneDrop("center", e)}
            >
              {/* Center pane has no drag handle — its only chrome
                  would be a stray strip floating in the cream gutter
                  above the viewer card. The left and right grips
                  reach all six permutations in ≤2 moves, so dropping
                  this is purely a visual cleanup. */}
              <Viewer
                source={source}
                repo={repo ?? ""}
                fsTick={fsTick}
                intakeUrl={intakeUrl}
                welcomeFlashKey={welcomeFlashKey}
                onOpenPath={async (path) => {
                  const resolved = await resolvePathToSource(path, repo);
                  setSource(resolved);
                }}
                onShowSource={(s) => setSource(s)}
                onGoBack={goBack}
                onGoForward={goForward}
                canGoBack={canGoBack}
                canGoForward={canGoForward}
              />
            </div>
          ),
          right: (
            <div
              className={paneClass("right")}
              onDragOver={(e) => onPaneDragOver("right", e)}
              onDragLeave={(e) => onPaneDragLeave("right", e)}
              onDrop={(e) => onPaneDrop("right", e)}
            >
              <ChatShellHeader
                onNewSession={newChatSession}
                onResumeSession={resumeChatSession}
                dragHandle={
                  <PaneDragHandle
                    paneId="right"
                    onDragStart={onPaneDragStart}
                    onDragEnd={onPaneDragEnd}
                  />
                }
              />
              <div className="chat-area">
                <ChatPane key={chatSessionKey} cwd={repo} resume={chatResume} />
              </div>
              <SkillActionDock
                dock={dock}
                repo={repo}
                orgId={slackOrgId}
                intakeUrl={intakeUrl}
                stagedBotToken={stagedSlackBotToken}
                onStagedBotTokenChange={onStagedSlackBotTokenChange}
              />
            </div>
          ),
        };

        // autoSaveId — react-resizable-panels persists pane sizes to
        // localStorage keyed by autoSaveId + Panel id. The id includes
        // the current paneOrder so that each unique ordering has its
        // own remembered layout. Without that scoping, a pane that
        // moves to a new slot would briefly inherit the previous
        // occupant's saved size on drop. With it, each ordering gets
        // its own clean key and no cross-bleed. End result: once the
        // user resizes a pane, the size sticks across page changes
        // AND across app restarts.
        const autoSaveId = `openit-shell-panes-${paneOrder.join("-")}`;
        return (
          // Wrapper enforces the panes-row geometry: takes all
          // available vertical space inside .shell, leaving room for
          // any banners above and the StatusBar below. Without
          // flex:1 the PanelGroup collapses in some cases when the
          // shell uses padded gutters.
          <div className="shell-panes-row">
            <PanelGroup direction="horizontal" autoSaveId={autoSaveId}>
              {paneOrder.map((id, idx) => (
                <Fragment key={id}>
                  <Panel
                    id={id}
                    order={idx}
                    defaultSize={PANE_DEFAULT[id]}
                    minSize={PANE_MIN[id]}
                  >
                    {paneContent[id]}
                  </Panel>
                  {idx < paneOrder.length - 1 && (
                    <PanelResizeHandle className="resize-handle" />
                  )}
                </Fragment>
              ))}
            </PanelGroup>
          </div>
        );
      })()}
    </div>
  );
}
