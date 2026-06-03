#!/usr/bin/env node

// cleanup.mjs — Remove bundled sample data from the vault.
// Run: node .claude/scripts/cleanup.mjs
//
// Source of truth: `.claude/seed/<target>/<...>` — the same files
// `load-sample-data.mjs` copies into the vault. For each seed file
// the matching vault destination is deleted only if its bytes equal
// the seed (pristine sample data). Files the admin has edited keep
// their custom version. Empty parent directories are pruned after
// deletes.
//
// Day-to-day work now lives in task markdown files under `tasks/`;
// the bundled seed set ships sample tasks (plus people / access /
// assets / knowledge / reports / scripts).
//
// Idempotent: safe to run multiple times.

import { readdir, readFile, rmdir, stat, unlink } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

const cwd = process.cwd();
const SEED_ROOT = join(cwd, ".claude", "seed");

// Mirror of TARGETS in load-sample-data.mjs.
const TARGETS = {
  tasks: "tasks",
  people: "databases/people",
  access: "databases/access",
  assets: "databases/assets",
  knowledge: "knowledge",
  reports: "reports",
  scripts: "filestores/scripts",
};

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(full)));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

async function bytesEqual(a, b) {
  try {
    const [bufA, bufB] = await Promise.all([readFile(a), readFile(b)]);
    if (bufA.length !== bufB.length) return false;
    return bufA.equals(bufB);
  } catch {
    return false;
  }
}

// Try to remove empty parent dirs left after deletes. Walks up to the
// target root, stops at the first non-empty parent. Never touches the
// target root itself.
async function pruneEmptyDirs(startDir, stopAt) {
  let dir = startDir;
  while (dir.startsWith(stopAt) && dir !== stopAt) {
    try {
      await rmdir(dir);
    } catch {
      return;
    }
    dir = dirname(dir);
  }
}

let deleted = 0;
let preserved = 0;

for (const [target, destBase] of Object.entries(TARGETS)) {
  const seedDir = join(SEED_ROOT, target);
  const destRoot = join(cwd, destBase);
  if (!(await exists(seedDir))) continue;
  const seedFiles = await walk(seedDir);
  for (const src of seedFiles) {
    const rel = relative(seedDir, src);
    const dest = join(destRoot, rel);
    if (!(await exists(dest))) continue;
    if (await bytesEqual(src, dest)) {
      await unlink(dest);
      deleted++;
      await pruneEmptyDirs(dirname(dest), destRoot);
    } else {
      preserved++;
    }
  }
}

const result = { ok: true, deleted };
if (preserved > 0) result.preserved = preserved;
console.log(JSON.stringify(result));
