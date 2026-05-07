---
name: Cleanup Sample Data
description: Remove all sample/demo data from the vault so you start fresh with a clean slate.
---

## What this skill does

You remove all the sample data that shipped with OpenIT so the admin starts with a clean vault. This is a one-time operation — once the samples are gone, they're gone.

## How to interact

The admin says something like:
- "Clean up the sample data"
- "Remove the demo data"
- "I want to start fresh"

Confirm before deleting: "I'll remove all sample tickets, people, conversations, access logs, assets, and KB articles that shipped with OpenIT. Your custom data (anything you created yourself) will be kept. Go ahead?"

## What to delete

Sample data has predictable filenames:

- `databases/tickets/sample-ticket-*.json`
- `databases/people/sample-person-*.json`
- `databases/conversations/sample-ticket-*/` (entire folders)
- `databases/access/sample-*.json`
- `databases/assets/sample-*.json`
- `knowledge-bases/sample-*.md`

Use `Glob` to find all matching files and `Bash` to delete them:

```bash
rm -f databases/tickets/sample-ticket-*.json
rm -f databases/people/sample-person-*.json
rm -rf databases/conversations/sample-ticket-*
rm -f databases/access/sample-*.json
rm -f databases/assets/sample-*.json
rm -f knowledge-bases/sample-*.md
```

## What NOT to delete

- Anything without the `sample-` prefix — that's user data
- `_schema.json` files — those define the database structure
- Agent files, skills, scripts — those are not sample data
- The `getting-started.md` file — useful reference even after cleanup

## After cleanup

Report what was removed: "Removed 5 sample tickets, 5 sample people, 8 conversation messages, 2 access logs, 3 assets, and 2 KB articles. Your vault is clean."
