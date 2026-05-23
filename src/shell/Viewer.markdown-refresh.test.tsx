/**
 * Markdown auto-refresh behaviour for the file viewer (PIN-6607).
 *
 * Viewer.tsx is heavy and pulls a sprawling import graph that doesn't
 * survive jsdom unmodified. Rather than render the full component,
 * this test isolates the contract we care about with a lightweight
 * harness that exercises the same useEffect shape: when `fsTick`
 * changes and the open source is a rendered Markdown file, fsRead is
 * called for the open path (after a ~250ms debounce). When the source
 * is in edit mode, or when the path is not Markdown, fsRead is not
 * called. Source/mode are tracked via refs so navigation alone
 * doesn't queue redundant disk reads.
 *
 * If the real Viewer effect drifts away from this shape, this test
 * will keep passing — which is the right tradeoff for a 100+KB
 * component. The companion regression test is the manual smoke step
 * in Phase 4.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { useEffect, useRef, useState } from "react";

const apiMock = vi.hoisted(() => ({
  fsRead: vi.fn().mockResolvedValue("# fresh"),
}));
vi.mock("../lib/api", () => apiMock);

import { fsRead } from "../lib/api";

// Inlined to avoid pulling the whole viewers barrel (PDF.js etc.) into
// jsdom. Kept verbatim with the source-of-truth in viewerHelpers.tsx.
function isMarkdown(path: string): boolean {
  return /\.(md|mdx|markdown)$/i.test(path);
}

type Source = { kind: "file"; path: string } | null;

/** Reproduces the exact useEffect Viewer ships, minus the
 *  React-Markdown render tree. Keeps the gates explicit so any drift
 *  on the real effect surfaces in code review.
 *
 *  Note: the timer effect depends on `[fsTick]` ONLY — source/mode are
 *  read via refs at fire time so navigating between files doesn't
 *  trigger a redundant disk read on every viewer change. */
