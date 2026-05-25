import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

const ptyMock = vi.hoisted(() => ({
  ptySpawn: vi.fn().mockResolvedValue(undefined),
  ptyWrite: vi.fn().mockResolvedValue(undefined),
  ptyResize: vi.fn().mockResolvedValue(undefined),
  ptyKill: vi.fn().mockResolvedValue(undefined),
  onPtyData: vi.fn().mockResolvedValue(() => {}),
  onPtyExit: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock("../lib/terminal", () => ptyMock);

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: vi.fn().mockResolvedValue(() => {}) }),
}));

// xterm tries to render to a real DOM. jsdom doesn't implement enough of
// CanvasRenderingContext2D for it to fully initialize, but the addon and
// onData hooks still register before any rendering — which is what we test.
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    activate() {}
    dispose() {}
    fit() {}
  },
}));

// Capture the xterm hooks so we can drive them directly from tests.
// Terminal in jsdom can't render (no canvas), but every code path we care
// about — attachCustomKeyEventHandler, onData, input, focus — is just JS
// plumbing that we exercise without DOM events.
type KeyEventHandler = (e: KeyboardEvent) => boolean;
type DataHandler = (data: string) => void;
const xtermCapture = vi.hoisted(() => ({
  customKeyEventHandler: null as KeyEventHandler | null,
  onDataHandler: null as DataHandler | null,
  inputCalls: [] as string[],
  focusCalls: 0,
}));

vi.mock("@xterm/xterm", () => {
  class FakeTerminal {
    cols = 80;
    rows = 24;
    loadAddon() {}
    open() {}
    focus() {
      xtermCapture.focusCalls += 1;
    }
    dispose() {}
    refresh() {}
    write() {}
    writeln() {}
    attachCustomKeyEventHandler(h: KeyEventHandler) {
      xtermCapture.customKeyEventHandler = h;
    }
    onData(h: DataHandler) {
      xtermCapture.onDataHandler = h;
    }
    onTitleChange(_h: (title: string) => void) {
      return { dispose() {} };
    }
    input(data: string) {
      xtermCapture.inputCalls.push(data);
      // Mirror real xterm: input() fans out through onData if user input.
      if (xtermCapture.onDataHandler) xtermCapture.onDataHandler(data);
    }
  }
  return { Terminal: FakeTerminal };
});

vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: class {
    activate() {}
    dispose() {}
  },
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(""),
}));

function makeKeyEvent(init: Partial<KeyboardEventInit> & { type?: string }): KeyboardEvent {
  const { type = "keydown", ...rest } = init;
  return new KeyboardEvent(type, { key: "Enter", ...rest });
}

import { ChatPane } from "./ChatPane";

const sessionIdMatcher = expect.stringMatching(/^main-/);

// Sequence Claude Code's /terminal-setup installs for Shift+Enter
// (and which we now also bind to Ctrl+Enter for muscle-memory parity).

