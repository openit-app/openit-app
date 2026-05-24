import { useState } from "react";
import { Button } from "../../ui";
import { fsReveal, fsDelete } from "../../lib/api";
import { useToast } from "../../Toast";

export interface ContextMenuState {
  x: number;
  y: number;
  path: string;
  isDir: boolean;
}

// Module-level set of paths with an in-flight `fsDelete`. The
// ContextMenu component unmounts as soon as the user clicks the
// second-confirm — but the delete RPC keeps running. If the user
// right-clicks the same file again before the RPC settles and
// confirms again, a per-instance `useState` does not catch the
// duplicate (the new instance starts fresh). The module-level set
// survives unmount/remount and dedupes by absolute path. Entries
// are removed when the RPC settles. (PIN-6612 ensemble-review
// finding.)
const inFlightDeletes = new Set<string>();

export function ContextMenu({
  menu,
  onClose,
  onDeleted,
}: {
  menu: ContextMenuState;
  onClose: () => void;
  onDeleted: () => void;
}) {
  // Two-click delete confirm — `window.confirm` is blocked by Tauri
  // permissions; this is the inline alternative. Click "Delete" once →
  // button changes to "Click again to confirm" → second click inside the
  // open menu actually deletes. Closing the menu (overlay click,
  // selecting another item) resets it.
  const [deleteArmed, setDeleteArmed] = useState(false);
  // PIN-6612 in-flight guard. Once the second click fires the delete,
  // any subsequent activations (a stray click sneaking in before we
  // close the menu, a React re-render keeping the button mounted)
  // short-circuit. The button is also visually disabled while pending.
  const [deleting, setDeleting] = useState(false);
  const { show: showToast } = useToast();

  const handleDelete = () => {
    console.warn("[DELETE-DEBUG] explorer:ContextMenu handleDelete enter", { path: menu.path, isDir: menu.isDir, deleteArmed, deleting });
    if (deleting) {
      console.warn("[DELETE-DEBUG] explorer:ContextMenu guarded — local 'deleting' true");
      return;
    }
    if (!deleteArmed) {
      console.warn("[DELETE-DEBUG] explorer:ContextMenu arming first click");
      setDeleteArmed(true);
      return;
    }
    const path = menu.path;
    const filename = path.split("/").pop() ?? path;
    // Cross-instance guard: if a previous menu's delete for this same
    // path is still pending, surface a toast instead of silently no-op.
    // Silent failure was the original PIN-6612 bug; the in-flight guard
    // is meant to dedupe a true double-click race, not to swallow user
    // input.
    if (inFlightDeletes.has(path)) {
      console.warn("[DELETE-DEBUG] explorer:ContextMenu guarded — module-level inFlightDeletes already has", path);
      showToast({
        message: `Already deleting ${filename}…`,
        tone: "info",
      });
      onClose();
      return;
    }
    inFlightDeletes.add(path);
    setDeleting(true);
    // Close the menu first so the user gets immediate feedback that
    // the click registered; the in-flight delete still completes in
    // the background. Errors surface via toast — silent failure is
    // the bug PIN-6612 fixes.
    onClose();
    console.warn("[DELETE-DEBUG] explorer:ContextMenu calling fsDelete", { path });
    fsDelete(path)
      .then(() => {
        console.warn("[DELETE-DEBUG] explorer:ContextMenu fsDelete resolved", { path });
        showToast({ message: `Deleted ${filename}`, tone: "success" });
        onDeleted();
      })
      .catch((e) => {
        const reason = e instanceof Error ? e.message : String(e);
        console.error("[DELETE-DEBUG] explorer:ContextMenu fsDelete failed:", e);
        showToast({
          title: "Delete failed",
          message: reason,
          tone: "critical",
        });
      })
      .finally(() => {
        inFlightDeletes.delete(path);
        console.warn("[DELETE-DEBUG] explorer:ContextMenu finally — released lock for", path);
      });
  };

  return (
    <>
      <div
        className="context-menu-overlay"
        onClick={() => {
          onClose();
        }}
      />
      <div
        className="context-menu"
        style={{ top: menu.y, left: menu.x }}
      >
        <Button
          variant="ghost"
          className="context-menu-item"
          onClick={() => {
            fsReveal(menu.path).catch(console.error);
            onClose();
          }}
        >
          Reveal in Finder
        </Button>
        {!menu.isDir && (
          <Button
            variant="ghost"
            tone="destructive"
            className="context-menu-item"
            disabled={deleting}
            aria-busy={deleting}
            onClick={handleDelete}
          >
            {deleting
              ? "Deleting…"
              : deleteArmed
                ? "Click again to confirm"
                : "Delete"}
          </Button>
        )}
      </div>
    </>
  );
}
