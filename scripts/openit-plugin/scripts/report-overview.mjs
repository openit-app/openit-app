#!/usr/bin/env node
// report-overview.mjs — programmatic task overview. Reads the local
// task markdown files (and people, for the headcount line) and writes
// a markdown report at reports/<YYYY-MM-DD>-overview.md. No LLM, no
// network — pure file I/O so it's instant.
//
// Usage:
//   node .claude/scripts/report-overview.mjs
//
// Output (single JSON line on stdout):
//   { "ok": true, "path": "reports/2026-04-27-overview.md" }
// On failure (single JSON line):
//   { "ok": false, "error": "<message>" }
//
// cwd: the OpenIT project root (`~/OpenIT/<slug>/`).

import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const TASKS_DIR = "tasks";
const PEOPLE_DIR = "databases/people";
const REPORTS_DIR = "reports";

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

/// Format a Date as `YYYY-MM-DD` in local time. Used for the filename
/// prefix; reverse-alphabetical sort on filenames puts the newest
/// report at the top of the explorer. Day granularity is intentional:
/// re-running "Overview" on the same day overwrites the existing file
/// rather than accumulating one row in the explorer per click. Custom
/// freeform reports written by /report still carry a finer timestamp
/// + slug, so within-day iteration there is preserved.
function dateFilename(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/// Parse YAML-ish frontmatter from a task markdown file. Mirrors the
/// hand-rolled parser in src/lib/tasks.ts: a `key: value` block between
/// two `---` fences, surrounding quotes stripped. Anything that fails
/// to parse falls back to safe defaults so one mangled task file never
/// fails the whole report. Returns { status, title, assignee,
/// createdAt, completedAt }.
function parseTask(raw, fallbackTitle) {
  let status = "todo";
  let title = fallbackTitle;
  let assignee = "";
  let createdAt = "";
  let completedAt = "";

  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (fm) {
    for (const line of fm[1].split(/\r?\n/)) {
      const m = line.match(/^([a-zA-Z][a-zA-Z0-9_-]*)\s*:\s*(.*)$/);
      if (!m) continue;
      const key = m[1];
      const value = m[2]
        .replace(/^["'](.*)["']$/, "$1")
        .replace(/\\"/g, '"')
        .replace(/\\'/g, "'")
        .trim();
      if (key === "status" && value) status = value;
      else if (key === "title" && value) title = value;
      else if (key === "assignee") assignee = value;
      else if (key === "createdAt" && value) createdAt = value;
      else if (key === "completedAt") completedAt = value;
    }
  }
  return { status, title, assignee, createdAt, completedAt };
}

/// Read every *.md directly inside `tasks/` (depth 1). Unreadable
/// files are skipped silently. Missing dir → empty array.
async function readTasks(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
  const tasks = [];
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    if (!ent.name.endsWith(".md")) continue;
    try {
      const raw = await readFile(path.join(dir, ent.name), "utf8");
      tasks.push(parseTask(raw, ent.name.replace(/\.md$/, "")));
    } catch {
      /* skip unreadable */
    }
  }
  return tasks;
}

/// Read every *.json directly inside dir (depth 1, skipping `_schema.json`
/// and conflict-shadow `.server.*` files). Used only for the people
/// headcount line. Missing dir → empty array.
async function readJsonRows(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
  const rows = [];
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    if (!ent.name.endsWith(".json")) continue;
    if (ent.name === "_schema.json") continue;
    if (ent.name.includes(".server.")) continue;
    try {
      const raw = await readFile(path.join(dir, ent.name), "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") rows.push(parsed);
    } catch {
      /* skip unparseable */
    }
  }
  return rows;
}

/// Days between `iso` and `now`. Returns null on a missing/unparseable
/// timestamp so callers can render "—" instead of NaN.
function ageDays(iso, now) {
  if (!iso || typeof iso !== "string") return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const diffMs = now.getTime() - t;
  return Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
}

/// Lower-case-trim wrapper used as a defensive guard around the
/// free-form assignee field. Empty / non-string → "unassigned" so the
/// by-assignee grouping doesn't blow up.
function assigneeKey(a) {
  if (typeof a !== "string") return "unassigned";
  const trimmed = a.trim();
  return trimmed || "unassigned";
}

const COMPLETE = "complete";

/// Sum tasks by status (preserving first-seen order). Status is
/// free-form on disk, so we don't pre-seed a known list.
function countByStatus(tasks) {
  const counts = new Map();
  for (const t of tasks) {
    const s = (typeof t.status === "string" && t.status.trim()) || "unsorted";
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  return counts;
}

function countByAssignee(tasks, n) {
  const tally = new Map();
  for (const t of tasks) {
    const k = assigneeKey(t.assignee);
    tally.set(k, (tally.get(k) ?? 0) + 1);
  }
  return Array.from(tally.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

/// Tasks created / completed in the last N days. `completedAt` is
/// stamped by the app when a task moves into the configured complete
/// stage, so it's an accurate transition time (unlike the ticket model,
/// which only had updatedAt as a proxy).
function activityWindow(tasks, days, now) {
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
  let created = 0;
  let completed = 0;
  for (const t of tasks) {
    const c = Date.parse(t.createdAt ?? "");
    if (!Number.isNaN(c) && c >= cutoff) created += 1;
    const done = Date.parse(t.completedAt ?? "");
    if (!Number.isNaN(done) && done >= cutoff) completed += 1;
  }
  return { created, completed };
}

/// Escape characters that would break a GFM table cell. Pipes are the
/// structural separator and must be backslash-escaped; raw newlines
/// split a row. Matters for free-form task fields (title, assignee)
/// that flow straight from user input. Backslashes are escaped first
/// so a value already containing a literal `\|` doesn't double up.
function escapeTableCell(s) {
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ");
}

function renderTable(headers, rows) {
  const head = `| ${headers.map(escapeTableCell).join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows
    .map((r) => `| ${r.map(escapeTableCell).join(" | ")} |`)
    .join("\n");
  return [head, sep, body].join("\n");
}

function isComplete(t) {
  return typeof t.status === "string" && t.status.trim().toLowerCase() === COMPLETE;
}

function renderReport({ now, tasks, peopleCount, activity }) {
  const lines = [];
  lines.push("# Team overview");
  lines.push("");
  lines.push(
    `_Generated ${now.toISOString()} — ${tasks.length} tasks, ${peopleCount} people._`,
  );
  lines.push("");

  // Status breakdown.
  lines.push("## Tasks by status");
  lines.push("");
  const statusRows = Array.from(countByStatus(tasks).entries())
    .filter(([, n]) => n > 0)
    .map(([s, n]) => [s, String(n)]);
  if (statusRows.length === 0) {
    lines.push("_No tasks yet._");
  } else {
    lines.push(renderTable(["Status", "Count"], statusRows));
  }
  lines.push("");

  // Last 7 days.
  lines.push("## Last 7 days");
  lines.push("");
  lines.push(
    renderTable(
      ["Metric", "Count"],
      [
        ["Created", String(activity.created)],
        ["Completed", String(activity.completed)],
      ],
    ),
  );
  lines.push("");

  // By assignee.
  lines.push("## By assignee");
  lines.push("");
  const byAssignee = countByAssignee(tasks, 5);
  if (byAssignee.length === 0) {
    lines.push("_No tasks yet._");
  } else {
    lines.push(
      renderTable(
        ["Assignee", "Tasks"],
        byAssignee.map(([a, n]) => [a, String(n)]),
      ),
    );
  }
  lines.push("");

  // Open tasks (anything not in the complete stage).
  lines.push("## Open tasks");
  lines.push("");
  const open = tasks
    .filter((t) => !isComplete(t))
    .map((t) => {
      const title = typeof t.title === "string" ? t.title : "";
      const assignee = assigneeKey(t.assignee);
      const status = (typeof t.status === "string" && t.status.trim()) || "unsorted";
      const age = ageDays(t.createdAt, now);
      const ageStr = age == null ? "—" : `${age}d`;
      return [title || "(no title)", status, assignee, ageStr];
    });
  if (open.length === 0) {
    lines.push("_None — everything is done._");
  } else {
    lines.push(renderTable(["Task", "Status", "Assignee", "Age"], open));
  }
  lines.push("");

  return lines.join("\n");
}

async function main() {
  const now = new Date();

  let tasks;
  let peopleCount;
  try {
    tasks = await readTasks(TASKS_DIR);
    const people = await readJsonRows(PEOPLE_DIR);
    peopleCount = people.length;
  } catch (e) {
    emit({ ok: false, error: `read failed: ${e.message}` });
    process.exit(1);
    return;
  }

  const activity = activityWindow(tasks, 7, now);
  const body = renderReport({ now, tasks, peopleCount, activity });

  const fname = `${dateFilename(now)}-overview.md`;
  const fullPath = path.join(REPORTS_DIR, fname);
  try {
    await mkdir(REPORTS_DIR, { recursive: true });
    await writeFile(fullPath, body, "utf8");
  } catch (e) {
    emit({ ok: false, error: `write failed: ${e.message}` });
    process.exit(1);
    return;
  }

  emit({ ok: true, path: fullPath });
}

main().catch((e) => {
  emit({ ok: false, error: e.stack ?? String(e) });
  process.exit(1);
});
