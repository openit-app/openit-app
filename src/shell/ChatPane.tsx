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

export function ChatPane({ cwd, resume }: { cwd: string | null; resume?: boolean }) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    if (!cwd) return; // Don't spawn until we have a project folder
    const SESSION_ID = `main-${crypto.randomUUID()}`;

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
    term.focus();
    const focusOnClick = () => term.focus();
    containerRef.current.addEventListener("click", focusOnClick);

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

      setActiveSession(SESSION_ID);

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

      // Resize handling has two phases:
      //
      // 1. Live phase (during a drag / window resize): throttle to one
      //    rAF — call `fit.fit()` + `ptyResize()` so layout stays
      //    responsive. This sends SIGWINCH to Claude, which starts
      //    repainting at the new geometry.
      //
      // 2. Settle phase (after resize stops): once we've been quiet
      //    for SETTLE_MS, do a final `fit.fit()` + `ptyResize()` at
      //    the final geometry, then wipe the xterm buffer with a full
      //    clear-screen + clear-scrollback sequence. The next frame
      //    Claude paints lands on a blank canvas, eliminating the
      //    duplicate spinners / overlapping prompt / stale glyphs
      //    that Ben reported (PIN-6608).
      //
      // Why settle (not refresh): xterm's `refresh()` only redraws
      // what's already in its buffer at its current width. The bug
      // is that Claude's TUI renderer is a delta-painter — when
      // SIGWINCH fires mid-frame, its next frame doesn't always
      // overwrite every cell from the prior (wider) frame, so old
      // glyphs leak through. Clearing the buffer ourselves forces a
      // full repaint from Claude's next frame onward.
      const SETTLE_MS = 80;
      let rafScheduled = false;
      let settleTimer: ReturnType<typeof setTimeout> | null = null;
      let lastCols = term.cols;
      let lastRows = term.rows;

      const sendResize = () => {
        ptyResize(SESSION_ID, term.cols, term.rows).catch((e) =>
          console.error("pty bridge error:", e),
        );
      };

      const settle = () => {
        if (disposed) return;
        // Final fit in case the last live-phase fit was stale.
        fit.fit();
        // Always re-emit the final size — even if cols/rows didn't
        // change since the last live tick, the child may have missed
        // a SIGWINCH while busy painting.
        sendResize();
        // Only clear the display when geometry actually changed.
        // Resize-during-streaming users would otherwise lose
        // their scrollback to a no-op settle (e.g. focus change).
        if (term.cols !== lastCols || term.rows !== lastRows) {
          // \x1b[3J → clear scrollback
          // \x1b[2J → clear entire visible viewport
          // \x1b[H  → move cursor to home (1,1)
          // Claude's next paint lands on a blank canvas. We do NOT
          // forward this to the PTY — the child manages its own
          // framebuffer; we only clear xterm's local copy.
          term.write("\x1b[3J\x1b[2J\x1b[H");
          lastCols = term.cols;
          lastRows = term.rows;
        }
      };

      const scheduleSettle = () => {
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = setTimeout(settle, SETTLE_MS);
      };

      const onResize = () => {
        if (disposed) return;
        if (rafScheduled) {
          // Live tick already queued; just extend the settle window.
          scheduleSettle();
          return;
        }
        rafScheduled = true;
        requestAnimationFrame(() => {
          rafScheduled = false;
          if (disposed) return;
          fit.fit();
          sendResize();
          scheduleSettle();
        });
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
      containerRef.current?.removeEventListener("click", focusOnClick);
      containerRef.current?.removeEventListener("dragover", onDragOver, true);
      containerRef.current?.removeEventListener("drop", onInPageDrop, true);
      for (const fn of unlistens) fn();
      ptyKill(SESSION_ID).catch((e) => console.error("pty bridge error:", e));
      term.dispose();
    };
  }, [cwd]);

  if (!cwd) {
    return (
      <div className="chat-empty">
        Open a project folder to start a Claude Code session.
      </div>
    );
  }

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}
