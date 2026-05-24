/// TasksViewer — Kanban board for the Tasks primitive.
///
/// Columns are driven by `.openit/tasks-stages.json` (loaded via
/// `loadStages`). A top composer row creates new tasks; a chip row
/// below it filters the board by assignee. Cards are draggable
/// between columns to change status — native HTML5 drag-drop, no
/// library — and clicking a card opens it in the markdown viewer.
///
/// Tasks whose `status` doesn't match any configured stage land in a
/// synthetic "Unsorted" column appended on the right (only rendered
/// when non-empty) so a typo or a deleted stage never silently drops
/// a task from view.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../ui";
import { TrashIcon } from "../TrashIcon";
import { confirmDelete } from "./viewerHelpers";
import { globalUserName } from "../../lib/api";
import {
  createTask,
  deleteTask,
  updateTaskAssignee,
  updateTaskStatus,
  type TaskSummary,
} from "../../lib/tasks";
import {
  DEFAULT_STAGES,
  UNSORTED_STAGE,
  loadStages,
  stageForStatus,
} from "../../lib/taskStages";

interface TasksViewerProps {
  tasks: TaskSummary[];
  repo: string;
  /** Open a task file in the markdown viewer for read/edit. */
  onOpenTask: (path: string) => void | Promise<void>;
  /** Re-fetch the list after a mutation (delete, status change, new). */
  onChanged: () => void;
}

/// Module-level cache for the user's git name — read once per app
/// session. The Tauri command shells out to git, which is fast but not
/// free; caching means every TasksViewer mount and every "+ New" form
/// reset reuses the same value. `null` means we've resolved and the
/// user has no git name set (composer defaults to "me"); `undefined`
/// means we haven't fetched yet.
let cachedUserName: string | null | undefined;

async function resolveDefaultAssignee(): Promise<string> {
  if (cachedUserName !== undefined) return cachedUserName ?? "me";
  try {
    cachedUserName = await globalUserName();
  } catch (err) {
    console.warn("[tasks] failed to read git user.name:", err);
    cachedUserName = null;
  }
  return cachedUserName ?? "me";
}

/// "All" sentinel for the assignee filter. Distinct from the empty
/// string so unassigned tasks don't collapse into the "All" pseudo-bucket.
const FILTER_ALL = "__all__";
const FILTER_MINE = "__mine__";

/// Drag pixel threshold — pointer must move more than this between
/// pointerdown and the corresponding click for the click to be
/// suppressed. Five pixels is the conventional "is this a drag or a
/// fidget" threshold; matches what most native UI toolkits use.
const DRAG_SUPPRESS_THRESHOLD_PX = 5;

/// MIME-ish key for the drag payload. `text/plain` is the safest
/// fallback across browsers + Tauri's WebKit/WebView2 (custom MIME
/// types occasionally drop on cross-frame drags).
const DRAG_MIME = "text/plain";

function formatTimestamp(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const month = d.toLocaleString(undefined, { month: "short" });
  return sameYear ? `${month} ${d.getDate()}` : `${month} ${d.getDate()}, ${d.getFullYear()}`;
}

