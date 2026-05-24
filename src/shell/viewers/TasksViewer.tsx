/// TasksViewer — Kanban board for the Tasks primitive.
///
/// Three columns (Todo / In Progress / Complete) holding cards. A top
/// composer row creates new tasks; a chip row below it filters the
/// board by assignee. Cards are keyboard-focusable, click to open in
/// the markdown viewer, hover to reveal trash + status pill.
///
/// Replaces the prior flat-list grouping which had read as a regression
/// from the older Tickets UI.

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../ui";
import { TrashIcon } from "../TrashIcon";
import { confirmDelete } from "./viewerHelpers";
import { globalUserName } from "../../lib/api";
import {
  createTask,
  deleteTask,
  nextStatus,
  updateTaskAssignee,
  updateTaskStatus,
  type TaskStatus,
  type TaskSummary,
} from "../../lib/tasks";

interface TasksViewerProps {
  tasks: TaskSummary[];
  repo: string;
  /** Open a task file in the markdown viewer for read/edit. */
  onOpenTask: (path: string) => void | Promise<void>;
  /** Re-fetch the list after a mutation (delete, status change, new). */
  onChanged: () => void;
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  "todo": "Todo",
  "in-progress": "In Progress",
  "complete": "Complete",
};

const STATUS_ORDER: TaskStatus[] = ["todo", "in-progress", "complete"];

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
  const [newStatus, setNewStatus] = useState<TaskStatus>("todo");
  const [defaultAssignee, setDefaultAssignee] = useState("");
  const [creating, setCreating] = useState(false);
  const [assigneeFilter, setAssigneeFilter] = useState<string>(FILTER_ALL);

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

  const grouped: Record<TaskStatus, TaskSummary[]> = {
    todo: [],
    "in-progress": [],
    complete: [],
  };
  for (const t of filteredTasks) grouped[t.status].push(t);

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
      setNewStatus("todo");
      onChanged();
    } catch (err) {
      console.error("[tasks] create failed:", err);
    } finally {
      setCreating(false);
    }
  };

  const cycleStatus = async (task: TaskSummary) => {
    try {
      // Hand `nextStatus` itself in as the resolver so the write side
      // re-reads the current status from disk before advancing. Without
      // this, three rapid clicks on a `todo` row all close over the
      // stale `task.status === "todo"` prop snapshot and all collapse
      // into a single `in-progress` transition — the second and third
      // clicks "vanish".
      await updateTaskStatus(repo, task.filename, nextStatus);
      onChanged();
    } catch (err) {
      console.error("[tasks] status update failed:", err);
      onChanged();
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
            onChange={(e) => setNewStatus(e.target.value as TaskStatus)}
            disabled={creating}
            aria-label="Initial status for the new task"
          >
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
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

      {/* Kanban board — three equal-width columns, each independently
         scrollable when content overflows. Empty columns show a greyed
         "No tasks" line so the column never reads as a broken empty box. */}
      <div className="tasks-kanban">
        {STATUS_ORDER.map((status) => {
          const items = grouped[status];
          return (
            <section
              key={status}
              className={`tasks-column tasks-column-${status}`}
              aria-label={`${STATUS_LABEL[status]} column`}
            >
              <header className="tasks-column-header">
                <span className={`tasks-column-dot tasks-status-${status}`} aria-hidden />
                <span className="tasks-column-title">{STATUS_LABEL[status]}</span>
                <span className="tasks-column-count">{items.length}</span>
              </header>
              <div className="tasks-column-body">
                {items.length === 0 ? (
                  <p className="tasks-column-empty">No tasks</p>
                ) : (
                  items.map((task) => (
                    <TaskCard
                      key={task.filename}
                      task={task}
                      repo={repo}
                      onOpen={() => void onOpenTask(task.path)}
                      onCycle={() => void cycleStatus(task)}
                      onAssigneeChanged={onChanged}
                      onDelete={() => void remove(task)}
                    />
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

// ── TaskCard ─────────────────────────────────────────────────────────

interface TaskCardProps {
  task: TaskSummary;
  repo: string;
  onOpen: () => void;
  onCycle: () => void;
  onAssigneeChanged: () => void;
  onDelete: () => void;
}

function TaskCard({ task, repo, onOpen, onCycle, onAssigneeChanged, onDelete }: TaskCardProps) {
  const ts = formatTimestamp(task.createdAt);
  return (
    <div className="tasks-card-wrapper">
      <button
        type="button"
        className={`tasks-card${task.status === "complete" ? " tasks-card-done" : ""}`}
        onClick={onOpen}
        title="Open this task"
      >
        <span className="tasks-card-title">{task.title}</span>
        <span className="tasks-card-meta">
          <AssigneeChip task={task} repo={repo} onChanged={onAssigneeChanged} />
          {ts && <span className="tasks-card-ts">{ts}</span>}
        </span>
      </button>
      <button
        type="button"
        className={`tasks-card-status tasks-status-${task.status}`}
        onClick={(e) => {
          e.stopPropagation();
          onCycle();
        }}
        title="Click to advance status"
        aria-label={`Status: ${STATUS_LABEL[task.status]}. Click to cycle.`}
      >
        {STATUS_LABEL[task.status]}
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
