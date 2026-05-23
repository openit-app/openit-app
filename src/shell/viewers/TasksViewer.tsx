/// TasksViewer — the new Inbox.
///
/// Three sections (Todo / In Progress / Complete). Each task card shows
/// the title, a status pill the user can click to cycle through
/// statuses, an "open" affordance to view/edit the body, and a delete
/// button. A `+ New task` row at the top creates a draft task and
/// switches the viewer into edit mode on it.
///
/// Replaces the bespoke ticket / conversation UI. No assignees, no due
/// dates, no escalations — that's by design.

import { useState } from "react";
import { Button } from "../../ui";
import { TrashIcon } from "../TrashIcon";
import { confirmDelete } from "./viewerHelpers";
import {
  createTask,
  deleteTask,
  nextStatus,
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

export function TasksViewer({ tasks, repo, onOpenTask, onChanged }: TasksViewerProps) {
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);

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
      await createTask(repo, { title });
      setNewTitle("");
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
