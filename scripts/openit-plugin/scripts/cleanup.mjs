#!/usr/bin/env node

// cleanup.mjs — Remove all sample data from the vault.
// Run: node .claude/scripts/cleanup.mjs
//
// Deletes files matching sample-* patterns across all entity directories.
// Idempotent: safe to run multiple times.

import { readdir, unlink, rm } from "node:fs/promises";
import { join } from "node:path";

const cwd = process.cwd();

const targets = [
  { dir: "databases/tickets", pattern: /^sample-ticket-.*\.json$/ },
  { dir: "databases/people", pattern: /^sample-person-.*\.json$/ },
  { dir: "databases/access", pattern: /^sample-.*\.json$/ },
  { dir: "databases/assets", pattern: /^sample-.*\.json$/ },
  { dir: "knowledge", pattern: /^sample-.*\.md$/ },
  { dir: "reports", pattern: /^sample-.*\.md$/ },
];

// Conversation folders: delete entire sample-ticket-* subdirectories
const conversationDirs = [
  "databases/conversations",
];

let deleted = 0;

for (const { dir, pattern } of targets) {
  const fullDir = join(cwd, dir);
  try {
    const files = await readdir(fullDir);
    for (const file of files) {
      if (pattern.test(file)) {
        await unlink(join(fullDir, file));
        deleted++;
      }
    }
  } catch {
    // Directory doesn't exist — skip
  }
}

// Delete sample conversation folders
for (const dir of conversationDirs) {
  const fullDir = join(cwd, dir);
  try {
    const entries = await readdir(fullDir);
    for (const entry of entries) {
      if (entry.startsWith("sample-ticket-")) {
        await rm(join(fullDir, entry), { recursive: true, force: true });
        deleted++;
      }
    }
  } catch {
    // Directory doesn't exist — skip
  }
}

console.log(JSON.stringify({ ok: true, deleted }));
