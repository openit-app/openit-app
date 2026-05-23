import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
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
    fit.fit();
    if (visible) term.focus();
    const focusOnClick = () => term.focus();
    containerRef.current.addEventListener("click", focusOnClick);

    // Mirror CC's session name into the tab label. CC sets the
    // terminal title via OSC 0/2 when it auto-names a session and
    // again after `/rename`. xterm's onTitleChange fires for both.
    const titleDisposable = term.onTitleChange((newTitle) => {
      const cb = titleCbRef.current;
      if (cb) cb(newTitle);
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
      const { cols, rows } = term;
      try {
        await ptySpawn({
          sessionId: SESSION_ID,
          cols,
          rows,
          cwd,
          args: resume ? ["--resume"] : [],
        });
      } catch (e) {
        term.writeln(`\x1b[31mfailed to spawn pty: ${String(e)}\x1b[0m`);
        return;
      }
      if (disposed) {
        ptyKill(SESSION_ID).catch(() => {});
        return;
      }

      // Read through the ref so a tab-switch that happened during the
      // ptySpawn await is honored — without this we'd clobber the active
      // session pointer with this (now-hidden) tab's id.
      if (visibleRef.current) setActiveSession(SESSION_ID);

      const unlistenData = await onPtyData(SESSION_ID, (chunk) => term.write(chunk));
      const unlistenExit = await onPtyExit(SESSION_ID, (code) => {
        term.writeln(`\r\n\x1b[33m[process exited${code != null ? `: ${code}` : ""}]\x1b[0m`);
      });
      if (disposed) {
        unlistenData();
        unlistenExit();
        ptyKill(SESSION_ID).catch(() => {});
        return;
      }
      unlistens.push(unlistenData, unlistenExit);

      term.onData((data) => {
        ptyWrite(SESSION_ID, data).catch((e) => console.error("pty bridge error:", e));
      });

      const onResize = () => {
        if (disposed) return;
        fit.fit();
        ptyResize(SESSION_ID, term.cols, term.rows).catch((e) =>
          console.error("pty bridge error:", e),
        );
        // Force xterm to repaint the visible buffer at the new width.
        // Without this, lines that streamed in at the previous column
        // count keep their original wrap points — so resizing the
        // pane mid-stream leaves a half-broken display until the user
        // hits Ctrl-L. New content wraps fine on its own; this only
        // matters for already-rendered scrollback.
        term.refresh(0, term.rows - 1);
      };
      window.addEventListener("resize", onResize);
      unlistens.push(() => window.removeEventListener("resize", onResize));

      // Catch pane-splitter drags — those don't fire window 'resize'.
      // Throttle to one rAF so we don't ptyResize on every pixel.
      let rafScheduled = false;
      const observer = new ResizeObserver(() => {
        if (rafScheduled) return;
        rafScheduled = true;
        requestAnimationFrame(() => {
          rafScheduled = false;
          onResize();
        });
      });
      if (containerRef.current) observer.observe(containerRef.current);
      unlistens.push(() => observer.disconnect());
    })();

    return () => {
      disposed = true;
      clearActiveSession(SESSION_ID);
      titleDisposable.dispose();
      containerRef.current?.removeEventListener("click", focusOnClick);
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
      // Defer the fit until after the parent's display:none toggle has
      // actually painted — otherwise xterm measures zero and clamps to
      // 1 column. requestAnimationFrame is enough since the toggle is
      // a synchronous style change.
      requestAnimationFrame(() => {
        fitRef.current?.fit();
        termRef.current?.focus();
      });
    } else {
      clearActiveSession(id);
    }
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
