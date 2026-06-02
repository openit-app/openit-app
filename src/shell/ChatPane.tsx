import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { readText as readClipboardText } from "@tauri-apps/plugin-clipboard-manager";
import { onPtyData, onPtyExit, ptyKill, ptyResize, ptySpawn, ptyWrite } from "../lib/terminal";
import { setActiveSession, clearActiveSession } from "./activeSession";
import "@xterm/xterm/css/xterm.css";

// macOS Terminal.app behavior: dragging a file in writes its shell-escaped path.
function shellEscape(p: string): string {
  return `'${p.replace(/'/g, "'\\''")}'`;
}

/** Max file size we'll shuttle through IPC (bytes are JSON-serialised as a
 *  number array — same pattern as entity_write_file_bytes in api.ts). Files
 *  above this limit are skipped with a warning to avoid freezing the UI. */
const DROP_SIZE_LIMIT = 25 * 1024 * 1024; // 25 MB

/** Platform clipboard modifier: Cmd on macOS, Ctrl everywhere else. Drives
 *  the copy/paste shortcuts so they match each OS's convention — and so
 *  Ctrl+C stays "interrupt" on macOS (Cmd+C is copy there). */
const IS_MAC = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);

/** Copy the terminal's current selection to the system clipboard. No-op when
 *  nothing is selected. */
function copySelectionToClipboard(term: Terminal) {
  const selection = term.getSelection();
  if (!selection) return;
  navigator.clipboard
    .writeText(selection)
    .catch((err) => console.warn("clipboard copy failed:", err));
}

/** Paste the system clipboard into the PTY.
 *
 *  A clipboard image is saved to a temp file and its path is written to the
 *  terminal — the same flow as a file drop, so Claude Code attaches the image
 *  (xterm/terminals have no native concept of an image paste). Otherwise the
 *  clipboard text is pasted through `term.paste`, which adds bracketed-paste
 *  markers when Claude Code has the mode enabled.
 *
 *  We drive this ourselves on every platform because WebView2 on Windows
 *  never wires xterm's default copy/paste up to the OS clipboard reliably. */
async function pasteClipboardIntoPty(term: Terminal, sessionId: string) {
  // Text first, read NATIVELY via Tauri. `navigator.clipboard.readText()`
  // (and `.read()`) trigger macOS's webview "Paste" consent callout — the
  // little bubble the user must click — which made paste feel broken. The
  // native clipboard plugin reads without any prompt, so a plain text paste
  // (the common case) just works.
  try {
    const text = await readClipboardText();
    if (text) {
      term.paste(text);
      return;
    }
  } catch (err) {
    console.warn("native clipboard text read failed:", err);
  }

  // No text → maybe a copied image (screenshot). This path uses the webview
  // clipboard API and may still show the consent prompt, but it's only
  // reached for the rarer image paste, where a one-time allow is tolerable.
  if (navigator.clipboard?.read) {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((t) => t.startsWith("image/"));
        if (!imageType) continue;
        const blob = await item.getType(imageType);
        if (blob.size > DROP_SIZE_LIMIT) {
          console.warn(
            `clipboard image too large (${(blob.size / 1e6).toFixed(1)} MB), skipping`,
          );
          return;
        }
        const buf = await blob.arrayBuffer();
        const ext = imageType.split("/")[1] ?? "png";
        const savedPath = await invoke<string>("save_dropped_file", {
          name: `clipboard-${Date.now()}.${ext}`,
          bytes: Array.from(new Uint8Array(buf)),
        });
        await ptyWrite(sessionId, shellEscape(savedPath) + " ");
        return;
      }
    } catch (err) {
      // read() rejects when the clipboard holds no readable item or the
      // webview denies access. Text was already handled natively above, so
      // there's nothing left to fall back to.
      console.warn("clipboard image read failed:", err);
    }
  }
}

