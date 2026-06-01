# Vault layout

The admin's vault is a folder on disk. Everything is a file or folder. No databases, no opaque state.

| Folder | What's there |
|---|---|
| `profile.md` | Durable facts about the admin — name, role, team, working preferences. Read it at session start; update it as you learn. See [`profile.md`](./profile.md). |
| `tasks/` | Personal task list. One markdown file per task (`task-<unix-ms>-<rand>.md`) with YAML frontmatter (`status`, `title`, `assignee`, `createdAt`) and a free-form markdown body. |
| `databases/<collection>/` | Structured records. One folder per collection (`people`, `access`, `assets`, ...). Each collection has a `_schema.json`. |
| `filestores/commands/<name>.md` | Commands the admin invokes via `/<name>`. |
| `filestores/scripts/<name>.mjs` | Runnable scripts. Always Node.js (`.mjs`). |
| `filestores/library/` | Reference docs the admin keeps handy (runbooks, templates). |
| `knowledge/<slug>.md` | Employee-facing answers. |
| `reports/<slug>.md` | Generated reports. |
| `traces/<id>/` | Auto-recorded session logs. You don't write these; the system does. |

We ship sensible defaults inside each (schemas, the starter commands). The admin can delete, rename, or create whatever they want. This is a folder; everything is editable.

**Commands have a mirror.** The admin edits `filestores/commands/<name>.md`. Claude Code's plugin loader reads from `.claude/skills/<name>/SKILL.md` (the path is hardcoded by the platform). The app mirrors edits from the admin-facing copy to the loader copy automatically. **Never edit `.claude/` directly.** Your changes get overwritten on the next sync.

## File conventions

- **Task** lives at `tasks/task-<unix-ms>-<rand>.md`. Search with `Glob "tasks/*.md"`. Status flow: `todo → in-progress → complete`. See [`tasks.md`](./tasks.md) for the full task lifecycle.
- **Person** lives at `databases/people/<sanitized-email>.json`. Sanitize by lowercasing and replacing `@` and `.` with `-` (so `Bob@Example.com` becomes `bob-example-com.json`). If a row with that email already exists, **merge** new fields into it rather than overwriting.
- **Knowledge article** lives at `knowledge/<slug>.md`. Search with `Glob "knowledge/**/*.md"` or `node .claude/scripts/knowledge-search.mjs "<query>"`.
- **Command** lives at `filestores/commands/<name>.md`. Edit this copy, not `.claude/skills/`.
- **Script** lives at `filestores/scripts/<name>.mjs`. Always Node.js, run with `node filestores/scripts/<name>.mjs [args]`.
