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
// PIN-6605: tickets and conversations were removed from the bundled
// seed set when the ticket UI was ripped. Pristine `sample-*` ticket
// and conversation files left over from a pre-PIN-6605 install are
// also cleaned up here via the legacy TARGETS entries — without them
// the user's vault keeps stale samples that the cleanup command
// promised to remove.
//
// Idempotent: safe to run multiple times.

import { readdir, readFile, rmdir, stat, unlink } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

const cwd = process.cwd();
const SEED_ROOT = join(cwd, ".claude", "seed");

// Mirror of TARGETS in load-sample-data.mjs, plus legacy ticket/
// conversation entries kept around so a pre-PIN-6605 vault can still
// be cleaned up after the upgrade. New installs never have the seed
// files for those targets, so the per-target existence check at the
// top of the loop simply skips them.
const TARGETS = {
  people: "databases/people",
  access: "databases/access",
  assets: "databases/assets",
  knowledge: "knowledge",
  reports: "reports",
  scripts: "filestores/scripts",
  // Legacy targets (no longer in the manifest; cleanup still removes
  // pristine pre-existing copies on disk if any seed bytes survive
  // from an older plugin sync).
  tickets: "databases/tickets",
  conversations: "databases/conversations",
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

// Try to remove empty parent dirs left after deletes (e.g.
// `databases/conversations/sample-ticket-1/` once all msg files are
// gone). Walks up to the target root, stops at the first non-empty
// parent. Never touches the target root itself.
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

// PIN-6605 fallback: pre-PIN-6605 installs may have synced sample
// ticket / conversation files into the vault, but the new plugin no
// longer ships those seed bytes — so the bytes-equal loop above can't
// match them. Walk the two legacy folders explicitly and unlink any
// file whose name starts with `sample-` (the bundled prefix). Users
// who renamed their samples or wrote their own ticket files keep
// theirs untouched.
const LEGACY_SAMPLE_DIRS = ["databases/tickets", "databases/conversations"];
for (const rel of LEGACY_SAMPLE_DIRS) {
  const root = join(cwd, rel);
  if (!(await exists(root))) continue;
  const files = await walk(root);
  for (const file of files) {
    const base = file.split("/").pop() ?? "";
    if (!base.startsWith("sample-")) continue;
    try {
      await unlink(file);
      deleted++;
      await pruneEmptyDirs(dirname(file), root);
    } catch {
      /* swallow — already gone or unreadable */
    }
  }
}

const result = { ok: true, deleted };
if (preserved > 0) result.preserved = preserved;
console.log(JSON.stringify(result));
