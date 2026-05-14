---
name: load-sample-data
description: Load sample data into the workspace — people, access logs, assets, KB articles, scripts, and reports — so you can see what OpenIT looks like with real content.
---

## What this command does

Copies bundled sample data into the vault by running a script. The script does the work — your job is to invoke it and report the result.

## How to run

```bash
node .claude/scripts/load-sample-data.mjs
```

The script reads from `.claude/seed/<target>/` (staged on disk by the plugin sync) and copies each file to its vault destination. It skips files that already exist, so re-running fills gaps without overwriting anything the admin has edited.

It prints a JSON result like `{"ok":true,"wrote":N,"skipped":M}`.

## After it runs

Tell the admin in one short line — for example:

> Done — populated the workspace with sample people, access logs, assets, knowledge base articles, scripts, and a report. Click through the tiles in the left panel to see what's there.

## Rules

- **Don't ask for confirmation.** Just run the script. It never overwrites existing files.
- **Don't type out file contents.** The script handles the copy.
- **Be quick.** Run, then report.