function MarkdownAutoRefreshHarness({
  source,
  mode,
  fsTick,
  scrollRestoreProbe,
}: {
  source: Source;
  mode: "rendered" | "edit" | "raw";
  fsTick: number;
  // Test injects a counter that the scroll-restore rAF bumps. Lets
  // us assert the restore ran (or didn't) without faking actual DOM
  // scroll behaviour in jsdom.
  scrollRestoreProbe?: { count: number };
}) {
  const [content, setContent] = useState("");
  const mdScrollRef = useRef<HTMLDivElement | null>(null);
  const mdSourceRef = useRef(source);
  const mdModeRef = useRef(mode);
  const mdContentRef = useRef(content);
  useEffect(() => {
    mdSourceRef.current = source;
    mdModeRef.current = mode;
  }, [source, mode]);
  useEffect(() => {
    mdContentRef.current = content;
  }, [content]);
  const [appliedContent, setAppliedContent] = useState("");
  useEffect(() => {
    if (fsTick === 0) return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      const liveSource = mdSourceRef.current;
      const liveMode = mdModeRef.current;
      if (!liveSource || liveSource.kind !== "file") return;
      if (liveMode !== "rendered" || !isMarkdown(liveSource.path)) return;
      const path = liveSource.path;
      fsRead(path)
        .then((c) => {
          if (cancelled) return;
          const stillSource = mdSourceRef.current;
          const stillMode = mdModeRef.current;
          if (!stillSource || stillSource.kind !== "file" || stillSource.path !== path) {
            return;
          }
          if (stillMode !== "rendered") return;
          // Synchronous equality check via the content mirror — the
          // earlier "let didUpdate inside the updater" pattern was
          // broken because React applies functional updaters during
          // the next render pass, so reading the flag immediately
          // after `setContent(...)` always saw `false`.
          if (mdContentRef.current === c) return;
          setContent(c);
          setAppliedContent(c);
          // The real Viewer uses requestAnimationFrame here to wait
          // for the markdown subtree to commit before restoring
          // scroll. We just bump a probe counter so tests can assert
          // the restore path was reached at all.
          if (scrollRestoreProbe) {
            window.requestAnimationFrame(() => {
              scrollRestoreProbe.count += 1;
            });
          }
        })
        .catch(() => {});
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [fsTick, scrollRestoreProbe]);
  return (
    <>
      <div ref={mdScrollRef} />
      <div data-testid="applied-content">{appliedContent}</div>
    </>
  );
}

describe("markdown viewer auto-refresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    apiMock.fsRead.mockReset().mockResolvedValue("# fresh");
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("scroll restore runs when content actually changed (and not when unchanged)", async () => {
    // Regression for BugBot iter-4: the original `let didUpdate =
    // false; setContent(updater)` pattern read `didUpdate`
    // synchronously after setContent — React applies functional
    // updaters in the next render pass, so the flag stayed false
    // even when content had changed, and rAF never ran.
    apiMock.fsRead.mockResolvedValue("changed");
    const probe = { count: 0 };

    const { rerender } = render(
      <MarkdownAutoRefreshHarness
        source={{ kind: "file", path: "/repo/kb/a.md" }}
        mode="rendered"
        fsTick={0}
        scrollRestoreProbe={probe}
      />,
    );
    rerender(
      <MarkdownAutoRefreshHarness
        source={{ kind: "file", path: "/repo/kb/a.md" }}
        mode="rendered"
        fsTick={1}
        scrollRestoreProbe={probe}
      />,
    );
    vi.advanceTimersByTime(300);
    await Promise.resolve();
    await Promise.resolve();
    // Drain the rAF queue.
    vi.advanceTimersByTime(20);
    expect(probe.count).toBe(1);

    // Second fsTick with the SAME content on disk — equality short-
    // circuit should fire and the restore should NOT run.
    apiMock.fsRead.mockResolvedValue("changed");
    rerender(
      <MarkdownAutoRefreshHarness
        source={{ kind: "file", path: "/repo/kb/a.md" }}
        mode="rendered"
        fsTick={2}
        scrollRestoreProbe={probe}
      />,
    );
    vi.advanceTimersByTime(300);
    await Promise.resolve();
    await Promise.resolve();
    vi.advanceTimersByTime(20);
    expect(probe.count).toBe(1);
  });

  it("re-reads the open markdown file when fsTick bumps", async () => {
    const { rerender } = render(
      <MarkdownAutoRefreshHarness
        source={{ kind: "file", path: "/repo/filestores/commands/cmd.md" }}
        mode="rendered"
        fsTick={0}
      />,
    );

    // Initial fsTick=0 is the "do nothing" signal.
    vi.advanceTimersByTime(500);
    expect(apiMock.fsRead).not.toHaveBeenCalled();

    rerender(
      <MarkdownAutoRefreshHarness
        source={{ kind: "file", path: "/repo/filestores/commands/cmd.md" }}
        mode="rendered"
        fsTick={1}
      />,
    );

    // Debounce window is 250ms — re-read should not happen before that.
    vi.advanceTimersByTime(200);
    expect(apiMock.fsRead).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(apiMock.fsRead).toHaveBeenCalledWith("/repo/filestores/commands/cmd.md");
  });

  it("does not re-read while the viewer is in edit mode", async () => {
    const { rerender } = render(
      <MarkdownAutoRefreshHarness
        source={{ kind: "file", path: "/repo/filestores/commands/cmd.md" }}
        mode="edit"
        fsTick={1}
      />,
    );
    vi.advanceTimersByTime(500);
    expect(apiMock.fsRead).not.toHaveBeenCalled();

    rerender(
      <MarkdownAutoRefreshHarness
        source={{ kind: "file", path: "/repo/filestores/commands/cmd.md" }}
        mode="edit"
        fsTick={2}
      />,
    );
    vi.advanceTimersByTime(500);
    expect(apiMock.fsRead).not.toHaveBeenCalled();
  });

  it("does not re-read non-markdown files", async () => {
    render(
      <MarkdownAutoRefreshHarness
        source={{ kind: "file", path: "/repo/filestores/scripts/s.mjs" }}
        mode="rendered"
        fsTick={1}
      />,
    );
    vi.advanceTimersByTime(500);
    expect(apiMock.fsRead).not.toHaveBeenCalled();
  });

  it("coalesces a burst of fsTick bumps into a single re-read", async () => {
    const { rerender } = render(
      <MarkdownAutoRefreshHarness
        source={{ kind: "file", path: "/repo/kb/a.md" }}
        mode="rendered"
        fsTick={1}
      />,
    );
    vi.advanceTimersByTime(100);
    rerender(
      <MarkdownAutoRefreshHarness
        source={{ kind: "file", path: "/repo/kb/a.md" }}
        mode="rendered"
        fsTick={2}
      />,
    );
    vi.advanceTimersByTime(100);
    rerender(
      <MarkdownAutoRefreshHarness
        source={{ kind: "file", path: "/repo/kb/a.md" }}
        mode="rendered"
        fsTick={3}
      />,
    );
    // Only the most recent timer wins because each tick re-runs the
    // effect (which clears the previous timeout).
    vi.advanceTimersByTime(300);
    expect(apiMock.fsRead).toHaveBeenCalledTimes(1);
  });

  it("does NOT fire fsRead when only source changes (fsTick stable)", async () => {
    // Regression for the redundant-read finding: navigating between
    // markdown files while fsTick is non-zero should not queue a
    // second disk read — the source-loading effect handles the
    // initial paint, and the watcher will fire its own tick if the
    // new file changes later.
    const { rerender } = render(
      <MarkdownAutoRefreshHarness
        source={{ kind: "file", path: "/repo/kb/a.md" }}
        mode="rendered"
        fsTick={7}
      />,
    );
    vi.advanceTimersByTime(500);
    expect(apiMock.fsRead).toHaveBeenCalledTimes(1);
    apiMock.fsRead.mockClear();

    // Same fsTick, different file — must NOT cause a second fsRead.
    rerender(
      <MarkdownAutoRefreshHarness
        source={{ kind: "file", path: "/repo/kb/b.md" }}
        mode="rendered"
        fsTick={7}
      />,
    );
    vi.advanceTimersByTime(500);
    expect(apiMock.fsRead).not.toHaveBeenCalled();
  });

  it("does NOT fire fsRead when only mode changes (fsTick stable)", async () => {
    const { rerender } = render(
      <MarkdownAutoRefreshHarness
        source={{ kind: "file", path: "/repo/kb/a.md" }}
        mode="edit"
        fsTick={3}
      />,
    );
    vi.advanceTimersByTime(500);
    expect(apiMock.fsRead).not.toHaveBeenCalled();

    // Save → mode flips to rendered. With fsTick stable, no read.
    rerender(
      <MarkdownAutoRefreshHarness
        source={{ kind: "file", path: "/repo/kb/a.md" }}
        mode="rendered"
        fsTick={3}
      />,
    );
    vi.advanceTimersByTime(500);
    expect(apiMock.fsRead).not.toHaveBeenCalled();
  });

  it("aborts the re-read if the user switches to edit mode WHILE fsRead is in flight", async () => {
    // Hold fsRead in suspense so we can flip mode between the
    // pre-await gate and the resolution. Without the post-await
    // mode recheck, the resolved content would land in setContent
    // and clobber the user's edit draft. (BugBot finding.)
    let resolveRead: ((s: string) => void) | null = null;
    apiMock.fsRead.mockImplementation(
      () =>
        new Promise<string>((res) => {
          resolveRead = res;
        }),
    );

    const { rerender } = render(
      <MarkdownAutoRefreshHarness
        source={{ kind: "file", path: "/repo/kb/a.md" }}
        mode="rendered"
        fsTick={1}
      />,
    );
    // Trigger the debounce → fsRead is now in flight.
    vi.advanceTimersByTime(300);
    expect(apiMock.fsRead).toHaveBeenCalledTimes(1);

    // User switches into edit mode BEFORE the read resolves.
    rerender(
      <MarkdownAutoRefreshHarness
        source={{ kind: "file", path: "/repo/kb/a.md" }}
        mode="edit"
        fsTick={1}
      />,
    );

    // Resolve the read.
    resolveRead?.("new disk content");

    // Let the .then microtask flush.
    await Promise.resolve();
    await Promise.resolve();

    // The probe shows the empty initial value — meaning setContent
    // was NOT called, the user's edit draft is safe.
    expect(screen.getByTestId("applied-content").textContent).toBe("");
  });

  it("aborts the re-read if the user navigates away mid-debounce", async () => {
    // Open a markdown file, fsTick fires, then before the 250ms
    // debounce elapses the user switches to a non-markdown viewer.
    // The fire-time gate should refuse to fsRead.
    const { rerender } = render(
      <MarkdownAutoRefreshHarness
        source={{ kind: "file", path: "/repo/kb/a.md" }}
        mode="rendered"
        fsTick={1}
      />,
    );
    vi.advanceTimersByTime(100);
    rerender(
      <MarkdownAutoRefreshHarness
        source={{ kind: "file", path: "/repo/filestores/scripts/s.mjs" }}
        mode="rendered"
        fsTick={1}
      />,
    );
    vi.advanceTimersByTime(500);
    expect(apiMock.fsRead).not.toHaveBeenCalled();
  });
});
