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
    if (deleting) return;
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    const path = menu.path;
    const filename = path.split("/").pop() ?? path;
    // Cross-instance guard: if a previous menu's delete for this same
    // path is still pending, silently no-op. Otherwise the user can
    // right-click the file, confirm, the menu closes, they re-open the
    // menu before the RPC settles, and confirm again → duplicate
    // fsDelete fires. The first one wins; the second usually gets
    // ENOENT which we'd surface as a critical toast.
    if (inFlightDeletes.has(path)) {
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
    fsDelete(path)
      .then(() => {
        showToast({ message: `Deleted ${filename}`, tone: "success" });
        onDeleted();
      })
      .catch((e) => {
        const reason = e instanceof Error ? e.message : String(e);
        console.error("delete failed:", e);
        showToast({
          title: "Delete failed",
          message: reason,
          tone: "critical",
        });
      })
      .finally(() => {
        inFlightDeletes.delete(path);
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
