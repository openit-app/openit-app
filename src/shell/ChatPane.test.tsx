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
// about — attachCustomKeyEventHandler, onData, input — is just JS plumbing
// that we exercise without DOM events.
type KeyEventHandler = (e: KeyboardEvent) => boolean;
type DataHandler = (data: string) => void;
const xtermCapture = vi.hoisted(() => ({
  customKeyEventHandler: null as KeyEventHandler | null,
  onDataHandler: null as DataHandler | null,
  inputCalls: [] as string[],
}));

vi.mock("@xterm/xterm", () => {
  class FakeTerminal {
    cols = 80;
    rows = 24;
    loadAddon() {}
    open() {}
    focus() {}
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

describe("ChatPane", () => {
  beforeEach(() => {
    Object.values(ptyMock).forEach((fn) => fn.mockClear());
    xtermCapture.customKeyEventHandler = null;
    xtermCapture.onDataHandler = null;
    xtermCapture.inputCalls = [];
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
    await new Promise((r) => setTimeout(r, 0));
    expect(ptyMock.ptyResize).toHaveBeenCalledWith(
      sessionIdMatcher,
      expect.any(Number),
      expect.any(Number),
    );
  });

  it("kills the pty session on unmount", async () => {
    const { unmount } = render(<ChatPane cwd="/tmp/test-repo" />);
    await new Promise((r) => setTimeout(r, 0));
    unmount();
    expect(ptyMock.ptyKill).toHaveBeenCalledWith(sessionIdMatcher);
  });

  describe("Shift+Enter newline", () => {
    it("sends exactly one ESC+CR for Shift+Enter and suppresses default", async () => {
      render(<ChatPane cwd="/tmp/test-repo" />);
      // Wait for ptySpawn to resolve and onData to be wired.
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      expect(xtermCapture.customKeyEventHandler).toBeTruthy();
      expect(xtermCapture.onDataHandler).toBeTruthy();

      ptyMock.ptyWrite.mockClear();
      const result = xtermCapture.customKeyEventHandler!(
        makeKeyEvent({ shiftKey: true }),
      );
      expect(result).toBe(false); // suppresses xterm's default "\r"
      expect(xtermCapture.inputCalls).toEqual(["\x1b\r"]);
      expect(ptyMock.ptyWrite).toHaveBeenCalledTimes(1);
      expect(ptyMock.ptyWrite).toHaveBeenCalledWith(sessionIdMatcher, "\x1b\r");
    });

    it("does not intercept plain Enter", async () => {
      render(<ChatPane cwd="/tmp/test-repo" />);
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));

      const result = xtermCapture.customKeyEventHandler!(makeKeyEvent({}));
      expect(result).toBe(true); // let xterm produce its default "\r"
      expect(xtermCapture.inputCalls).toEqual([]);
    });

    it("does not intercept Enter with other modifiers", async () => {
      render(<ChatPane cwd="/tmp/test-repo" />);
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));

      for (const mods of [
        { ctrlKey: true, shiftKey: true },
        { metaKey: true, shiftKey: true },
        { altKey: true, shiftKey: true },
      ]) {
        const result = xtermCapture.customKeyEventHandler!(makeKeyEvent(mods));
        expect(result).toBe(true);
      }
      expect(xtermCapture.inputCalls).toEqual([]);
    });

    it("ignores IME composition", async () => {
      render(<ChatPane cwd="/tmp/test-repo" />);
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));

      const evt = makeKeyEvent({ shiftKey: true });
      Object.defineProperty(evt, "isComposing", { value: true });
      const result = xtermCapture.customKeyEventHandler!(evt);
      expect(result).toBe(true);
      expect(xtermCapture.inputCalls).toEqual([]);
    });

    it("ignores Shift+Enter keyup (only keydown triggers)", async () => {
      render(<ChatPane cwd="/tmp/test-repo" />);
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));

      const result = xtermCapture.customKeyEventHandler!(
        makeKeyEvent({ type: "keyup", shiftKey: true }),
      );
      expect(result).toBe(true);
      expect(xtermCapture.inputCalls).toEqual([]);
    });

    it("drops pre-spawn Shift+Enter without throwing", async () => {
      // Make ptySpawn hang so onData is never wired.
      ptyMock.ptySpawn.mockReturnValueOnce(new Promise(() => {}));
      render(<ChatPane cwd="/tmp/test-repo" />);
      await new Promise((r) => setTimeout(r, 0));
      expect(xtermCapture.customKeyEventHandler).toBeTruthy();
      expect(xtermCapture.onDataHandler).toBeNull();

      expect(() =>
        xtermCapture.customKeyEventHandler!(makeKeyEvent({ shiftKey: true })),
      ).not.toThrow();
      // term.input still received the bytes, but onData isn't wired yet,
      // so the byte is silently dropped — same as any keystroke pre-spawn.
      expect(xtermCapture.inputCalls).toEqual(["\x1b\r"]);
      expect(ptyMock.ptyWrite).not.toHaveBeenCalled();
    });
  });
});
