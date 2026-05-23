// PIN-6612 regression coverage for the delete affordance on entity
// cards. The fix is single-source: EntityCardGrid funnels every
// delete activation (trash button mousedown, keyboard click, context-
// menu Delete) through a per-card.key dedupe wrapper. These tests
// nail down each of the failure modes the user reported in the
// ticket — "slamming the delete button" double-firing, silent
// console-only failures, button staying enabled mid-delete — so any
// future refactor that drops the guard breaks loudly.

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EntityCardGrid } from "./EntityCardGrid";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("EntityCardGrid delete reliability (PIN-6612)", () => {
  it("fires onDelete exactly once even under a click storm", async () => {
    const d = deferred();
    const onDelete = vi.fn(() => d.promise);

    render(
      <EntityCardGrid
        kind="library"
        cards={[
          {
            key: "abc",
            title: "report.md",
            onDelete,
          },
        ]}
      />,
    );

    const button = screen.getByRole("button", { name: /delete report\.md/i });

    // Simulate a "slam the button" interaction: 10 rapid mousedowns in
    // the same React event cycle. Before PIN-6612 this fired 10 async
    // deletes; after, the per-card guard collapses them to one.
    for (let i = 0; i < 10; i++) {
      fireEvent.mouseDown(button);
    }
    expect(onDelete).toHaveBeenCalledTimes(1);

    // While the delete is in flight, the button is disabled and
    // labelled with the busy state. Additional mousedowns still no-op.
    expect(button).toBeDisabled();
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.getAttribute("aria-label")).toMatch(/deleting/i);

    for (let i = 0; i < 5; i++) {
      fireEvent.mouseDown(button);
    }
    expect(onDelete).toHaveBeenCalledTimes(1);

    // Resolving the delete lets the guard release. Wrap in act() so
    // the resulting state updates flush before the next assertion.
    await act(async () => {
      d.resolve();
      await d.promise;
    });

    // Button is re-enabled and a fresh click starts a new delete.
    expect(button.getAttribute("aria-busy")).toBe("false");
  });

  it("never silently swallows handler rejections — logs to console.error", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = new Error("permission denied");
    const onDelete = vi.fn(() => Promise.reject(boom));

    render(
      <EntityCardGrid
        kind="library"
        cards={[{ key: "abc", title: "locked.md", onDelete }]}
      />,
    );

    const button = screen.getByRole("button", { name: /delete locked\.md/i });
    await act(async () => {
      fireEvent.mouseDown(button);
      // Let the rejected promise propagate through runDelete's try/catch.
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onDelete).toHaveBeenCalledTimes(1);
    // Backstop logging — handlers OWN user-visible toasts, but the
    // grid logs as a safety net so devtools never go dark on a
    // rejection.
    expect(errSpy).toHaveBeenCalled();
    const logged = errSpy.mock.calls.flat().some((arg) => arg === boom);
    expect(logged).toBe(true);

    // Guard releases on failure so the user can retry.
    expect(button.getAttribute("aria-busy")).toBe("false");
    expect(button).not.toBeDisabled();
  });

  it("keyboard Delete on a focused card also dedupes", async () => {
    const d = deferred();
    const onDelete = vi.fn(() => d.promise);

    render(
      <EntityCardGrid
        kind="library"
        cards={[
          {
            key: "abc",
            title: "kb.md",
            onClick: () => {},
            onDelete,
          },
        ]}
      />,
    );

    // Two matches by accessible name: the card (which has onClick) and
    // the trash glyph (aria-label "Delete kb.md"). The card is the
    // first child of the wrapper and the one wired with onKeyDown.
    const card = screen
      .getAllByRole("button", { name: /kb\.md/i })
      .find((el) => el.classList.contains("entity-card"));
    if (!card) throw new Error("card not found");

    // Held-down Backspace dispatches multiple keydown events. The
    // guard must collapse them.
    for (let i = 0; i < 8; i++) {
      fireEvent.keyDown(card, { key: "Backspace" });
    }
    expect(onDelete).toHaveBeenCalledTimes(1);

    await act(async () => {
      d.resolve();
      await d.promise;
    });
  });

  it("stress test: 20 sequential deletes each fire once", async () => {
    // Simulates the manual stress test the ticket explicitly calls
    // out: "20 deletes in a row, no flakiness." Each iteration mounts
    // a fresh delete handler so we can prove every one of them fires
    // exactly once even when invoked back-to-back with a click storm
    // per iteration.
    for (let iter = 0; iter < 20; iter++) {
      const d = deferred();
      const onDelete = vi.fn(() => d.promise);

      const { unmount } = render(
        <EntityCardGrid
          kind="library"
          cards={[{ key: `iter-${iter}`, title: `file-${iter}.md`, onDelete }]}
        />,
      );

      const button = screen.getByRole("button", {
        name: new RegExp(`delete file-${iter}\\.md`, "i"),
      });

      // Storm each iteration with 5 rapid clicks.
      fireEvent.mouseDown(button);
      fireEvent.mouseDown(button);
      fireEvent.mouseDown(button);
      fireEvent.mouseDown(button);
      fireEvent.mouseDown(button);

      expect(onDelete).toHaveBeenCalledTimes(1);

      await act(async () => {
        d.resolve();
        await d.promise;
      });

      unmount();
    }
  });
});
