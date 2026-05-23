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

import { ChatPane } from "./ChatPane";

const sessionIdMatcher = expect.stringMatching(/^main-/);

describe("ChatPane", () => {
  beforeEach(() => {
    Object.values(ptyMock).forEach((fn) => fn.mockClear());
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

  it("coalesces rapid resizes into a single settle and re-emits the final size", async () => {
    vi.useFakeTimers();
    try {
      render(<ChatPane cwd="/tmp/test-repo" />);
      // Flush spawn promises.
      await vi.advanceTimersByTimeAsync(0);
      ptyMock.ptyResize.mockClear();

      // Burst of 10 resizes in rapid succession.
      for (let i = 0; i < 10; i++) {
        window.dispatchEvent(new Event("resize"));
      }
      // Advance to flush rAF callbacks (jsdom falls back to setTimeout).
      await vi.advanceTimersByTimeAsync(16);
      const liveCalls = ptyMock.ptyResize.mock.calls.length;
      // 10 events should coalesce — at most a handful of live-phase calls,
      // definitely not 10.
      expect(liveCalls).toBeLessThanOrEqual(2);

      // Settle fires 80ms after the last resize event.
      await vi.advanceTimersByTimeAsync(100);
      // Settle always re-emits the final geometry.
      expect(ptyMock.ptyResize.mock.calls.length).toBeGreaterThan(liveCalls);
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
});