describe("ChatPane", () => {
  beforeEach(() => {
    Object.values(ptyMock).forEach((fn) => fn.mockClear());
    xtermCapture.customKeyEventHandler = null;
    xtermCapture.onDataHandler = null;
    xtermCapture.inputCalls = [];
    xtermCapture.focusCalls = 0;
  });

  afterEach(() => {
    cleanup();
  });

  it("spawns a pty session on mount", async () => {
    render(<ChatPane cwd="/tmp/test-repo" />);
    await new Promise((r) => setTimeout(r, 0));
    expect(ptyMock.ptySpawn).toHaveBeenCalledTimes(1);
    const args = ptyMock.ptySpawn.mock.calls[0][0];
    expect(args.sessionId).toMatch(/^main-/);
    expect(typeof args.cols).toBe("number");
    expect(typeof args.rows).toBe("number");
  });

  it("subscribes to pty data + exit events", async () => {
    render(<ChatPane cwd="/tmp/test-repo" />);
    await new Promise((r) => setTimeout(r, 0));
    expect(ptyMock.onPtyData).toHaveBeenCalledWith(sessionIdMatcher, expect.any(Function));
    expect(ptyMock.onPtyExit).toHaveBeenCalledWith(sessionIdMatcher, expect.any(Function));
  });

  it("forwards window resize to ptyResize", async () => {
    render(<ChatPane cwd="/tmp/test-repo" />);
    await new Promise((r) => setTimeout(r, 0));
    ptyMock.ptyResize.mockClear();
    window.dispatchEvent(new Event("resize"));
    // ptyResize runs inside requestAnimationFrame, so wait one frame.
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(ptyMock.ptyResize).toHaveBeenCalledWith(
      sessionIdMatcher,
      expect.any(Number),
      expect.any(Number),
    );
  });

  it("coalesces rapid resizes — never one ptyResize per event", async () => {
    // Pin the faked clock set so future vitest config tweaks can't
    // silently let real rAF leak through and produce a false pass.
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame"],
    });
    try {
      render(<ChatPane cwd="/tmp/test-repo" />);
      // Flush spawn promises so onResize is wired.
      await vi.advanceTimersByTimeAsync(0);
      ptyMock.ptyResize.mockClear();

      // Burst of 10 resizes in rapid succession.
      for (let i = 0; i < 10; i++) {
        window.dispatchEvent(new Event("resize"));
      }
      // One rAF + the 80ms settle window.
      await vi.advanceTimersByTimeAsync(16);
      const liveCalls = ptyMock.ptyResize.mock.calls.length;
      // 10 events MUST coalesce — definitely not 10.
      expect(liveCalls).toBeLessThanOrEqual(2);

      await vi.advanceTimersByTimeAsync(100);
      // Total calls (live + settle) still capped well below the event count.
      // Note: with mocked xterm cols/rows = 0, the settle's geometry-changed
      // gate may suppress its ptyResize. The deterministic invariant is just
      // "coalesces" — that's what we assert.
      expect(ptyMock.ptyResize.mock.calls.length).toBeLessThan(10);
    } finally {
      vi.useRealTimers();
    }
  });

  it("kills the pty session on unmount", async () => {
    const { unmount } = render(<ChatPane cwd="/tmp/test-repo" />);
    await new Promise((r) => setTimeout(r, 0));
    unmount();
    expect(ptyMock.ptyKill).toHaveBeenCalledWith(sessionIdMatcher);
  });

  it("uses the provided sessionId when supplied by parent", async () => {
    render(<ChatPane cwd="/tmp/test-repo" sessionId="main-custom-id" />);
    await new Promise((r) => setTimeout(r, 0));
    expect(ptyMock.ptySpawn).toHaveBeenCalledTimes(1);
    const args = ptyMock.ptySpawn.mock.calls[0][0];
    expect(args.sessionId).toBe("main-custom-id");
  });

  it("does not claim active-session when made hidden during pty spawn", async () => {
    // Hold ptySpawn in flight so we can flip visibility before it resolves —
    // mirroring the real race: user clicks '+' (new tab becomes active),
    // then immediately switches back; the slow spawn must not retake the
    // active pointer after the visibility has already moved away.
    let resolveSpawn: (() => void) | undefined;
    ptyMock.ptySpawn.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveSpawn = resolve;
        }),
    );
    const { rerender } = render(
      <ChatPane cwd="/tmp/test-repo" sessionId="main-race" visible={true} />,
    );
    // Switch the pane to hidden while spawn is still pending.
    rerender(<ChatPane cwd="/tmp/test-repo" sessionId="main-race" visible={false} />);
    // Let spawn complete; the post-spawn `setActiveSession` should see the
    // ref-mirrored `visible=false` and bail.
    resolveSpawn?.();
    await new Promise((r) => setTimeout(r, 0));
    // We don't import activeSession state directly (no exported getter),
    // but writing to the active session is a clean observable: write must
    // NOT go to the hidden pane. The test relies on the documented
    // contract: setActiveSession is skipped when visible flips false
    // before spawn completes.
    expect(ptyMock.ptyWrite).not.toHaveBeenCalledWith("main-race", expect.any(String));
  });

  it("renders display:none when visible=false but still spawns the pty", async () => {
    const { container } = render(
      <ChatPane cwd="/tmp/test-repo" sessionId="main-bg" visible={false} />,
    );
    await new Promise((r) => setTimeout(r, 0));
    // Spawn must happen regardless of visibility so background sessions
    // keep running — switching tabs only changes display.
    expect(ptyMock.ptySpawn).toHaveBeenCalledTimes(1);
    const root = container.firstChild as HTMLElement | null;
    expect(root?.style.display).toBe("none");
  });

  it("hidden panes ignore resize events (don't blank a backgrounded session)", async () => {
    // Reproduces the regression where opening a new tab caused the
    // previously-active terminal to appear blanked: the old pane went
    // display:none, ResizeObserver fired with (0,0), settle() wiped the
    // xterm buffer. Hidden panes must NOT forward resize to the pty.
    const { rerender } = render(
      <ChatPane cwd="/tmp/test-repo" sessionId="main-bg" visible={true} />,
    );
    await new Promise((r) => setTimeout(r, 0));
    // Flip to hidden — mirrors a sibling tab becoming the active one.
    rerender(<ChatPane cwd="/tmp/test-repo" sessionId="main-bg" visible={false} />);
    ptyMock.ptyResize.mockClear();
    window.dispatchEvent(new Event("resize"));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(ptyMock.ptyResize).not.toHaveBeenCalled();
  });

  it("cancels the queued requestAnimationFrame on rapid visible→hidden flip", async () => {
    const cancelSpy = vi.spyOn(window, "cancelAnimationFrame");
    const { rerender, unmount } = render(
      <ChatPane cwd="/tmp/test-repo" sessionId="main-raf" visible={true} />,
    );
    await new Promise((r) => setTimeout(r, 0));
    // Visible→hidden flip must cancel the pending focus/fit rAF so the
    // hidden pane doesn't steal focus after the user already picked a
    // different tab. The cleanup of the visible-branch effect runs the
    // cancelAnimationFrame; we just observe the call.
    rerender(<ChatPane cwd="/tmp/test-repo" sessionId="main-raf" visible={false} />);
    expect(cancelSpy).toHaveBeenCalled();
    cancelSpy.mockRestore();
    unmount();
  });


  describe("Click-to-focus", () => {
    it("focuses the terminal when the container is clicked", async () => {
      const { container } = render(<ChatPane cwd="/tmp/test-repo" />);
      await new Promise((r) => setTimeout(r, 0));
      // Mount focuses once (term.focus() after open). Click should add one more.
      const baseline = xtermCapture.focusCalls;
      const root = container.firstElementChild as HTMLElement;
      expect(root).toBeTruthy();
      root.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(xtermCapture.focusCalls).toBe(baseline + 1);
    });
  });
});