export function TasksViewer({ tasks, repo, onOpenTask, onChanged }: TasksViewerProps) {
  const [newTitle, setNewTitle] = useState("");
  const [newAssignee, setNewAssignee] = useState("");
  const [defaultAssignee, setDefaultAssignee] = useState("");
  const [creating, setCreating] = useState(false);
  const [assigneeFilter, setAssigneeFilter] = useState<string>(FILTER_ALL);
  const [stages, setStages] = useState<string[]>(() => [...DEFAULT_STAGES]);
  const [newStatus, setNewStatus] = useState<string>(DEFAULT_STAGES[0]);
  const [dragHoverStage, setDragHoverStage] = useState<string | null>(null);

  // Load the configured stage list on mount. Re-runs when `tasks`
  // changes since the parent re-fetches on `fsTick` bumps — that
  // already covers the "CC edited tasks-stages.json out-of-band" path
  // because any file change in the vault flips `fsTick`. Cheaper than
  // wiring `fsTick` through as a prop just to mirror the reload.
  useEffect(() => {
    let cancelled = false;
    void loadStages(repo).then((loaded) => {
      if (cancelled) return;
      setStages(loaded);
      // Keep the composer's default stage in sync — if the user has
      // already picked a custom one that's still valid, leave it
      // alone, otherwise snap to the first configured stage.
      setNewStatus((current) => (loaded.includes(current) ? current : loaded[0] ?? DEFAULT_STAGES[0]));
    });
    return () => {
      cancelled = true;
    };
  }, [repo, tasks]);

  // Resolve the default assignee once on mount. Once it lands, seed
  // the composer's assignee field (only if the user hasn't started
  // typing into it yet — `newAssignee === ""` is the "untouched"
  // sentinel since the field is one-shot text input).
  useEffect(() => {
    let cancelled = false;
    void resolveDefaultAssignee().then((name) => {
      if (cancelled) return;
      setDefaultAssignee(name);
      setNewAssignee((current) => (current === "" ? name : current));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Build the unique-assignee list from the current task set. Empty
  // assignees roll up under "Unassigned". Sorted alphabetically so the
  // chip order is stable across refreshes (without sort, the chips
  // would reorder every time a task is added/removed).
  const assignees = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) {
      const v = t.assignee.trim();
      if (v) set.add(v);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [tasks]);

  const hasUnassigned = useMemo(() => tasks.some((t) => !t.assignee.trim()), [tasks]);

  const filteredTasks = useMemo(() => {
    if (assigneeFilter === FILTER_ALL) return tasks;
    if (assigneeFilter === FILTER_MINE) {
      const me = defaultAssignee.trim().toLowerCase();
      if (!me) return tasks;
      return tasks.filter((t) => t.assignee.trim().toLowerCase() === me);
    }
    if (assigneeFilter === "") {
      // Empty-string filter is the explicit "Unassigned" bucket.
      return tasks.filter((t) => !t.assignee.trim());
    }
    return tasks.filter((t) => t.assignee.trim() === assigneeFilter);
  }, [tasks, assigneeFilter, defaultAssignee]);

  // Bucket filtered tasks into the configured stages plus the
  // synthetic "Unsorted" overflow. We always allocate buckets for
  // every configured stage so empty columns still render — that's
  // what gives the user a drop target for stages they haven't filled
  // yet. The "Unsorted" bucket is only shown when non-empty.
  const buckets = useMemo(() => {
    const map = new Map<string, TaskSummary[]>();
    for (const stage of stages) map.set(stage, []);
    map.set(UNSORTED_STAGE, []);
    for (const t of filteredTasks) {
      const stage = stageForStatus(t.status, stages);
      const bucket = map.get(stage);
      if (bucket) bucket.push(t);
    }
    return map;
  }, [filteredTasks, stages]);

  const unsortedCount = buckets.get(UNSORTED_STAGE)?.length ?? 0;

  const createNew = async () => {
    const title = newTitle.trim();
    if (!title || creating) return;
    setCreating(true);
    try {
      const assignee = newAssignee.trim() || defaultAssignee;
      await createTask(repo, { title, status: newStatus, assignee });
      setNewTitle("");
      // Reset assignee to the default so the next task picks it up
      // without the user re-typing. Don't blank it — that would force
      // the user to retype their own name for every task.
      setNewAssignee(defaultAssignee);
      setNewStatus(stages[0] ?? DEFAULT_STAGES[0]);
      onChanged();
    } catch (err) {
      console.error("[tasks] create failed:", err);
    } finally {
      setCreating(false);
    }
  };

  const remove = async (task: TaskSummary) => {
    const ok = await confirmDelete(
      `Delete "${task.title}"?\n\nThis cannot be undone.`,
      "Delete task?",
    );
    if (!ok) return;
    try {
      await deleteTask(repo, task.filename);
      onChanged();
    } catch (err) {
      console.error("[tasks] delete failed:", err);
    }
  };

  /// Drop handler — fires when the user releases a dragged card over
  /// a stage column. Writes the new stage as the task's status and
  /// triggers a parent re-fetch. No-op when the dropped task already
  /// belongs to that stage (avoids a needless disk write + churn).
  const handleDrop = useCallback(
    async (stage: string, filename: string) => {
      setDragHoverStage(null);
      if (!filename) return;
      const task = tasks.find((t) => t.filename === filename);
      if (task && stageForStatus(task.status, stages) === stage) return;
      try {
        await updateTaskStatus(repo, filename, () => stage);
        onChanged();
      } catch (err) {
        console.error("[tasks] drop status update failed:", err);
        onChanged();
      }
    },
    [tasks, stages, repo, onChanged],
  );

  return (
    <div className="tasks-viewer">
      {/* Composer — a single row with the same input chrome as elsewhere
         in the app. Wrapped in its own .tasks-toolbar block so the
         composer + filter share a consistent left/right inset and the
         "+ New" button never sits flush against the pane's right edge. */}
      <div className="tasks-toolbar">
        <div className="tasks-composer">
          <input
            type="text"
            className="tasks-input tasks-input-title"
            placeholder="Add a task and press Enter…"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void createNew();
              }
            }}
            disabled={creating}
            aria-label="New task title"
          />
          <input
            type="text"
            className="tasks-input tasks-input-assignee"
            placeholder="Assignee"
            aria-label="Assignee for the new task"
            value={newAssignee}
            onChange={(e) => setNewAssignee(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void createNew();
              }
            }}
            disabled={creating}
          />
          <select
            className="tasks-input tasks-input-status"
            value={newStatus}
            onChange={(e) => setNewStatus(e.target.value)}
            disabled={creating}
            aria-label="Initial status for the new task"
          >
            {stages.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void createNew()}
            disabled={creating || newTitle.trim().length === 0}
          >
            + New
          </Button>
        </div>

        {/* Assignee filter chip row. "All" is the default; "Mine" is the
           convenience for the current git user; the rest are unique
           assignees from the current task set. "Unassigned" appears
           only when at least one task has no assignee. */}
        <div className="tasks-filter" role="group" aria-label="Filter by assignee">
          <button
            type="button"
            className={`tasks-filter-chip${assigneeFilter === FILTER_ALL ? " tasks-filter-chip-active" : ""}`}
            onClick={() => setAssigneeFilter(FILTER_ALL)}
            aria-pressed={assigneeFilter === FILTER_ALL}
          >
            All
          </button>
          {defaultAssignee && (
            <button
              type="button"
              className={`tasks-filter-chip${assigneeFilter === FILTER_MINE ? " tasks-filter-chip-active" : ""}`}
              onClick={() => setAssigneeFilter(FILTER_MINE)}
              aria-pressed={assigneeFilter === FILTER_MINE}
              title={`Tasks assigned to ${defaultAssignee}`}
            >
              Mine
            </button>
          )}
          {assignees.map((a) => (
            <button
              key={a}
              type="button"
              className={`tasks-filter-chip${assigneeFilter === a ? " tasks-filter-chip-active" : ""}`}
              onClick={() => setAssigneeFilter(a)}
              aria-pressed={assigneeFilter === a}
            >
              {a}
            </button>
          ))}
          {hasUnassigned && (
            <button
              type="button"
              className={`tasks-filter-chip${assigneeFilter === "" ? " tasks-filter-chip-active" : ""}`}
              onClick={() => setAssigneeFilter("")}
              aria-pressed={assigneeFilter === ""}
            >
              Unassigned
            </button>
          )}
        </div>
      </div>

      {/* Kanban board — one column per configured stage. Each column
         is its own drop target. Empty columns still render so the
         user can drop a card into a stage that doesn't have anything
         in it yet. The synthetic "Unsorted" column only appears when
         non-empty (otherwise the board would have a permanently empty
         column trailing every legitimate stage). */}
      <div className="tasks-kanban">
        {stages.map((stage) => {
          const items = buckets.get(stage) ?? [];
          return (
            <StageColumn
              key={stage}
              stage={stage}
              items={items}
              repo={repo}
              isDragHover={dragHoverStage === stage}
              isDroppable
              onDragEnter={() => setDragHoverStage(stage)}
              onDragLeave={(target) => {
                // Only clear when leaving the column itself, not when
                // crossing between child cards (which fire dragleave
                // on the column too).
                if (target === stage) setDragHoverStage(null);
              }}
              onDrop={(filename) => void handleDrop(stage, filename)}
              onOpenTask={onOpenTask}
              onAssigneeChanged={onChanged}
              onDeleteTask={(task) => void remove(task)}
            />
          );
        })}
        {unsortedCount > 0 && (
          <StageColumn
            key={UNSORTED_STAGE}
            stage={UNSORTED_STAGE}
            items={buckets.get(UNSORTED_STAGE) ?? []}
            repo={repo}
            isDragHover={false}
            // Not droppable — dropping here would write the literal
            // string "Unsorted" as a status, which isn't a real
            // stage. Users should drop into a configured column.
            isDroppable={false}
            onDragEnter={() => undefined}
            onDragLeave={() => undefined}
            onDrop={() => undefined}
            onOpenTask={onOpenTask}
            onAssigneeChanged={onChanged}
            onDeleteTask={(task) => void remove(task)}
          />
        )}
      </div>
    </div>
  );
}

