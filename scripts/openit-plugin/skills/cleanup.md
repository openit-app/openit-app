---
name: cleanup
description: Remove all sample/demo data from the vault so you start fresh with a clean slate.
---

## What this skill does

Remove all the sample data that shipped with OpenIT so the admin starts with a clean vault.

## How to run

Confirm with the admin first: "I'll remove all sample tickets, people, conversations, access logs, assets, KB articles, and reports. Your custom data will be kept. Go ahead?"

Then run the cleanup script:

```bash
node .claude/scripts/cleanup.mjs
```

The script deletes all files matching `sample-*` patterns across tickets, people, access, assets, knowledge-bases, reports, and conversations. It prints a JSON result with the count of deleted files.

## What it does NOT delete

- Anything without the `sample-` prefix — that's user data
- `_schema.json` files — those define the database structure
- Agent files, skills, scripts — those are not sample data
- The `getting-started.md` file

## After cleanup

Report the result: "Cleaned up X sample files. Your vault is fresh."
