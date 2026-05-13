#!/usr/bin/env node
// list-people.mjs — sample script that walks the People directory.
//
// What this does:
//   - Reads `databases/people/*.json`.
//   - Prints a one-line roster: count, then "Name (role) — email".
// Inputs: none. Reads from CWD assuming it's an OpenIT project root.
// Side effects: prints to stdout. No writes.
//
// Use this as a starting point for "give me a roster of everyone
// in department X" or "everyone hired this year" — edit the filter
// at the bottom of main().

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const PEOPLE_DIR = join(process.cwd(), "databases", "people");

async function main() {
  let entries;
  try {
    entries = await readdir(PEOPLE_DIR);
  } catch {
    console.error(`No people dir at ${PEOPLE_DIR}. Run from an OpenIT project root.`);
    process.exit(1);
  }

  const people = [];
  for (const name of entries) {
    if (!name.endsWith(".json") || name === "_schema.json") continue;
    try {
      const p = JSON.parse(await readFile(join(PEOPLE_DIR, name), "utf8"));
      if (p?.name) people.push(p);
    } catch {
      /* skip malformed */
    }
  }

  console.log(`${people.length} people on file:`);
  for (const p of people) {
    console.log(`  - ${p.name} (${p.role ?? "—"}) — ${p.email ?? "no email"}`);
  }
}

main().catch((err) => {
  console.error("list-people failed:", err);
  process.exit(1);
});