/** Save OS-dropped files to a temp dir and paste the paths into the PTY. */
async function saveAndPasteDroppedFiles(files: FileList, sessionId: string) {
  for (const file of Array.from(files)) {
    if (file.size > DROP_SIZE_LIMIT) {
      console.warn(`dropped file too large (${(file.size / 1e6).toFixed(1)} MB), skipping:`, file.name);
      continue;
    }
    try {
      const buf = await file.arrayBuffer();
      const savedPath = await invoke<string>("save_dropped_file", {
        name: file.name,
        bytes: Array.from(new Uint8Array(buf)),
      });
      await ptyWrite(sessionId, shellEscape(savedPath) + " ");
    } catch (err) {
      console.error("dropped-file save failed:", err);
    }
  }
}

export interface ChatPaneProps {
  cwd: string | null;
  /** Stable PTY/session identifier. When supplied by a parent (e.g.
   *  ChatSessionTabs) the parent controls the session lifetime and the
   *  pane sticks to that id across re-renders. When omitted, the pane
   *  auto-generates `main-<uuid>` for the single-session legacy path. */
  sessionId?: string;
  /** Whether this pane is the currently-visible tab. Inactive panes stay
   *  mounted (display:none) so PTY state and xterm scrollback survive
   *  tab switches, but only the visible one is registered as the
   *  paste/skill target via setActiveSession. */
  visible?: boolean;
  resume?: boolean;
  /** Fires whenever the embedded program emits an OSC 0/2 title change
   *  (Claude Code does this on auto-name and after `/rename`). Used by
   *  ChatSessionTabs to mirror the CC session name into the tab label. */
  onTitleChange?: (title: string) => void;
}

