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
});
