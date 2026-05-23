import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ENTITY_META, type EntityKind } from "./entityIcons";
import { TrashIcon } from "./TrashIcon";
import { PlayIcon } from "./PlayIcon";
import { Button } from "../ui";

export type { EntityKind };

export type EntityCard = {
  /** Stable React key. */
  key: string;
  title: string;
  /** Short subtitle / description. */
  description?: string;
  /** Right-aligned metadata text (count, date, tag). */
  meta?: ReactNode;
  /** A single optional pill below the description (status, etc.). */
  badge?: { label: string; tone?: "neutral" | "ok" | "warn" | "info" };
  /** Override the kind-shared glyph for this card — used for image
   *  thumbnails on attachment / library cards. Falls back to the
   *  kind icon when omitted. */
  icon?: ReactNode;
  /** Per-card color tone override. When set, the card's glyph uses
   *  this tone instead of inheriting from the parent grid's kind. */
  cardTone?: "accent" | "sage" | "ochre" | "link" | "clay" | "neutral";
  onClick?: () => void;
  /** When set, dragging files from the desktop onto this card calls
   *  the handler with the dropped File list. Used by the filestores-
   *  list view so users can drop files directly onto a collection
   *  card without first opening it. */
  onFilesDropped?: (files: File[]) => void | Promise<void>;
  /** When set, the card shows a hover-revealed trash button that
   *  invokes this handler. The handler is responsible for any
   *  confirmation prompt — the grid just wires the click + stops
   *  propagation so the card's `onClick` doesn't fire. Also bound
   *  to Backspace/Delete when the card is focused, and exposed
   *  as a "Delete" entry in the right-click context menu.
   *
   *  PIN-6612: while the returned promise is pending, the grid keeps
   *  the button disabled and ignores duplicate activations keyed by
   *  `card.key` — repeated clicks ("slamming the delete button") no
   *  longer fire multiple backend deletes. Handlers should additionally
   *  show a user-visible error (toast) on rejection — the grid logs
   *  to the devtools console as a backstop. */
  onDelete?: () => void | Promise<void>;
  /** When set, the right-click context menu shows a "Reveal in
   *  Finder" entry that calls this handler. */
  onReveal?: () => void | Promise<void>;
  /** When set, the card shows an always-visible play button that
   *  invokes this handler. Used by the scripts-folder cards to
   *  spawn `node <script>` and route the viewer to the captured
   *  stdout/stderr. The handler is responsible for any guard
   *  prompts — the grid just wires the click + stops propagation
   *  so the card's onClick (which would open the file) doesn't
   *  fire alongside the run. */
  onRun?: () => void | Promise<void>;
  /** When true, the run affordance shows a spinner instead of the
   *  play glyph and rejects pointer events. Lets callers surface a
   *  "running…" state for long scripts without re-implementing the
   *  whole card. */
  running?: boolean;
  /** When set, the card shows an "Add to Claude" hover button that
   *  injects a reference (slash command, file path, etc.) into the
   *  active Claude session. */
  onAddToClaude?: () => void | Promise<void>;
};

/**
 * Visual primitive for every entity-list surface. Each card has the
 * same chrome (border / shadow / hover lift) and a kind-specific
 * glyph + accent so people / agents / knowledge / attachments etc.
 * read as one family.
 */
