import { useState } from "react";
import { Button } from "../../ui";
import { fsReveal, fsDelete } from "../../lib/api";

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
            onClick={() => {
              if (!deleteArmed) {
                setDeleteArmed(true);
                return;
              }
              const path = menu.path;
              onClose();
              fsDelete(path)
                .then(() => onDeleted())
                .catch((e) => {
                  console.error("delete failed:", e);
                });
            }}
          >
            {deleteArmed ? "Click again to confirm" : "Delete"}
          </Button>
        )}
      </div>
    </>
  );
}
