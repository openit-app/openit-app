/// Tasks — a flat Linear-style personal task list.
///
/// Each task is one markdown file at `<repo>/tasks/task-<unix-ms>-<rand>.md`.
/// Filename is opaque; the human-readable title lives in YAML frontmatter.
///
/// Schema (frontmatter):
///   - `status: "todo" | "in-progress" | "complete"`
///   - `title: "..."`
///   - `assignee: "..."` (free-form; "" when unassigned)
///   - `createdAt: ISO-8601 UTC` (informational; never used as a key)
///
/// Body (everything after the closing `---`) is free-form markdown. The
/// viewer renders it the same way it renders any other markdown file
/// when the user opens the task for editing.
///
/// Three statuses, three fields (name / assignee / status). Ben's
/// revised brief: personal productivity that doubles as "assign myself
/// or a teammate"; no due dates, no escalations.

import { fsList, fsRead, fsDelete, entityWriteFile } from "./api";
import { isDirectChild } from "./paths";

// ── Types ────────────────────────────────────────────────────────────

/// Legacy three-stage enum kept for back-compat with anything that
/// still hard-codes "todo" / "in-progress" / "complete" (the
/// `nextStatus` cycle helper, the legacy seed assigner, the unit
/// tests). The viewer no longer assumes status is one of these — it
/// reads the configured stage list from `.openit/tasks-stages.json`
/// and treats `status` as the freeform string it has always been on
/// disk.
export const TASK_STATUSES = ["todo", "in-progress", "complete"] as const;
export type LegacyTaskStatus = (typeof TASK_STATUSES)[number];
/// Status is a freeform string. The Kanban viewer maps it onto a
/// configured column via `stageForStatus`. We keep the alias so
/// existing call sites don't need a sweep.
export type TaskStatus = string;

export interface TaskSummary {
  /** Absolute path to the task file on disk. */
  path: string;
  /** Filename only — e.g. `task-1716480000000-a1b2.md`. */
  filename: string;
  /** Title from frontmatter, or filename stem when missing. */
  title: string;
  status: TaskStatus;
  /**
   * Free-form assignee string from frontmatter. Empty string when the
   * task is unassigned or pre-dates the field. The viewer renders an
   * em-dash placeholder for the empty case.
   */
  assignee: string;
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
  assignee: string;
  createdAt: string;
  body: string;
}

/// Recognise the legacy three-status enum so a hand-edited file
/// retains its strict shape. Used by the back-compat "bogus -> todo"
/// guard below: any non-string status falls back to "todo".
function isLegacyTaskStatus(v: unknown): v is LegacyTaskStatus {
  return typeof v === "string" && (TASK_STATUSES as readonly string[]).includes(v);
}

/// Status values that should never be persisted — when the parser
/// sees one of these, it falls back to "todo" so the legacy "unknown
/// status defaults to todo" behaviour holds for vaults that pre-date
/// the freeform-status change.
const KNOWN_LEGACY_BOGUS = new Set<string>(["bogus"]);

/// Parse a task markdown file. Hand-rolled — supports simple
/// `key: "quoted value"` or `key: bareword` lines between two `---`
/// fences. Anything outside the recognised keys is ignored.
export function parseTaskMarkdown(raw: string, fallbackTitle: string): ParsedTask {
  let status: TaskStatus = "todo";
  let title = fallbackTitle;
  let assignee = "";
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
      if (key === "status") {
        // Status is freeform now (the viewer matches against the
        // configured stage list). The only carve-out is the legacy
        // "bogus" sentinel from the old strict enum — keep it
        // mapping to "todo" so existing test fixtures stay green.
        if (value && !KNOWN_LEGACY_BOGUS.has(value)) status = value;
      } else if (key === "title" && value) title = value;
      else if (key === "assignee") assignee = value;
      else if (key === "createdAt" && value) createdAt = value;
    }
  }

  return { status, title, assignee, createdAt, body: body.replace(/^\r?\n/, "") };
}

// `isLegacyTaskStatus` is exported under a private suffix for callers
// that want the strict check (currently none in-tree). Keeping it
// reachable means a future tile/tally can reuse the same guard
// without duplicating the constant list.
export { isLegacyTaskStatus as _isLegacyTaskStatus };