export function EntityCardGrid({
  kind,
  cards,
  empty,
}: {
  kind: EntityKind;
  cards: EntityCard[];
  /** Optional copy shown when `cards` is empty. */
  empty?: ReactNode;
}) {
  const meta = ENTITY_META[kind];
  const [menu, setMenu] = useState<{
    cardKey: string;
    x: number;
    y: number;
  } | null>(null);

  // Per-card delete in-flight tracking (PIN-6612). Keyed by card.key so
  // a file-watcher-triggered re-render (which rebuilds the cards array)
  // doesn't release the lock while the underlying delete is still
  // pending. State is mirrored in a ref because two pointer events in
  // the same React event cycle both observe the same stale state — the
  // ref read is synchronous and catches the race.
  const [deleting, setDeleting] = useState<ReadonlySet<string>>(() => new Set());
  const deletingRef = useRef<Set<string>>(new Set());

  const runDelete = useCallback(
    async (cardKey: string, fn: () => void | Promise<void>) => {
      if (deletingRef.current.has(cardKey)) return;
      deletingRef.current.add(cardKey);
      setDeleting(new Set(deletingRef.current));
      try {
        await fn();
      } catch (err) {
        // Handlers own user-visible error surfacing (toast). Logging
        // here is a backstop so a handler that forgets isn't fully
        // silent in the devtools console.
        console.error(`[entity-card-grid] delete handler threw for ${cardKey}:`, err);
      } finally {
        deletingRef.current.delete(cardKey);
        setDeleting(new Set(deletingRef.current));
      }
    },
    [],
  );

  // Dismiss the menu on Escape or any click outside.
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  if (cards.length === 0) {
    return (
      <div className={`entity-grid entity-grid-empty entity-tone-${meta.tone}`}>
        <div className="entity-grid-empty-glyph" aria-hidden>
          {meta.icon}
        </div>
        {empty && <div className="entity-grid-empty-body">{empty}</div>}
      </div>
    );
  }

  const activeCard = menu ? cards.find((c) => c.key === menu.cardKey) : null;
  const activeDeleting = activeCard ? deleting.has(activeCard.key) : false;

  return (
    <div className={`entity-grid entity-tone-${meta.tone}`}>
      {cards.map((c) => (
        <EntityCardItem
          key={c.key}
          card={c}
          fallbackIcon={meta.icon}
          isDeleting={deleting.has(c.key)}
          runDelete={runDelete}
          onContextMenu={(x, y) => {
            if (!c.onDelete && !c.onReveal && !c.onAddToClaude) return;
            setMenu({ cardKey: c.key, x, y });
          }}
        />
      ))}
      {menu && activeCard && (
        <>
          <div
            className="context-menu-overlay"
            onClick={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu(null);
            }}
          />
          <div
            className="context-menu"
            style={{ top: menu.y, left: menu.x }}
            role="menu"
          >
            {activeCard.onAddToClaude && (
              <Button
                variant="ghost"
                className="context-menu-item"
                onClick={() => {
                  void activeCard.onAddToClaude?.();
                  setMenu(null);
                }}
              >
                Add to Claude
              </Button>
            )}
            {activeCard.onReveal && (
              <Button
                variant="ghost"
                className="context-menu-item"
                onClick={() => {
                  void activeCard.onReveal?.();
                  setMenu(null);
                }}
              >
                Reveal in Finder
              </Button>
            )}
            {activeCard.onDelete && (
              <Button
                variant="ghost"
                tone="destructive"
                className="context-menu-item"
                disabled={activeDeleting}
                onClick={() => {
                  // The onDelete handler runs its own window.confirm()
                  // — duplicating it here with an arm-twice click
                  // forced three clicks to delete from the menu. Drop
                  // straight into the handler.
                  const handler = activeCard.onDelete;
                  if (!handler) return;
                  void runDelete(activeCard.key, handler);
                  setMenu(null);
                }}
              >
                {activeDeleting ? "Deleting…" : "Delete"}
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function EntityCardItem({
  card: c,
  fallbackIcon,
  isDeleting,
  runDelete,
  onContextMenu,
}: {
  card: EntityCard;
  fallbackIcon: ReactNode;
  isDeleting: boolean;
  runDelete: (cardKey: string, fn: () => void | Promise<void>) => Promise<void>;
  onContextMenu: (x: number, y: number) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const Tag = c.onClick ? "button" : "div";
  const dropProps = c.onFilesDropped
    ? {
        onDragOver: (e: React.DragEvent) => {
          if (Array.from(e.dataTransfer.types).includes("Files")) {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = "copy";
            setDragOver(true);
          }
        },
        onDragLeave: () => setDragOver(false),
        onDrop: async (e: React.DragEvent) => {
          // preventDefault MUST run before any early return — without
          // it the Tauri webview falls back to its default drop
          // behavior (navigate to the file URL) and the SPA unloads.
          e.preventDefault();
          e.stopPropagation();
          setDragOver(false);
          const files = Array.from(e.dataTransfer.files ?? []);
          if (files.length === 0) return;
          await c.onFilesDropped?.(files);
        },
      }
    : {};
  // Keyboard delete: a focused clickable card responds to Backspace
  // or Delete by triggering its onDelete handler. The handler runs
  // its own confirm() so a fat-finger keystroke can't silently nuke
  // a file. Only clickable cards (which render as <button>) can
  // receive focus, so this is naturally scoped.
  //
  // PIN-6612: route through runDelete so a held-down Backspace key
  // doesn't fire repeat invocations while the first delete is in
  // flight.
  const onKeyDown = c.onDelete
    ? (e: React.KeyboardEvent) => {
        if (e.key === "Backspace" || e.key === "Delete") {
          e.preventDefault();
          const handler = c.onDelete;
          if (!handler || isDeleting) return;
          void runDelete(c.key, handler);
        }
      }
    : undefined;
  const card = (
    <Tag
      type={c.onClick ? "button" : undefined}
      className={`entity-card ${c.onClick ? "entity-card-clickable" : ""}${
        dragOver ? " entity-card-drag" : ""
      }${c.cardTone ? ` entity-tone-${c.cardTone}` : ""}`}
      onClick={c.onClick}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => {
        if (!c.onDelete && !c.onReveal && !c.onAddToClaude) return;
        e.preventDefault();
        onContextMenu(e.clientX, e.clientY);
      }}
      {...dropProps}
    >
      <span className="entity-card-glyph" aria-hidden>
        {c.icon ?? fallbackIcon}
      </span>
      <div className="entity-card-body">
        <div className="entity-card-row">
          <span className="entity-card-title">{c.title}</span>
          {c.meta !== undefined && (
            <span className="entity-card-meta">{c.meta}</span>
          )}
        </div>
        {c.description && (
          <span className="entity-card-desc">{c.description}</span>
        )}
        {c.badge && (
          <span
            className={`entity-card-badge entity-card-badge-${
              c.badge.tone ?? "neutral"
            }`}
          >
            {c.badge.label}
          </span>
        )}
      </div>
    </Tag>
  );
  if (!c.onDelete && !c.onRun) return card;
  // Action buttons (run, delete) have to sit OUTSIDE the card's
  // <button> element — nesting interactive controls inside a button
  // is invalid HTML and the click target collapses. Wrap card +
  // overlays in a relatively-positioned div and absolute-position
  // each action at the top-right; CSS hides them until the wrapper
  // is hovered. Run sits to the LEFT of delete so the destructive
  // gesture stays on the far edge.
  return (
    <div className="entity-card-wrapper">
      {card}
      {c.onRun && (
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          className="entity-card-run"
          title={c.running ? `Running ${c.title}…` : `Run ${c.title}`}
          aria-label={c.running ? `Running ${c.title}` : `Run ${c.title}`}
          aria-busy={c.running}
          disabled={c.running}
          onClick={(e) => {
            e.stopPropagation();
            if (c.running) return;
            void c.onRun?.();
          }}
        >
          {c.running ? <CardSpinner /> : <PlayIcon />}
        </Button>
      )}
      {c.onDelete && (
        <Button
          variant="ghost"
          tone="destructive"
          size="sm"
          iconOnly
          className="entity-card-delete"
          title={isDeleting ? `Deleting ${c.title}…` : `Delete ${c.title}`}
          aria-label={isDeleting ? `Deleting ${c.title}` : `Delete ${c.title}`}
          aria-busy={isDeleting}
          disabled={isDeleting}
          // Pointer flow: fire on mousedown, not click. The button's
          // `:active` rule does a translateY(1px) — between mousedown
          // and mouseup the button moves out from under the cursor,
          // mouseup lands on the card behind it, and click never fires
          // on the trash button itself. mousedown is the actual commit
          // signal we want for pointer activations.
          //
          // PIN-6612 click-storm guard: runDelete dedupes by card.key
          // for the lifetime of the in-flight promise. The disabled
          // attribute above also blocks default activation, but we
          // still guard here defensively — mousedown reaches us even
          // on a disabled button in some webview builds.
          onMouseDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
            const handler = c.onDelete;
            if (!handler || isDeleting) return;
            void runDelete(c.key, handler);
          }}
          // Keyboard flow: Enter/Space activation dispatches a click
          // *without* a preceding mousedown — those clicks have
          // `event.detail === 0`. Invoke onDelete here so keyboard
          // users aren't locked out. Pointer-originated clicks
          // (detail >= 1) are already handled above and we just eat
          // them to keep the card behind from receiving the click.
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            if (e.detail === 0) {
              const handler = c.onDelete;
              if (!handler || isDeleting) return;
              void runDelete(c.key, handler);
            }
          }}
        >
          <TrashIcon />
        </Button>
      )}
    </div>
  );
}

/// 14px spinner shown in place of the play glyph while a script is
/// running. Reuses the global `sc-spin` keyframe defined in
/// `App.css`; the SVG is local so we don't pull in another helper.
function CardSpinner() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      style={{ animation: "sc-spin 0.85s linear infinite" }}
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" />
    </svg>
  );
}
