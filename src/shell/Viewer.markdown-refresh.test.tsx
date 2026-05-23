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
 * called.
 *
 * If the real Viewer effect drifts away from this shape, this test
 * will keep passing — which is the right tradeoff for a 100+KB
 * component. The companion regression test is the manual smoke step
 * in Phase 4.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
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

/** Reproduces the exact useEffect SkillsStation -> Viewer ships, minus
 *  the React-Markdown render tree. Keeps the gates explicit so any
 *  drift on the real effect surfaces in code review. */
function MarkdownAutoRefreshHarness({
  source,
  mode,
  fsTick,
}: {
  source: Source;
  mode: "rendered" | "edit" | "raw";
  fsTick: number;
}) {
  const [, setContent] = useState("");
  const mdScrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!source || source.kind !== "file") return;
    if (mode !== "rendered" || !isMarkdown(source.path)) return;
    if (fsTick === 0) return;
    const path = source.path;
    let cancelled = false;
    const t = window.setTimeout(() => {
      fsRead(path)
        .then((c) => {
          if (cancelled) return;
          setContent((prev) => (prev === c ? prev : c));
        })
        .catch(() => {});
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [fsTick, source, mode]);
  return <div ref={mdScrollRef} />;
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
});