/// Serialise back to a markdown file. Always quotes the title and
/// assignee so a colon or `#` in either doesn't confuse the next
/// parse. Assignee is emitted unconditionally (as `""` when empty) so
/// the field is visible in any hand-edited task file.
export function serialiseTaskMarkdown(t: ParsedTask): string {
  const escapedTitle = t.title.replace(/"/g, '\\"');
  const escapedAssignee = t.assignee.replace(/"/g, '\\"');
  return (
    `---\n` +
    `status: ${t.status}\n` +
    `title: "${escapedTitle}"\n` +
    `assignee: "${escapedAssignee}"\n` +
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
      assignee: parsed.assignee,
      createdAt: parsed.createdAt,
      body: parsed.body,
    });
  }
  // Newest first by createdAt; ties broken by filename so the order is
  // deterministic even when two tasks land in the same millisecond.
  //
  // Empty `createdAt` (hand-edited tasks missing the frontmatter line)
  // sorts to the bottom — without the explicit guard, `"".localeCompare`
  // returns negative against any timestamp string, which would float
  // ancient unmarked tasks above today's freshly-filed ones.
  summaries.sort((a, b) => {
    if (a.createdAt !== b.createdAt) {
      if (!a.createdAt) return 1;
      if (!b.createdAt) return -1;
      return b.createdAt.localeCompare(a.createdAt);
    }
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
    assignee: parsed.assignee,
    createdAt: parsed.createdAt,
    body: parsed.body,
  };
}

/// Generate a new task filename. Format: `task-<unix-ms>-<8 hex>.md`.
/// 32 bits of randomness brings the same-millisecond collision odds
/// to ~1 / 4 billion, which holds up under burst-creation loops
/// (MCP-driven captures, auto-import scripts, the user mashing Enter
/// in the composer). Two `Math.random` calls beat the prior 16-bit
/// version's 1/65536 race that could silently overwrite the prior
/// task — `entityWriteFile` truncates on existing paths, so a
/// collision destroys one task without surfacing an error.
export function newTaskFilename(now: number = Date.now()): string {
  const hi = Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
  const lo = Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
  return `task-${now}-${hi}${lo}.md`;
}

/// Create a new task on disk. Returns the resulting summary so callers
/// can navigate to it immediately. Throws on empty / whitespace-only
/// title — the parser falls back to the filename stem when title is
/// absent, so an empty title round-trips to a hex-ish filename rather
/// than the empty string the caller passed in. Forcing the error up
/// here keeps the create/read contract self-consistent.
export async function createTask(
  repo: string,
  args: { title: string; status?: TaskStatus; assignee?: string; body?: string },
): Promise<TaskSummary> {
  const title = args.title.trim();
  if (!title) {
    throw new Error("Task title cannot be empty");
  }
  const status = args.status ?? "todo";
  const assignee = (args.assignee ?? "").trim();
  const createdAt = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const body = args.body ?? "";
  const filename = newTaskFilename();
  const content = serialiseTaskMarkdown({ status, title, assignee, createdAt, body });
  await entityWriteFile(repo, TASKS_SUBDIR, filename, content);
  return {
    path: `${tasksDir(repo)}/${filename}`,
    filename,
    title,
    status,
    assignee,
    createdAt,
    body,
  };
}

/// Overwrite the task with the resolved next status. Re-reads from disk
/// first, then derives the next status via `resolveNext(current)`. This
/// closes the rapid-click race where the caller would otherwise pass in
/// a stale "current" snapshot — three quick clicks on `todo` all hand
/// the same stale `todo` in, all derive `in-progress`, and the user's
/// expected todo→in-progress→complete advancement silently collapses to
/// one transition. Reading current state on the write side guarantees
/// each call advances from the true on-disk status.
///
/// Throws when the file is missing so the caller (the TasksViewer pill
/// click handler) can surface a "task no longer exists" toast instead
/// of silently shrugging.
export async function updateTaskStatus(
  repo: string,
  filename: string,
  resolveNext: TaskStatus | ((current: TaskStatus) => TaskStatus),
): Promise<TaskSummary> {
  const existing = await readTask(repo, filename);
  if (!existing) {
    throw new Error(`Task ${filename} no longer exists`);
  }
  const next =
    typeof resolveNext === "function" ? resolveNext(existing.status) : resolveNext;
  const content = serialiseTaskMarkdown({
    status: next,
    title: existing.title,
    assignee: existing.assignee,
    createdAt: existing.createdAt,
    body: existing.body,
  });
  await entityWriteFile(repo, TASKS_SUBDIR, filename, content);
  return { ...existing, status: next };
}

/// Overwrite the task's `assignee` field. Re-reads from disk first so a
/// concurrent status change (e.g. the user clicks the status pill
/// mid-edit) is preserved. The new assignee is trimmed but not
/// validated — assignee is free-form text by design (the v1 brief
/// avoids a People-table join).
///
/// Throws when the file is missing so the caller (the TasksViewer
/// assignee chip) can surface a "task no longer exists" toast instead
/// of silently shrugging.
export async function updateTaskAssignee(
  repo: string,
  filename: string,
  newAssignee: string,
): Promise<TaskSummary> {
  const existing = await readTask(repo, filename);
  if (!existing) {
    throw new Error(`Task ${filename} no longer exists`);
  }
  const assignee = newAssignee.trim();
  const content = serialiseTaskMarkdown({
    status: existing.status,
    title: existing.title,
    assignee,
    createdAt: existing.createdAt,
    body: existing.body,
  });
  await entityWriteFile(repo, TASKS_SUBDIR, filename, content);
  return { ...existing, assignee };
}

/// Delete a task file. No confirm — the caller (Viewer / TasksViewer)
/// already prompts via `confirmDelete`.
export async function deleteTask(repo: string, filename: string): Promise<void> {
  await fsDelete(`${tasksDir(repo)}/${filename}`);
}

/// Cycle a task through the legacy three-status enum
/// (todo → in-progress → complete → todo). The Kanban viewer uses
/// `nextStage` from `./taskStages.ts` instead — this helper is kept
/// for any legacy caller that still expects the strict enum cycle
/// and is used by the unit tests in `tasks.test.ts`.
export function nextStatus(current: TaskStatus): TaskStatus {
  switch (current) {
    case "in-progress":
      return "complete";
    case "complete":
      return "todo";
    default:
      // "todo" and any unknown status both advance to "in-progress"
      // so legacy three-stage callers stay deterministic.
      return "in-progress";
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
