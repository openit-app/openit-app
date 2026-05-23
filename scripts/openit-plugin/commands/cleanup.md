---
name: cleanup
description: Remove all sample/demo data from the vault so you start fresh with a clean slate.
---

## What this skill does

Remove all the sample data that shipped with OpenIT so the admin starts with a clean vault.

## How to run

Confirm with the admin first: "I'll remove all sample people, access logs, assets, KB articles, and reports — plus any leftover sample tickets/conversations from older versions. Your custom data stays put. Go ahead?"

Then run the cleanup script:

```bash
node .claude/scripts/cleanup.mjs
```

The script deletes:

- Files that byte-match the bundled seed for people / access / assets / knowledge / reports / scripts.
- Any file in `databases/tickets/` or `databases/conversations/` whose filename starts with `sample-` (legacy cleanup for pre-PIN-6605 vaults — the ticket UI was removed but pristine sample files may still be on disk).

It prints a JSON result with the count of deleted files.

## What it does NOT delete

- Anything without the `sample-` prefix — that's user data
- `_schema.json` files — those define the database structure
- Agent files, skills, scripts — those are not sample data
- The `getting-started.md` file

## After cleanup

Report the result: "Cleaned up X sample files. Your vault is fresh."