// ── StageColumn ──────────────────────────────────────────────────────

interface StageColumnProps {
  stage: string;
  items: TaskSummary[];
  repo: string;
  isDragHover: boolean;
  isDroppable: boolean;
  onDragEnter: () => void;
  onDragLeave: (stage: string) => void;
  onDrop: (filename: string) => void;
  onOpenTask: (path: string) => void | Promise<void>;
  onAssigneeChanged: () => void;
  onDeleteTask: (task: TaskSummary) => void;
}

function StageColumn({
  stage,
  items,
  repo,
  isDragHover,
  isDroppable,
  onDragEnter,
  onDragLeave,
  onDrop,
  onOpenTask,
  onAssigneeChanged,
  onDeleteTask,
}: StageColumnProps) {
  return (
    <section
      className={`tasks-column${isDragHover ? " tasks-column-drop-target" : ""}`}
      aria-label={`${stage} column`}
    >
      <header className="tasks-column-header">
        <span className="tasks-column-title">{stage}</span>
        <span className="tasks-column-count">{items.length}</span>
      </header>
      <div
        className="tasks-column-body"
        // Drag-drop wiring — `onDragOver` MUST call preventDefault
        // for the drop event to fire at all (browser default is to
        // refuse the drop). `onDragEnter` flips the hover highlight;
        // `onDragLeave` clears it. We pass `stage` to onDragLeave so
        // the parent can ignore leave events from child cards.
        onDragOver={
          isDroppable
            ? (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
              }
            : undefined
        }
        onDragEnter={isDroppable ? () => onDragEnter() : undefined}
        onDragLeave={
          isDroppable
            ? (e) => {
                // currentTarget is the column body; relatedTarget is
                // wherever the pointer just entered. If it's still
                // inside the column, ignore — we only want to clear
                // when the pointer truly leaves.
                const next = e.relatedTarget as Node | null;
                if (next && e.currentTarget.contains(next)) return;
                onDragLeave(stage);
              }
            : undefined
        }
        onDrop={
          isDroppable
            ? (e) => {
                e.preventDefault();
                const filename = e.dataTransfer.getData(DRAG_MIME);
                onDrop(filename);
              }
            : undefined
        }
      >
        {items.length === 0 ? (
          <p className="tasks-column-empty">No tasks</p>
        ) : (
          items.map((task) => (
            <TaskCard
              key={task.filename}
              task={task}
              repo={repo}
              onOpen={() => void onOpenTask(task.path)}
              onAssigneeChanged={onAssigneeChanged}
              onDelete={() => onDeleteTask(task)}
            />
          ))
        )}
      </div>
    </section>
  );
}

