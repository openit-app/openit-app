import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatPane } from "./ChatPane";

/// Per-tab metadata. The PTY lives in the Rust process keyed by `id`;
/// React only persists `{id, label}` so labels survive across reloads
/// and the parent can re-mount panes with stable session ids.
///
/// Note: the PTY itself does NOT survive an app restart — Rust kills its
/// child processes when the Tauri process exits. On restart we rebuild
/// fresh PTYs under the saved ids, so the tab list and last-known labels
/// come back but each session is a new CC process. This matches the
/// success criteria: "restores the tab list and reconnects to running
/// sessions where possible (or cleanly shows them as new sessions if not)".
export interface ChatSessionMeta {
  id: string;
  /** User-visible tab label. Initialized to "Session N" and overwritten
   *  whenever CC emits a terminal title (auto-name + after `/rename`). */
  label: string;
  /** Whether this session should spawn with `--resume`. New sessions are
   *  fresh; restored-from-restart sessions stay fresh too — `--resume`
   *  is currently only set via the explicit Resume button. */
  resume: boolean;
}

/// localStorage key. Scoped per-repo so two vaults don't share tab lists.
function storageKey(cwd: string | null): string | null {
  if (!cwd) return null;
  return `openit:chat-tabs:${cwd}`;
}

export function loadTabs(cwd: string | null): ChatSessionMeta[] {
  const key = storageKey(cwd);
  if (!key) return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (t: unknown): t is ChatSessionMeta =>
          typeof t === "object" &&
          t !== null &&
          typeof (t as ChatSessionMeta).id === "string" &&
          typeof (t as ChatSessionMeta).label === "string",
      )
      .map((t) => ({ id: t.id, label: t.label, resume: false }));
  } catch (err) {
    console.warn("[ChatSessionTabs] failed to load persisted tabs:", err);
    return [];
  }
}

export function persistTabs(cwd: string | null, tabs: ChatSessionMeta[]): void {
  const key = storageKey(cwd);
  if (!key) return;
  try {
    // Drop `resume` from persistence: it's a one-shot spawn arg that
    // only applies on the next mount; persisting it would cause every
    // restart of a resumed tab to re-resume forever.
    const serializable = tabs.map((t) => ({ id: t.id, label: t.label }));
    localStorage.setItem(key, JSON.stringify(serializable));
  } catch (err) {
    console.warn("[ChatSessionTabs] failed to persist tabs:", err);
  }
}

export function newSessionId(): string {
  // Keep the `main-` prefix the rest of the app's tests/logs expect for
  // backwards compatibility with the single-pane era.
  return `main-${crypto.randomUUID()}`;
}

/// Derive the next "Session N" label, picking the smallest N not already
/// in use among labels that still match the default pattern. This keeps
/// numbering tight even after closes — closing Session 2 then opening
/// a new one reuses "Session 2" instead of jumping to "Session 4".
export function nextDefaultLabel(existing: ChatSessionMeta[]): string {
  const used = new Set<number>();
  for (const t of existing) {
    const m = /^Session (\d+)$/.exec(t.label);
    if (m) used.add(Number(m[1]));
  }
  let n = 1;
  while (used.has(n)) n++;
  return `Session ${n}`;
}

/// Build the initial tab state for a given cwd. Pure: no I/O beyond the
/// localStorage read (`loadTabs`), no UUID generation, no persistence
/// writes — those side effects move to a post-commit effect so render
/// stays safe under StrictMode double-invocation and concurrent rendering.
/// Returns `tabs: []` when the persisted set is empty; the seed effect
/// fills it once on commit.
function initTabState(cwd: string | null): {
  cwd: string | null;
  tabs: ChatSessionMeta[];
  activeId: string | null;
} {
  if (!cwd) {
    return { cwd, tabs: [], activeId: null };
  }
  const loaded = loadTabs(cwd);
  return {
    cwd,
    tabs: loaded,
    activeId: loaded[0]?.id ?? null,
  };
}

export interface ChatSessionTabsHandle {
  newSession: () => void;
  resumeSession: () => void;
}

export interface ChatSessionTabsProps {
  cwd: string | null;
  /** Imperative hook exposed so the existing ChatShellHeader buttons
   *  (and any future command-palette entries) can drive new/resume
   *  without lifting the tab state up to Shell.tsx. */
  registerHandle?: (h: ChatSessionTabsHandle | null) => void;
}

