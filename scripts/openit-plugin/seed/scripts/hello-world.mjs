#!/usr/bin/env node
// hello-world.mjs — sample script (PIN-5829 seed dataset).
//
// What this does:
//   - Reads the project's tasks/ folder.
//   - Counts tasks by whether they're complete vs still open.
//   - Prints a single-line summary.
//
// Inputs: none. Reads from CWD assuming it's an OpenIT project root.
// Side effects: prints to stdout. No writes.
//
// This is a sample shipped via "Create sample dataset" on the
// getting-started page. It demonstrates the shape
// `/conversation-to-automation` produces when it captures a
// deterministic CLI sequence as a runnable script. Delete or
// rewrite as you see fit.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = process.cwd();
const TASKS_DIR = join(ROOT, "tasks");

/// Pull `status` out of a task file's YAML-ish frontmatter. Mirrors the
/// hand-rolled parser in src/lib/tasks.ts; returns "" when absent.
function readStatus(raw) {
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return "";
  for (const line of fm[1].split(/\r?\n/)) {
    const m = line.match(/^status\s*:\s*(.*)$/);
    if (m) return m[1].replace(/^["'](.*)["']$/, "$1").trim();
  }
  return "";
}

async function main() {
  let entries;
  try {
    entries = await readdir(TASKS_DIR);
  } catch (err) {
    console.error(`No tasks dir at ${TASKS_DIR}. Run from an OpenIT project root.`);
    process.exit(1);
  }

  const counts = { open: 0, complete: 0 };
  let total = 0;
  for (const name of entries) {
    if (!name.endsWith(".md")) continue;
    total += 1;
    try {
      const raw = await readFile(join(TASKS_DIR, name), "utf8");
      const status = readStatus(raw).toLowerCase();
      if (status === "complete") counts.complete += 1;
      else counts.open += 1;
    } catch {
      counts.open += 1;
    }
  }

  console.log(
    `Hello! Project has ${total} task(s): ${counts.open} open, ` +
      `${counts.complete} complete.`,
  );
}

main().catch((err) => {
  console.error("hello-world failed:", err);
  process.exit(1);
});
