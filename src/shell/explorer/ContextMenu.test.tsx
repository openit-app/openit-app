// PIN-6612 regression coverage for the file-explorer right-click
// ContextMenu delete. The component unmounts as soon as the user
// confirms — but the underlying `fsDelete` RPC keeps running.
// Without the module-level `inFlightDeletes` guard, the user could
// right-click → confirm (menu closes, RPC in flight) → re-open menu
// on the same path before the RPC settles → confirm again →
// duplicate delete fires. This test pins that behavior.

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../lib/api", () => ({
  fsReveal: vi.fn().mockResolvedValue(undefined),
  fsDelete: vi.fn(),
}));

import { ContextMenu } from "./ContextMenu";
import { fsDelete } from "../../lib/api";
import { ToastProvider } from "../../Toast";

const mockFsDelete = vi.mocked(fsDelete);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderMenu(props: {
  path: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  return render(
    <ToastProvider>
      <ContextMenu
        menu={{ x: 0, y: 0, path: props.path, isDir: false }}
        onClose={props.onClose}
        onDeleted={props.onDeleted}
      />
    </ToastProvider>,
  );
}

describe("ContextMenu delete reliability (PIN-6612)", () => {
  it("dedupes the same in-flight path across unmount/remount", async () => {
    let resolveFirst!: () => void;
    const firstDelete = new Promise<void>((res) => {
      resolveFirst = res;
    });
    mockFsDelete.mockReturnValueOnce(firstDelete);

    // First menu open: click Delete (arms), click again (confirms).
    const onClose1 = vi.fn();
    const onDeleted1 = vi.fn();
    const r1 = renderMenu({
      path: "/vault/knowledge/article.md",
      onClose: onClose1,
      onDeleted: onDeleted1,
    });
    let btn = screen.getByRole("button", { name: /^delete$/i });
    fireEvent.click(btn); // arm
    btn = screen.getByRole("button", { name: /click again to confirm/i });
    fireEvent.click(btn); // confirm → onClose, fsDelete starts

    expect(mockFsDelete).toHaveBeenCalledTimes(1);
    expect(onClose1).toHaveBeenCalledTimes(1);
    r1.unmount();

    // Second menu open on the SAME path WHILE first RPC is still in
    // flight. User arms + confirms again. The module-level guard
    // must collapse this to the original single delete.
    const onClose2 = vi.fn();
    const onDeleted2 = vi.fn();
    const r2 = renderMenu({
      path: "/vault/knowledge/article.md",
      onClose: onClose2,
      onDeleted: onDeleted2,
    });
    btn = screen.getByRole("button", { name: /^delete$/i });
    fireEvent.click(btn); // arm
    btn = screen.getByRole("button", { name: /click again to confirm/i });
    fireEvent.click(btn); // would confirm — but in-flight guard no-ops

    // fsDelete must NOT have been called a second time.
    expect(mockFsDelete).toHaveBeenCalledTimes(1);
    // Menu still closes so the user gets immediate feedback.
    expect(onClose2).toHaveBeenCalledTimes(1);
    r2.unmount();

    // Resolve the first delete and confirm the guard released.
    await act(async () => {
      resolveFirst();
      await firstDelete;
    });

    // A third menu open on the same path after the RPC settled
    // should now fire a fresh delete.
    mockFsDelete.mockResolvedValueOnce(undefined);
    const r3 = renderMenu({
      path: "/vault/knowledge/article.md",
      onClose: vi.fn(),
      onDeleted: vi.fn(),
    });
    btn = screen.getByRole("button", { name: /^delete$/i });
    fireEvent.click(btn);
    btn = screen.getByRole("button", { name: /click again to confirm/i });
    fireEvent.click(btn);
    expect(mockFsDelete).toHaveBeenCalledTimes(2);
    r3.unmount();
  });
});