// ── TaskCard ─────────────────────────────────────────────────────────

interface TaskCardProps {
  task: TaskSummary;
  repo: string;
  onOpen: () => void;
  onAssigneeChanged: () => void;
  onDelete: () => void;
}

function TaskCard({ task, repo, onOpen, onAssigneeChanged, onDelete }: TaskCardProps) {
  const ts = formatTimestamp(task.createdAt);
  // Track where the pointer was when the user pressed down so we can
  // distinguish a click (open the task) from a drag (move it). If the
  // pointer moves more than DRAG_SUPPRESS_THRESHOLD_PX between down
  // and up, we treat the gesture as a drag and suppress the click —
  // without this, every drop also opens the task in the markdown
  // viewer, which is noisy and breaks the user's mental model.
  const pointerDown = useRef<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const suppressClick = useRef(false);

  return (
    <div
      className={`tasks-card-wrapper${isDragging ? " tasks-card-dragging" : ""}`}
      // `draggable` on the wrapper (rather than the inner button)
      // because the wrapper hosts the trash button + assignee chip
      // as siblings of the card — we want the whole card surface to
      // be a drag handle, including the area around the chip.
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_MIME, task.filename);
        e.dataTransfer.effectAllowed = "move";
        setIsDragging(true);
        // Always suppress the next click after a drag start — even
        // if the pointer barely moved, the drag itself is the
        // intent. Cleared on the next pointerdown.
        suppressClick.current = true;
      }}
      onDragEnd={() => {
        setIsDragging(false);
        // Clear the suppression flag a tick later so the click
        // event (which fires after dragend) sees it set.
        setTimeout(() => {
          suppressClick.current = false;
        }, 0);
      }}
      onPointerDown={(e) => {
        pointerDown.current = { x: e.clientX, y: e.clientY };
        suppressClick.current = false;
      }}
      onPointerUp={(e) => {
        const start = pointerDown.current;
        pointerDown.current = null;
        if (!start) return;
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        if (Math.hypot(dx, dy) > DRAG_SUPPRESS_THRESHOLD_PX) {
          suppressClick.current = true;
        }
      }}
    >
      <button
        type="button"
        className="tasks-card"
        onClick={(e) => {
          if (suppressClick.current) {
            e.preventDefault();
            return;
          }
          onOpen();
        }}
        title="Open this task (drag to change status)"
      >
        <span className="tasks-card-title">{task.title}</span>
        <span className="tasks-card-meta">
          <AssigneeChip task={task} repo={repo} onChanged={onAssigneeChanged} />
          {ts && <span className="tasks-card-ts">{ts}</span>}
        </span>
      </button>
      <Button
        variant="ghost"
        tone="destructive"
        size="sm"
        iconOnly
        className="tasks-card-delete"
        title="Delete task"
        aria-label="Delete task"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        <TrashIcon />
      </Button>
    </div>
  );
}