export function ChatPane({
  cwd,
  sessionId,
  visible = true,
  resume,
  onTitleChange,
}: ChatPaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Keep the latest onTitleChange in a ref so the spawn effect — which we
  // intentionally don't re-run on every render — always calls the freshest
  // callback without re-spawning the PTY.
  const titleCbRef = useRef<typeof onTitleChange>(onTitleChange);
  useEffect(() => {
    titleCbRef.current = onTitleChange;
  }, [onTitleChange]);
  // Mirror `visible` into a ref so the async ptySpawn IIFE checks the LIVE
  // value when it completes, not the value captured at effect-creation time.
  // Without this, a fast user (create tab → immediately switch back to the
  // previous tab while the new pty is still spawning) sees the post-spawn
  // `setActiveSession` overwrite the now-correct active id with the hidden
  // tab's id, redirecting subsequent paste/skill-action writes to the wrong
  // pane.
  const visibleRef = useRef(visible);
  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);

  // Re-fit + refocus when this tab becomes visible. Hidden panes don't get
  // ResizeObserver/window resize events that match their actual geometry,
  // so on first reveal we explicitly nudge xterm.
  const fitRef = useRef<FitAddon | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const stableSessionIdRef = useRef<string | null>(null);
  // First time this pane becomes visible we just fit + focus; on
  // subsequent re-reveals we also wipe stale glyphs and ask CC to
  // repaint (its delta-painter sometimes leaves orphan rows when its
  // UI shifts while the pane was hidden).
  const everVisibleRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current) return;
    if (!cwd) return; // Don't spawn until we have a project folder
    const SESSION_ID = sessionId ?? `main-${crypto.randomUUID()}`;
    stableSessionIdRef.current = SESSION_ID;

    const term = new Terminal({
      fontFamily:
        "'MesloLGS NF', 'JetBrainsMono Nerd Font Mono', 'JetBrainsMono Nerd Font', 'Hack Nerd Font Mono', 'Hack Nerd Font', 'Symbols Nerd Font Mono', Menlo, Monaco, 'SF Mono', monospace",
      fontSize: 13,
      cursorBlink: true,
      scrollback: 10000,
      // OSC 8 hyperlink handler. Claude Code emits OSC 8 escape
      // sequences for URLs in its output (the "rich" terminal
      // hyperlink protocol — separate from the regex-based plain
      // URL detection that WebLinksAddon handles below). Without
      // overriding this, xterm's default handler calls
      // `window.open`, which the Tauri webview blocks ("Opening
      // link blocked as opener could not be cleared") and then
      // falls through to `window.confirm`, which is also blocked
      // ("dialog.confirm not allowed"). Routing through Tauri's
      // openUrl plugin opens the link in the user's default
      // browser like every other openUrl call in the app.
      linkHandler: {
        activate(_event: MouseEvent, uri: string) {
          openUrl(uri).catch((e) => console.warn("openUrl failed:", e));
        },
        hover() {},
        leave() {},
      },
      // Colorblind-friendly palette on cream `#faf9f6`. The earlier
      // attempt kept yellows for Claude's tool-block headers, but
      // they wash out for colorblind users (deuteranopia/protanopia
      // confuses gold with neutral on a warm background). Strategy:
      // collapse most ANSI slots to near-foreground darks so the
      // chat reads as "dark text on tan" by default, with only
      // semantically-meaningful hues (red for removed/errors, green
      // for added/success) carrying real color — and even those use
      // distinct lightness too, so they're separable without hue
      // alone. Each value targets ≥7:1 contrast on cream.
      theme: {
        // Dark theatre — the right pane lives in a warm-black room
        // so Claude reads as a different surface from the cream
        // workbench. Foreground is warm cream so text stays familiar.
        background: "#1a140e",
        foreground: "#f0e7d3",
        cursor: "#e8804a",
        selectionBackground: "rgba(199, 90, 44, 0.32)",
        black: "#1a140e",
        red: "#e07a6a",
        green: "#a8c89e",
        yellow: "#d4b878",
        blue: "#9aa8e0",
        magenta: "#c89ac0",
        cyan: "#9ac8c0",
        white: "#d8cdb5",
        brightBlack: "#544a3a",
        brightRed: "#f0907e",
        brightGreen: "#b8d8ae",
        brightYellow: "#e0c888",
        brightBlue: "#aab8f0",
        brightMagenta: "#d8aad0",
        brightCyan: "#aad8d0",
        brightWhite: "#fff8ec",
      },
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    fitRef.current = fit;
    termRef.current = term;
    // Web-links addon: detects http(s):// URLs in terminal output
    // and makes them clickable. Routed through Tauri's openUrl so
    // links open in the user's default browser, not inside the
    // webview. The addon's built-in activation already requires
    // cmd-click on macOS (ctrl-click elsewhere), so we don't need
    // a custom modifier check — passing one was actually breaking
    // activation in the Tauri webview.
    term.loadAddon(
      new WebLinksAddon((_event, uri) => {
        openUrl(uri).catch((e) => console.warn("openUrl failed:", e));
      }),
    );
    term.open(containerRef.current);
    // Initial fit can measure zero if the parent flex layout hasn't
    // settled when this effect runs — notably for the SECOND tab,
    // whose wrapper div is freshly mounted under .chat-area in the
    // same commit that flips tab 1 to display:none. A degenerate fit
    // would ship cols=1/rows=1 to the PTY spawn, leaving Claude
    // rendering into a 1×1 terminal that never paints anything. Try
    // once now; if degenerate, retry on rAF so the next attempt sees
    // real geometry. The PTY's actual cols/rows are read from `term`
    // right before the ptySpawn call below.
    try {
      fit.fit();
    } catch (e) {
      console.warn("[CC-SPAWN] initial fit threw:", e);
    }
    if (term.cols <= 1 || term.rows <= 1) {
      console.warn("[CC-SPAWN] initial fit degenerate, retrying on rAF", {
        sessionId: SESSION_ID,
        cols: term.cols,
        rows: term.rows,
      });
      requestAnimationFrame(() => {
        try {
          fit.fit();
        } catch (e) {
          console.warn("[CC-SPAWN] retry fit threw:", e);
        }
      });
    }
    if (visible) term.focus();
    const focusOnClick = () => term.focus();
    containerRef.current.addEventListener("click", focusOnClick);

    // Right-click: copy when there's a selection, otherwise paste — the
    // console/Windows-Terminal convention Windows users reach for.
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      if (term.hasSelection()) {
        copySelectionToClipboard(term);
        term.clearSelection();
      } else {
        void pasteClipboardIntoPty(term, SESSION_ID);
      }
    };
    containerRef.current.addEventListener("contextmenu", onContextMenu);

    // Mirror CC's session name into the tab label. CC sets the
    // terminal title via OSC 0/2 when it auto-names a session and
    // again after `/rename`. xterm's onTitleChange fires for both.
    const titleDisposable = term.onTitleChange((newTitle) => {
      const cb = titleCbRef.current;
      if (cb) cb(newTitle);
    });

    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;

      // Shift+Enter → \x1b\r (ESC + CR), the sequence Claude Code's
      // `/terminal-setup` configures iTerm2 to send. CC's input parser
      // treats this as newline-insert; bare \r is submit.
      if (
        e.key === "Enter" &&
        e.shiftKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        e.preventDefault();
        e.stopPropagation();
        ptyWrite(SESSION_ID, "\x1b\r").catch((err) => console.error("pty bridge error:", err));
        return false;
      }

      // Clipboard. xterm's defaults don't reach the OS clipboard reliably
      // in the Tauri webview (especially WebView2 on Windows), and image
      // paste isn't a terminal concept at all — so we handle copy/paste
      // ourselves for one consistent behaviour on every platform.
      //
      // `clip` is the OS clipboard chord: Cmd on macOS, Ctrl elsewhere,
      // with the other modifier excluded. On macOS this leaves Ctrl+C as
      // "interrupt" (Cmd+C copies); on Windows/Linux Ctrl+C copies only
      // when there's a selection (otherwise it interrupts — see below).
      const key = e.key.toLowerCase();
      const clip = IS_MAC
        ? e.metaKey && !e.ctrlKey && !e.altKey
        : e.ctrlKey && !e.metaKey && !e.altKey;

      // Copy: clip+Shift+C always; bare clip+C only when text is selected
      // (a Ctrl+C with no selection must still interrupt Claude Code).
      if (clip && key === "c" && (e.shiftKey || term.hasSelection())) {
        copySelectionToClipboard(term);
        e.preventDefault();
        return false;
      }

      // Paste: clip+V / clip+Shift+V, or Alt+V (matches Claude Code's own
      // Windows/WSL image-paste binding, so muscle memory carries over).
      // On macOS we ALSO accept Ctrl+V — Cmd+V is the native chord, but
      // many users reach for Ctrl+V out of habit, and it has no conflicting
      // terminal meaning here. (Copy stays Cmd-only so Ctrl+C still
      // interrupts.)
      const isPaste =
        (clip && key === "v") ||
        (e.altKey && !e.ctrlKey && !e.metaKey && key === "v") ||
        (IS_MAC && e.ctrlKey && !e.metaKey && !e.altKey && key === "v");
      if (isPaste) {
        e.preventDefault();
        void pasteClipboardIntoPty(term, SESSION_ID);
        return false;
      }

      return true;
    });

    // Drag-drop: accept in-app drags (file explorer, entity refs) AND OS
    // file drops (Finder / Desktop). We keep `dragDropEnabled: false` in
    // tauri.conf.json because Tauri's native drag-drop handler is mutually
    // exclusive with DOM drag events — enabling it breaks all in-page drags.
    // Instead, OS file drops go through the DOM: the `Files` type gives us
    // File objects, we save the bytes to a temp dir via a Tauri command,
    // and paste the resulting path into the terminal.
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("application/x-openit-path") ||
          e.dataTransfer?.types.includes("application/x-openit-ref") ||
          e.dataTransfer?.types.includes("Files")) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }
    };
    const onInPageDrop = (e: DragEvent) => {
      // preventDefault MUST run before any early return — without it
      // the Tauri webview navigates to the file URL and unloads the SPA.
      e.preventDefault();
      // Entity reference drop (databases, agents, workflows, rows)
      const ref = e.dataTransfer?.getData("application/x-openit-ref");
      if (ref) {
        ptyWrite(SESSION_ID, ref + " ").catch((err) => console.error("pty bridge error:", err));
        return;
      }
      // In-app file path drop (from the file explorer)
      const path = e.dataTransfer?.getData("application/x-openit-path");
      if (path) {
        const text = shellEscape(path) + " ";
        ptyWrite(SESSION_ID, text).catch((err) => console.error("pty bridge error:", err));
        return;
      }
      // OS file drop from Finder — save to temp and paste the path.
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        saveAndPasteDroppedFiles(files, SESSION_ID);
      }
    };
    containerRef.current.addEventListener("dragover", onDragOver, true);
    containerRef.current.addEventListener("drop", onInPageDrop, true);

    const unlistens: Array<() => void> = [];
    let disposed = false;

    (async () => {
      // CRITICAL: subscribe to pty://data and pty://exit BEFORE the
      // ptySpawn call. Tauri events are not buffered — anything
      // emitted before a listener is attached is silently dropped.
      // The Rust reader thread starts streaming bytes the moment
      // `pty_spawn` returns (often before the awaited invoke even
      // resolves on the JS side), so registering listeners AFTER the
      // spawn race-drops Claude's startup banner. Tab 1 used to get
      // lucky because its mount happens during slow app-boot work;
      // tab 2 is created on a "+" click when the rest of the UI is
      // hot, and the JS event-loop slice between spawn-return and
      // listen-register is short enough that we lose the banner. The
      // user sees a blinking xterm cursor with no output, and nothing
      // ever arrives because Claude's TUI only repaints in response
      // to input it never received.
      //
      // Subscribing first is safe: both listeners filter on
      // payload.session_id, so they're inert until OUR PTY (which
      // doesn't exist yet) starts emitting. If ptySpawn fails we
      // unwire them in the catch.
      console.warn("[CC-SPAWN] subscribing pty listeners", { sessionId: SESSION_ID });
      const unlistenData = await onPtyData(SESSION_ID, (chunk) => term.write(chunk));
      const unlistenExit = await onPtyExit(SESSION_ID, (code) => {
        term.writeln(`\r\n\x1b[33m[process exited${code != null ? `: ${code}` : ""}]\x1b[0m`);
      });
      if (disposed) {
        unlistenData();
        unlistenExit();
        return;
      }
      unlistens.push(unlistenData, unlistenExit);

      const { cols, rows } = term;
      console.warn("[CC-SPAWN] invoking ptySpawn", {
        sessionId: SESSION_ID,
        cwd,
        cols,
        rows,
        resume: !!resume,
      });
      try {
        await ptySpawn({
          sessionId: SESSION_ID,
          cols,
          rows,
          cwd,
          args: resume ? ["--resume"] : [],
        });
      } catch (e) {
        console.error("[CC-SPAWN] ptySpawn failed", { sessionId: SESSION_ID, error: e });
        // Unwire the listeners we registered above and drop them
        // from the cleanup list so we don't double-unwire on unmount.
        unlistenData();
        unlistenExit();
        const idxData = unlistens.indexOf(unlistenData);
        if (idxData !== -1) unlistens.splice(idxData, 1);
        const idxExit = unlistens.indexOf(unlistenExit);
        if (idxExit !== -1) unlistens.splice(idxExit, 1);
        term.writeln(`\x1b[31mfailed to spawn pty: ${String(e)}\x1b[0m`);
        return;
      }
      if (disposed) {
        ptyKill(SESSION_ID).catch(() => {});
        return;
      }
      console.warn("[CC-SPAWN] spawn complete", { sessionId: SESSION_ID });

      // Read through the ref so a tab-switch that happened during the
      // ptySpawn await is honored — without this we'd clobber the active
      // session pointer with this (now-hidden) tab's id.
      if (visibleRef.current) setActiveSession(SESSION_ID);

      term.onData((data) => {
        ptyWrite(SESSION_ID, data).catch((e) => console.error("pty bridge error:", e));
      });

      // Resize: rAF-throttled fit during drag (so xterm reflows visually
      // without spamming the PTY), debounced trailing ptyResize that
      // fires once geometry settles and only when cols/rows actually
      // changed (Zed's set_size dedup pattern, terminal.rs:1454-1466).
      const SETTLE_MS = 80;
      let rafScheduled = false;
      let settleTimer: ReturnType<typeof setTimeout> | null = null;
      let lastCols = term.cols;
      let lastRows = term.rows;

      const safeFit = () => {
        try {
          fit.fit();
        } catch (e) {
          console.warn("fit.fit failed (probably zero-size pane):", e);
        }
      };

      const settle = () => {
        if (disposed || !visibleRef.current) return;
        safeFit();
        if (term.cols === lastCols && term.rows === lastRows) return;
        if (term.cols <= 1 || term.rows <= 1) return;
        lastCols = term.cols;
        lastRows = term.rows;
        ptyResize(SESSION_ID, term.cols, term.rows).catch((e) =>
          console.error("pty bridge error:", e),
        );
        // Clear viewport (not scrollback) so CC's next paint lands on a
        // blank canvas — its delta-painter leaves stale glyphs otherwise.
        term.write("\x1b[2J\x1b[H");
      };

      const onResize = () => {
        if (disposed || !visibleRef.current) return;
        if (!rafScheduled) {
          rafScheduled = true;
          requestAnimationFrame(() => {
            rafScheduled = false;
            if (disposed || !visibleRef.current) return;
            safeFit();
          });
        }
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = setTimeout(settle, SETTLE_MS);
      };

      window.addEventListener("resize", onResize);
      unlistens.push(() => window.removeEventListener("resize", onResize));

      // Catch pane-splitter drags — those don't fire window 'resize'.
      const observer = new ResizeObserver(() => onResize());
      if (containerRef.current) observer.observe(containerRef.current);
      unlistens.push(() => {
        observer.disconnect();
        if (settleTimer) {
          clearTimeout(settleTimer);
          settleTimer = null;
        }
      });
    })();

    return () => {
      disposed = true;
      clearActiveSession(SESSION_ID);
      titleDisposable.dispose();
      containerRef.current?.removeEventListener("click", focusOnClick);
      containerRef.current?.removeEventListener("contextmenu", onContextMenu);
      containerRef.current?.removeEventListener("dragover", onDragOver, true);
      containerRef.current?.removeEventListener("drop", onInPageDrop, true);
      for (const fn of unlistens) fn();
      ptyKill(SESSION_ID).catch((e) => console.error("pty bridge error:", e));
      term.dispose();
      fitRef.current = null;
      termRef.current = null;
      stableSessionIdRef.current = null;
    };
    // We intentionally exclude `visible` and `onTitleChange` from this
    // effect's deps: switching tabs or swapping the title callback must
    // NEVER tear down and re-spawn the PTY (that would kill the running
    // process and wipe scrollback). Visibility changes are handled by
    // the separate effect below; title-callback changes are read through
    // titleCbRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd, sessionId, resume]);

  // Visibility transitions: when this pane becomes the active tab, hand
  // it the global active-session pointer (so paste/skill-action writes
  // land here), refit (its container just gained real dimensions), and
  // refocus. When it loses visibility, release the pointer if we still
  // hold it.
  useEffect(() => {
    const id = stableSessionIdRef.current;
    if (!id) return;
    if (visible) {
      setActiveSession(id);
      const isReReveal = everVisibleRef.current;
      everVisibleRef.current = true;
      // Defer the fit until after the parent's display:none toggle has
      // actually painted — otherwise xterm measures zero and clamps to
      // 1 column. requestAnimationFrame is enough since the toggle is
      // a synchronous style change.
      //
      // CRITICAL: cancel the pending frame on cleanup. Without this, a
      // rapid visible=true → visible=false transition (user clicks a
      // tab then immediately clicks another within one frame) leaves a
      // queued rAF that fires AFTER the cleanup ran, stealing focus
      // back to a now-hidden pane and yanking the cursor away from the
      // tab the user actually selected.
      const handle = requestAnimationFrame(() => {
        fitRef.current?.fit();
        termRef.current?.focus();
        if (isReReveal) {
          // Wipe viewport (preserve scrollback) and send Ctrl+L so CC
          // does a full repaint rather than leaving orphan glyphs from
          // its prior layout.
          termRef.current?.write("\x1b[2J\x1b[H");
          ptyWrite(id, "\x0c").catch(() => {});
        }
      });
      return () => cancelAnimationFrame(handle);
    }
    clearActiveSession(id);
    return undefined;
  }, [visible]);

  if (!cwd) {
    return (
      <div className="chat-empty">
        Open a project folder to start a Claude Code session.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        display: visible ? "block" : "none",
      }}
    />
  );
}
