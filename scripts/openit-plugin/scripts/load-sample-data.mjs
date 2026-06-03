#!/usr/bin/env node

// load-sample-data.mjs — Copy bundled sample data into the vault.
// Run: node .claude/scripts/load-sample-data.mjs
//
// Reads from `.claude/seed/<target>/...` (staged on disk by the plugin
// sync, see `routeFile` in src/lib/skillsSync.ts) and copies each file
// to its vault destination. Skip-if-exists per file, so re-running
// fills gaps without clobbering anything the admin has already touched.
// Idempotent: safe to run multiple times.

import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

const cwd = process.cwd();
const SEED_ROOT = join(cwd, ".claude", "seed");

// seed/<target> → vault destination. Mirror of `seedRoute` in
// src/lib/seed.ts so the two seeding paths agree on layout.
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

let wrote = 0;
let skipped = 0;
const missingTargets = [];

for (const [target, destBase] of Object.entries(TARGETS)) {
  const seedDir = join(SEED_ROOT, target);
  if (!(await exists(seedDir))) {
    missingTargets.push(target);
    continue;
  }
  const files = await walk(seedDir);
  for (const src of files) {
    const rel = relative(seedDir, src);
    const dest = join(cwd, destBase, rel);
    if (await exists(dest)) {
      skipped++;
      continue;
    }
    await mkdir(dirname(dest), { recursive: true });
    const content = await readFile(src);
    await writeFile(dest, content);
    wrote++;
  }
}

// If every target folder under `.claude/seed/` is missing the
// bundled plugin sync hasn't populated it yet (typically: the app
// hasn't relaunched since the manifest bumped). Exit non-zero with
// a clear message so Claude doesn't silently report success on a
// no-op.
if (
  wrote === 0 &&
  skipped === 0 &&
  missingTargets.length === Object.keys(TARGETS).length
) {
  console.error(
    JSON.stringify({
      ok: false,
      error: "no-seed",
      seedRoot: SEED_ROOT,
      message:
        "Bundled seed data is not on disk yet (.claude/seed/ is empty). Restart the OpenIT app so the plugin sync runs, then re-run /load-sample-data.",
    }),
  );
  process.exit(1);
}

const result = { ok: true, wrote, skipped };
if (missingTargets.length > 0) result.missingTargets = missingTargets;
console.log(JSON.stringify(result));
