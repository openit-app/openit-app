/// TasksViewer — the new Inbox.
///
/// Three sections (Todo / In Progress / Complete). Each task card shows
/// the status pill, the title (click to open), the assignee chip
/// (click to edit), and a delete button. A `+ New task` row at the top
/// composes a title + assignee and creates a draft task.
///
/// Three fields per task: name / assignee / status. Assignee defaults
/// to the user's global `git config user.name` (or "me" when unset),
/// is free-form text, and edits inline on each row.

import { useEffect, useRef, useState } from "react";
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
  "in-progress": "In progress",
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

export function TasksViewer({ tasks, repo, onOpenTask, onChanged }: TasksViewerProps) {
  const [newTitle, setNewTitle] = useState("");
  const [newAssignee, setNewAssignee] = useState("");
  const [defaultAssignee, setDefaultAssignee] = useState("");
  const [creating, setCreating] = useState(false);

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

  const grouped: Record<TaskStatus, TaskSummary[]> = {
    todo: [],
    "in-progress": [],
    complete: [],
  };
  for (const t of tasks) grouped[t.status].push(t);

  const createNew = async () => {
    const title = newTitle.trim();
    if (!title || creating) return;
    setCreating(true);
    try {
      const assignee = newAssignee.trim() || defaultAssignee;
      await createTask(repo, { title, assignee });
      setNewTitle("");
      // Reset assignee to the default so the next task picks it up
      // without the user re-typing. Don't blank it — that would force
      // the user to retype their own name for every task.
      setNewAssignee(defaultAssignee);
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
    console.warn("[DELETE-DEBUG] tasks:remove enter", { filename: task.filename, title: task.title });
    const ok = await confirmDelete(
      `Delete "${task.title}"?\n\nThis cannot be undone.`,
      "Delete task?",
    );
    console.warn("[DELETE-DEBUG] tasks:remove confirm result", { ok });
    if (!ok) return;
    try {
      console.warn("[DELETE-DEBUG] tasks:remove calling deleteTask", { repo, filename: task.filename });
      await deleteTask(repo, task.filename);
      console.warn("[DELETE-DEBUG] tasks:remove deleteTask succeeded");
      onChanged();
    } catch (err) {
      console.error("[DELETE-DEBUG] tasks:remove failed:", err);
    }
  };

  return (
    <div className="tasks-viewer">
      <div className="tasks-composer">
        <input
          type="text"
          className="tasks-composer-input"
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
        />
        <input
          type="text"
          className="tasks-composer-assignee"
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
        <Button
          variant="primary"
          size="sm"
          onClick={() => void createNew()}
          disabled={creating || newTitle.trim().length === 0}
        >
          + New
        </Button>
      </div>

      {tasks.length === 0 ? (
        <div className="tasks-empty">
          <p>No tasks yet. Type a title above to file the first one.</p>
        </div>
      ) : (
        <div className="tasks-sections">
          {STATUS_ORDER.map((status) => {
            const items = grouped[status];
            return (
              <section key={status} className={`tasks-section tasks-section-${status}`}>
                <header className="tasks-section-header">
                  <span className="tasks-section-label">{STATUS_LABEL[status]}</span>
                  <span className="tasks-section-count">{items.length}</span>
                </header>
                {items.length === 0 ? (
                  <p className="tasks-section-empty">No tasks here.</p>
                ) : (
                  <ul className="tasks-list">
                    {items.map((task) => (
                      <li key={task.filename} className="tasks-row">
                        <button
                          type="button"
                          className={`tasks-status-pill tasks-status-${task.status}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            void cycleStatus(task);
                          }}
                          title="Click to advance status"
                          aria-label={`Status: ${STATUS_LABEL[task.status]}. Click to cycle.`}
                        >
                          {STATUS_LABEL[task.status]}
                        </button>
                        <button
                          type="button"
                          className={`tasks-title${task.status === "complete" ? " tasks-title-done" : ""}`}
                          onClick={() => void onOpenTask(task.path)}
                          title="Open this task"
                        >
                          {task.title}
                        </button>
                        <AssigneeChip
                          task={task}
                          repo={repo}
                          onChanged={onChanged}
                        />
                        <Button
                          variant="ghost"
                          tone="destructive"
                          size="sm"
                          iconOnly
                          className="tasks-delete"
                          title="Delete task"
                          aria-label="Delete task"
                          onClick={(e) => {
                            e.stopPropagation();
                            void remove(task);
                          }}
                        >
                          <TrashIcon />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

/// Inline-editable assignee for a single row. Click swaps in a text
/// input; blur or Enter commits the new value; Escape cancels and
/// restores the prior value. Mirrors the minimalism of the status
/// pill: no popover, no modal — just type and tab away.
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
  // out-of-band). Without this, an edit committed elsewhere wouldn't
  // appear here until the user navigated away and back.
  useEffect(() => {
    if (!editing) setDraft(task.assignee);
  }, [task.assignee, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = async () => {
    if (saving) return;
    const next = draft.trim();
    // No-op when unchanged. Saves a write and a re-render.
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
      // Revert the optimistic draft so the chip doesn't stay
      // out-of-sync with disk.
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
        onKeyDown={(e) => {
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

  const display = task.assignee.trim() || "—";
  return (
    <button
      type="button"
      className={`tasks-assignee${task.assignee ? "" : " tasks-assignee-empty"}`}
      onClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
      title={task.assignee ? `Assigned to ${task.assignee}. Click to edit.` : "Unassigned. Click to assign."}
    >
      {display}
    </button>
  );
}
