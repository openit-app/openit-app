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