/// Inline-editable assignee for a single card. Click swaps in a text
/// input; blur or Enter commits the new value; Escape cancels.
interface AssigneeChipProps {
  task: TaskSummary;
  repo: string;
  onChanged: () => void;
}

function AssigneeChip({ task, repo, onChanged }: AssigneeChipProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.assignee);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Keep the local draft in sync when the parent re-fetches and a new
  // assignee lands on the same filename (e.g. CC writes the file
  // out-of-band).
  useEffect(() => {
    if (!editing) setDraft(task.assignee);
  }, [task.assignee, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = async () => {
    if (saving) return;
    const next = draft.trim();
    if (next === task.assignee) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await updateTaskAssignee(repo, task.filename, next);
      onChanged();
    } catch (err) {
      console.error("[tasks] assignee update failed:", err);
      setDraft(task.assignee);
    } finally {
      setSaving(false);
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        className="tasks-assignee-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            void commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setDraft(task.assignee);
            setEditing(false);
          }
        }}
        disabled={saving}
        aria-label="Edit assignee"
      />
    );
  }

  const display = task.assignee.trim() || "Unassigned";
  return (
    <span
      role="button"
      tabIndex={0}
      className={`tasks-assignee${task.assignee ? "" : " tasks-assignee-empty"}`}
      onClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          setEditing(true);
        }
      }}
      title={task.assignee ? `Assigned to ${task.assignee}. Click to edit.` : "Unassigned. Click to assign."}
    >
      {display}
    </span>
  );
}
