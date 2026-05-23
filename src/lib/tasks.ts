/// Tasks — a flat Linear-style personal task list.
///
/// Each task is one markdown file at `<repo>/tasks/task-<unix-ms>-<rand>.md`.
/// Filename is opaque; the human-readable title lives in YAML frontmatter.
///
/// Schema (frontmatter):
///   - `status: "todo" | "in-progress" | "complete"`
///   - `title: "..."`
///   - `createdAt: ISO-8601 UTC` (informational; never used as a key)
///
/// Body (everything after the closing `---`) is free-form markdown. The
/// viewer renders it the same way it renders any other markdown file
/// when the user opens the task for editing.
///
/// Three statuses, no escalations, no assignees, no due dates. v1 by
/// design — Ben's brief was explicit: ship the simplest model that
/// supports todo → in-progress → complete.

import { fsList, fsRead, fsDelete, entityWriteFile } from "./api";
import { isDirectChild } from "./paths";

// ── Types ────────────────────────────────────────────────────────────

export const TASK_STATUSES = ["todo", "in-progress", "complete"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface TaskSummary {
  /** Absolute path to the task file on disk. */
  path: string;
  /** Filename only — e.g. `task-1716480000000-a1b2.md`. */
  filename: string;
  /** Title from frontmatter, or filename stem when missing. */
  title: string;
  status: TaskStatus;
  /** ISO timestamp from frontmatter, or empty when missing. */
  createdAt: string;
  /** Free-form body — everything after the closing `---`. */
  body: string;
}

// ── Frontmatter parser/serializer ────────────────────────────────────
// We deliberately do NOT pull in a yaml library — frontmatter is a
// three-line shape (status / title / createdAt) that a hand-rolled
// parser handles cleanly. Anything that fails to parse falls back to
// safe defaults so a hand-edited task file never crashes the viewer.

interface ParsedTask {
  status: TaskStatus;
  title: string;
  createdAt: string;
  body: string;
}

function isTaskStatus(v: unknown): v is TaskStatus {
  return typeof v === "string" && (TASK_STATUSES as readonly string[]).includes(v);
}

/// Parse a task markdown file. Hand-rolled — supports simple
/// `key: "quoted value"` or `key: bareword` lines between two `---`
/// fences. Anything outside the recognised keys is ignored.
export function parseTaskMarkdown(raw: string, fallbackTitle: string): ParsedTask {
  let status: TaskStatus = "todo";
  let title = fallbackTitle;
  let createdAt = "";
  let body = raw;

  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (fmMatch) {
    const [, frontmatter, rest] = fmMatch;
    body = rest;
    for (const line of frontmatter.split(/\r?\n/)) {
      const m = line.match(/^([a-zA-Z][a-zA-Z0-9_-]*)\s*:\s*(.*)$/);
      if (!m) continue;
      const [, key, rawValue] = m;
      // Strip surrounding quotes if present, then unescape any
      // embedded escaped quotes (matches what serialiseTaskMarkdown
      // writes for titles containing a `"`).
      const value = rawValue
        .replace(/^["'](.*)["']$/, "$1")
        .replace(/\\"/g, '"')
        .replace(/\\'/g, "'")
        .trim();
      if (key === "status" && isTaskStatus(value)) status = value;
      else if (key === "title" && value) title = value;
      else if (key === "createdAt" && value) createdAt = value;
    }
  }

  return { status, title, createdAt, body: body.replace(/^\r?\n/, "") };
}

/// Serialise back to a markdown file. Always quotes the title so a
/// colon or `#` in the title doesn't confuse the next parse.
export function serialiseTaskMarkdown(t: ParsedTask): string {
  const escapedTitle = t.title.replace(/"/g, '\\"');
  return (
    `---\n` +
    `status: ${t.status}\n` +
    `title: "${escapedTitle}"\n` +
    `createdAt: ${t.createdAt}\n` +
    `---\n` +
    (t.body.length > 0 ? `\n${t.body}` : "\n")
  );
}

// ── Disk operations ──────────────────────────────────────────────────

const TASKS_SUBDIR = "tasks";

function tasksDir(repo: string): string {
  return `${repo}/${TASKS_SUBDIR}`;
}

/// List every task file under `tasks/`. Missing directory returns an
/// empty list — fresh vaults haven't materialised the folder yet. Files
/// that fail to read or parse are skipped (never crash the viewer over
/// a hand-mangled task).
export async function listTasks(repo: string): Promise<TaskSummary[]> {
  const dir = tasksDir(repo);
  let nodes;
  try {
    nodes = await fsList(dir);
  } catch {
    return [];
  }
  const summaries: TaskSummary[] = [];
  for (const node of nodes) {
    if (node.is_dir) continue;
    if (!isDirectChild(dir, node.path)) continue;
    if (!node.name.endsWith(".md")) continue;
    let raw: string;
    try {
      raw = await fsRead(node.path);
    } catch {
      continue;
    }
    const fallbackTitle = node.name.replace(/\.md$/, "");
    const parsed = parseTaskMarkdown(raw, fallbackTitle);
    summaries.push({
      path: node.path,
      filename: node.name,
      title: parsed.title,
      status: parsed.status,
      createdAt: parsed.createdAt,
      body: parsed.body,
    });
  }
  // Newest first by createdAt; ties broken by filename so the order is
  // deterministic even when two tasks land in the same millisecond.
  summaries.sort((a, b) => {
    if (a.createdAt !== b.createdAt) return b.createdAt.localeCompare(a.createdAt);
    return b.filename.localeCompare(a.filename);
  });
  return summaries;
}

/// Read and parse a single task file by filename.
export async function readTask(repo: string, filename: string): Promise<TaskSummary | null> {
  const path = `${tasksDir(repo)}/${filename}`;
  let raw: string;
  try {
    raw = await fsRead(path);
  } catch {
    return null;
  }
  const fallbackTitle = filename.replace(/\.md$/, "");
  const parsed = parseTaskMarkdown(raw, fallbackTitle);
  return {
    path,
    filename,
    title: parsed.title,
    status: parsed.status,
    createdAt: parsed.createdAt,
    body: parsed.body,
  };
}

/// Generate a new task filename. Format: `task-<unix-ms>-<4 hex>.md`.
/// Random suffix prevents collisions when two tasks land in the same
/// millisecond (rare in practice but the cost of guarding is one
/// `Math.random` call).
export function newTaskFilename(now: number = Date.now()): string {
  const rand = Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
  return `task-${now}-${rand}.md`;
}

/// Create a new task on disk. Returns the resulting summary so callers
/// can navigate to it immediately.
export async function createTask(
  repo: string,
  args: { title: string; status?: TaskStatus; body?: string },
): Promise<TaskSummary> {
  const status = args.status ?? "todo";
  const createdAt = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const body = args.body ?? "";
  const filename = newTaskFilename();
  const content = serialiseTaskMarkdown({ status, title: args.title, createdAt, body });
  await entityWriteFile(repo, TASKS_SUBDIR, filename, content);
  return {
    path: `${tasksDir(repo)}/${filename}`,
    filename,
    title: args.title,
    status,
    createdAt,
    body,
  };
}

/// Overwrite the entire task with a new status. Re-reads the file first
/// so a status flip preserves any body edits the user made in the
/// markdown viewer between renders.
export async function updateTaskStatus(
  repo: string,
  filename: string,
  nextStatus: TaskStatus,
): Promise<void> {
  const existing = await readTask(repo, filename);
  if (!existing) return;
  const content = serialiseTaskMarkdown({
    status: nextStatus,
    title: existing.title,
    createdAt: existing.createdAt,
    body: existing.body,
  });
  await entityWriteFile(repo, TASKS_SUBDIR, filename, content);
}

/// Delete a task file. No confirm — the caller (Viewer / TasksViewer)
/// already prompts via `confirmDelete`.
export async function deleteTask(repo: string, filename: string): Promise<void> {
  await fsDelete(`${tasksDir(repo)}/${filename}`);
}

/// Cycle a task through todo → in-progress → complete → todo. Used by
/// the one-click status pill in the TasksViewer card.
export function nextStatus(current: TaskStatus): TaskStatus {
  switch (current) {
    case "todo":
      return "in-progress";
    case "in-progress":
      return "complete";
    case "complete":
      return "todo";
  }
}

/// Count of tasks in each status. Useful for the workstation hero
/// card ("3 todo" / "Clean slate").
export interface TaskCounts {
  todo: number;
  inProgress: number;
  complete: number;
  total: number;
}

export function tallyTasks(tasks: TaskSummary[]): TaskCounts {
  let todo = 0;
  let inProgress = 0;
  let complete = 0;
  for (const t of tasks) {
    if (t.status === "todo") todo += 1;
    else if (t.status === "in-progress") inProgress += 1;
    else if (t.status === "complete") complete += 1;
  }
  return { todo, inProgress, complete, total: tasks.length };
}