export function ChatSessionTabs({ cwd, registerHandle }: ChatSessionTabsProps) {
  // Track which cwd the current `tabs` state belongs to. When `cwd` changes,
  // we synchronously rebuild tabs during render (rather than waiting for a
  // post-render effect) so we never render ChatPanes whose session ids belong
  // to a different repo than the cwd we're handing them — that race would
  // spawn-and-immediately-kill claude PTYs in the wrong working directory.
  const [tabState, setTabState] = useState<{
    cwd: string | null;
    tabs: ChatSessionMeta[];
    activeId: string | null;
  }>(() => initTabState(cwd));

  // Sync rebuild on cwd change (mid-render is fine: same component, new
  // input). React batches the resulting setState into the current commit.
  if (cwd !== tabState.cwd) {
    setTabState(initTabState(cwd));
  }

  const { tabs, activeId } = tabState;

  const setTabs = useCallback(
    (updater: ChatSessionMeta[] | ((prev: ChatSessionMeta[]) => ChatSessionMeta[])) => {
      setTabState((prev) => {
        const nextTabs =
          typeof updater === "function"
            ? (updater as (p: ChatSessionMeta[]) => ChatSessionMeta[])(prev.tabs)
            : updater;
        return prev.tabs === nextTabs ? prev : { ...prev, tabs: nextTabs };
      });
    },
    [],
  );

  const setActiveId = useCallback(
    (updater: string | null | ((current: string | null) => string | null)) => {
      setTabState((prev) => {
        const nextId =
          typeof updater === "function"
            ? (updater as (c: string | null) => string | null)(prev.activeId)
            : updater;
        return prev.activeId === nextId ? prev : { ...prev, activeId: nextId };
      });
    },
    [],
  );

  // Seed effect: when a real cwd has no persisted tabs, mint a fresh
  // Session 1 here (in commit phase) rather than during render. Side
  // effects in initTabState (UUID generation, persistTabs write) would
  // misbehave under React's contract for pure render — StrictMode dev
  // double-invocation would mint two UUIDs and the rogue one would
  // leak into localStorage on the wrong tick. Doing it here keeps
  // render pure and idempotent.
  useEffect(() => {
    if (!cwd) return;
    if (tabs.length > 0) return;
    setTabState((prev) => {
      // Re-check under the latest state to avoid double-seed if two
      // commits race (e.g. cwd change immediately followed by a remount).
      if (prev.cwd !== cwd || prev.tabs.length > 0) return prev;
      const seed: ChatSessionMeta = {
        id: newSessionId(),
        label: "Session 1",
        resume: false,
      };
      return { cwd, tabs: [seed], activeId: seed.id };
    });
  }, [cwd, tabs.length]);

  // Persist on every change. Keep this effect-driven (rather than baked
  // into every setTabs call) so all mutation paths — add, close, rename
  // — automatically pick up persistence.
  useEffect(() => {
    if (!cwd) return;
    if (tabs.length === 0) return; // don't overwrite stored set with empty seed gap
    persistTabs(cwd, tabs);
  }, [cwd, tabs]);

  // addSession / closeSession update tabs and activeId atomically through
  // setTabState, so the activeId always references a live tab — no nested
  // setState updaters, no risk of an orphaned active id between the two
  // reductions.
  const addSession = useCallback((opts: { resume?: boolean } = {}) => {
    setTabState((prev) => {
      const next: ChatSessionMeta = {
        id: newSessionId(),
        label: nextDefaultLabel(prev.tabs),
        resume: !!opts.resume,
      };
      return { ...prev, tabs: [...prev.tabs, next], activeId: next.id };
    });
  }, []);

  const closeSession = useCallback((id: string) => {
    setTabState((prev) => {
      const idx = prev.tabs.findIndex((t) => t.id === id);
      if (idx === -1) return prev;
      const updated = prev.tabs.filter((t) => t.id !== id);
      // Guarantee at least one tab — closing the last tab spawns a
      // fresh Session 1 so the right pane is never empty.
      if (updated.length === 0) {
        const fresh: ChatSessionMeta = {
          id: newSessionId(),
          label: "Session 1",
          resume: false,
        };
        return { ...prev, tabs: [fresh], activeId: fresh.id };
      }
      const nextActive =
        prev.activeId === id ? updated[Math.max(0, idx - 1)].id : prev.activeId;
      return { ...prev, tabs: updated, activeId: nextActive };
    });
  }, []);

  const setLabel = useCallback((id: string, label: string) => {
    setTabs((prev) => {
      // Sanitize: trim, collapse whitespace, cap at 60 chars so the tab
      // strip can't be blown out by a stray multi-line title.
      const cleaned = label.replace(/\s+/g, " ").trim().slice(0, 60);
      if (!cleaned) return prev;
      let changed = false;
      const next = prev.map((t) => {
        if (t.id !== id) return t;
        if (t.label === cleaned) return t;
        changed = true;
        return { ...t, label: cleaned };
      });
      return changed ? next : prev;
    });
  }, []);

  // Imperative API for the legacy ChatShellHeader "+" / "↺" buttons.
  // Kept as a registered handle (instead of lifting full state up) so
  // ChatSessionTabs owns its own internal state and Shell.tsx just gets
  // a handle to call.
  const newSession = useCallback(() => addSession({ resume: false }), [addSession]);
  const resumeSession = useCallback(() => addSession({ resume: true }), [addSession]);

  const handleRef = useRef<ChatSessionTabsHandle>({ newSession, resumeSession });
  useEffect(() => {
    handleRef.current = { newSession, resumeSession };
  }, [newSession, resumeSession]);

  useEffect(() => {
    if (!registerHandle) return;
    registerHandle(handleRef.current);
    return () => registerHandle(null);
  }, [registerHandle]);

  // Cmd+1..9 / Ctrl+1..9 to switch tabs. Hooked at document level so
  // the shortcut works even when focus is inside xterm (which swallows
  // most keys for the running TUI).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.altKey || e.shiftKey) return;
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1 || n > 9) return;
      // Skip when focus is in an editable control so the shortcut doesn't
      // hijack Cmd+1 in a rename input, the command palette, etc. The
      // terminal pane uses xterm's hidden textarea (which IS contentEditable
      // via inputmode), but we want the shortcut to work there — so check
      // for the chat-area ancestor as an explicit pass-through.
      const t = e.target as (HTMLElement & { closest?: HTMLElement["closest"] }) | null;
      // `closest` is only on Element — when the event target is window
      // (e.g. dispatched programmatically) we skip the editable guard
      // entirely; nothing's focused so the shortcut should fire.
      if (t && typeof t.closest === "function") {
        const tag = t.tagName;
        const editable =
          (tag === "INPUT" && (t as HTMLInputElement).type !== "checkbox" && (t as HTMLInputElement).type !== "radio") ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          t.isContentEditable;
        const inChat = t.closest(".chat-area") !== null;
        if (editable && !inChat) return;
      }
      const target = tabs[n - 1];
      if (!target) return;
      e.preventDefault();
      // Stop propagation so xterm's keydown handler (registered on the
      // terminal element via term.attachCustomKeyEventHandler) never sees
      // the digit and never forwards it as input to the running CC PTY.
      e.stopPropagation();
      setActiveId(target.id);
    };
    // Capture phase so xterm's own keydown listener never gets a chance
    // to forward the digit into the running CC process. Without capture,
    // pressing Cmd+1 while tab 2's xterm is focused fires the switch AND
    // pipes a stray '1' into tab 2's prompt before we tear down. The
    // editable-target guard above keeps the shortcut from hijacking a
    // focused input/textarea/contenteditable elsewhere in the app.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [tabs, setActiveId]);

  const onTitleChangeFor = useMemo(() => {
    // Stable per-id callbacks so panes don't see a new callback identity
    // every render (the ref inside ChatPane reads through, but this also
    // keeps React DevTools and any future memo boundaries clean).
    const cache: Record<string, (title: string) => void> = {};
    for (const t of tabs) {
      cache[t.id] = (title: string) => setLabel(t.id, title);
    }
    return cache;
  }, [tabs, setLabel]);

  // When there's no repo yet, render the empty-state ChatPane (it shows
  // the "Open a project folder" placeholder) without any tab chrome.
  if (!cwd) {
    return <ChatPane cwd={null} />;
  }

  return (
    <>
      <div className="chat-tabs-strip" role="tablist" aria-label="Claude sessions">
        {tabs.map((t) => {
          const active = t.id === activeId;
          return (
            // The tab itself MUST carry role="tab" + aria-selected and be
            // the focusable element — per WAI-ARIA, putting role="tab" on a
            // non-focusable wrapper breaks screen-reader tablist navigation
            // (VoiceOver/NVDA arrow-key model). The close button sits next
            // to the tab (not nested inside it) for the same reason.
            <span
              key={t.id}
              className={`chat-tab${active ? " chat-tab-active" : ""}`}
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                className="chat-tab-label"
                onClick={() => setActiveId(t.id)}
                title={t.label}
              >
                {t.label}
              </button>
              {tabs.length > 1 && (
                <button
                  type="button"
                  className="chat-tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeSession(t.id);
                  }}
                  title="Close session"
                  aria-label={`Close ${t.label}`}
                >
                  ×
                </button>
              )}
            </span>
          );
        })}
        <button
          type="button"
          className="chat-tab-add"
          onClick={() => addSession()}
          title="New Claude session"
          aria-label="New Claude session"
        >
          +
        </button>
      </div>
      <div className="chat-area">
        {tabs.map((t) => (
          <ChatPane
            key={t.id}
            cwd={cwd}
            sessionId={t.id}
            visible={t.id === activeId}
            resume={t.resume}
            onTitleChange={onTitleChangeFor[t.id]}
          />
        ))}
      </div>
    </>
  );
}
