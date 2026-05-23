import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// Reuse the same PTY mock shape used by ChatPane.test so spawn/kill calls
// don't fan out to real IPC and the test environment stays deterministic.
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

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    activate() {}
    dispose() {}
    fit() {}
  },
}));

import {
  ChatSessionTabs,
  loadTabs,
  nextDefaultLabel,
  persistTabs,
} from "./ChatSessionTabs";

const REPO = "/tmp/test-tabs-repo";

describe("ChatSessionTabs persistence helpers", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("nextDefaultLabel reuses the smallest free Session N slot", () => {
    expect(nextDefaultLabel([])).toBe("Session 1");
    expect(
      nextDefaultLabel([
        { id: "a", label: "Session 1", resume: false },
        { id: "b", label: "Session 3", resume: false },
      ]),
    ).toBe("Session 2");
    expect(
      nextDefaultLabel([
        { id: "a", label: "Session 1", resume: false },
        { id: "b", label: "Session 2", resume: false },
        { id: "c", label: "custom name", resume: false },
      ]),
    ).toBe("Session 3");
  });

  it("persistTabs + loadTabs round-trips id and label, drops resume", () => {
    persistTabs(REPO, [
      { id: "a", label: "Investigate", resume: true },
      { id: "b", label: "Session 2", resume: false },
    ]);
    const loaded = loadTabs(REPO);
    expect(loaded).toEqual([
      { id: "a", label: "Investigate", resume: false },
      { id: "b", label: "Session 2", resume: false },
    ]);
  });

  it("loadTabs returns [] for an unknown / missing repo", () => {
    expect(loadTabs("/tmp/never-stored")).toEqual([]);
    expect(loadTabs(null)).toEqual([]);
  });

  it("loadTabs survives a corrupt localStorage entry", () => {
    localStorage.setItem(`openit:chat-tabs:${REPO}`, "{not json");
    expect(loadTabs(REPO)).toEqual([]);
  });

  it("seeded Session 1 lands in localStorage after the post-commit effect", async () => {
    // Seed is minted in an effect, not during render — so an immediate
    // localStorage read after a fresh mount must reflect the seeded tab.
    render(<ChatSessionTabs cwd={REPO} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const stored = loadTabs(REPO);
    expect(stored).toHaveLength(1);
    expect(stored[0].label).toBe("Session 1");
  });
});

describe("ChatSessionTabs component", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.values(ptyMock).forEach((fn) => fn.mockClear());
  });
  afterEach(() => {
    cleanup();
  });

  it("seeds a Session 1 tab on first mount with a fresh repo", async () => {
    render(<ChatSessionTabs cwd={REPO} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.getByRole("tab", { selected: true })).toHaveTextContent("Session 1");
    // PTY was spawned for the seeded tab.
    expect(ptyMock.ptySpawn).toHaveBeenCalledTimes(1);
  });

  it("opens additional sessions via the + button, numbered tightly", async () => {
    render(<ChatSessionTabs cwd={REPO} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const add = screen.getByRole("button", { name: /new claude session/i });
    fireEvent.click(add);
    fireEvent.click(add);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toHaveTextContent("Session 1");
    expect(tabs[1]).toHaveTextContent("Session 2");
    expect(tabs[2]).toHaveTextContent("Session 3");
    // 3 distinct PTY ids should have spawned (1 seed + 2 clicks).
    const sessionIds = ptyMock.ptySpawn.mock.calls.map((c) => c[0].sessionId);
    expect(new Set(sessionIds).size).toBe(3);
  });

  it("closing a tab tears down its PTY and falls back to the neighbour", async () => {
    render(<ChatSessionTabs cwd={REPO} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const add = screen.getByRole("button", { name: /new claude session/i });
    fireEvent.click(add);
    fireEvent.click(add);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const tabs = screen.getAllByRole("tab");
    // Active is the last-added tab (Session 3). Close it; we expect Session 2 to become active.
    const closeButtons = screen.getAllByRole("button", { name: /^close session 3$/i });
    fireEvent.click(closeButtons[0]);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(ptyMock.ptyKill).toHaveBeenCalledTimes(1);
    const remaining = screen.getAllByRole("tab");
    expect(remaining).toHaveLength(2);
    expect(screen.getByRole("tab", { selected: true })).toHaveTextContent("Session 2");
    void tabs;
  });

  it("hides the close button when only one tab remains so the strip is never empty", async () => {
    render(<ChatSessionTabs cwd={REPO} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    // Single seeded tab: the close affordance should not be in the DOM.
    expect(screen.queryAllByRole("button", { name: /^close /i })).toHaveLength(0);
    // After adding a second tab, both gain close buttons.
    fireEvent.click(screen.getByRole("button", { name: /new claude session/i }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.queryAllByRole("button", { name: /^close /i }).length).toBe(2);
    // Close one; we should be back to the single-tab "no close" state.
    fireEvent.click(screen.getAllByRole("button", { name: /^close session 2$/i })[0]);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.getAllByRole("tab")).toHaveLength(1);
    expect(screen.queryAllByRole("button", { name: /^close /i })).toHaveLength(0);
  });

  it("restores tabs from localStorage on remount", async () => {
    persistTabs(REPO, [
      { id: "main-a", label: "Investigate auth", resume: false },
      { id: "main-b", label: "Refactor viewer", resume: false },
    ]);
    render(<ChatSessionTabs cwd={REPO} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent?.replace(/×.*$/, "").trim())).toEqual([
      "Investigate auth",
      "Refactor viewer",
    ]);
  });

  it("Cmd+2 switches to the second tab", async () => {
    render(<ChatSessionTabs cwd={REPO} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    fireEvent.click(screen.getByRole("button", { name: /new claude session/i }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    // After adding, focus is on Session 2. Switch back to Session 1.
    fireEvent.keyDown(window, { key: "1", metaKey: true });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.getByRole("tab", { selected: true })).toHaveTextContent("Session 1");
    fireEvent.keyDown(window, { key: "2", metaKey: true });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.getByRole("tab", { selected: true })).toHaveTextContent("Session 2");
  });

  it("Cmd+N is ignored when focus is in an editable input outside the chat area", async () => {
    render(
      <div>
        <input data-testid="rename-input" />
        <ChatSessionTabs cwd={REPO} />
      </div>,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    fireEvent.click(screen.getByRole("button", { name: /new claude session/i }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    // Focus the input and dispatch Cmd+1 from inside it. The handler
    // should bail because the target is an editable INPUT not in
    // .chat-area, leaving the active tab unchanged (Session 2).
    const input = screen.getByTestId("rename-input") as HTMLInputElement;
    input.focus();
    fireEvent.keyDown(input, { key: "1", metaKey: true });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.getByRole("tab", { selected: true })).toHaveTextContent("Session 2");
  });

  it("renders empty-state placeholder when cwd is null", () => {
    render(<ChatSessionTabs cwd={null} />);
    expect(screen.getByText(/open a project folder/i)).toBeInTheDocument();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });
});
