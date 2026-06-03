---
name: report
description: Generate a custom report from the local task data (and knowledge base). Reads tasks / people / knowledge, drafts a markdown report, writes it to reports/<timestamp>-<slug>.md so the newest report sorts to the top of the explorer. Use for anything more specific than the canned "Generate overview" — e.g. "tasks completed last month", "open tasks by assignee", "which KB articles changed this quarter".
---

## When to use

Slash-invoked by the admin: `/report <what they want a report on>`. The instant, canned task overview is produced by the **Generate overview** button in the explorer (which shells out to `.claude/scripts/report-overview.mjs`); this skill is the freeform path for anything that button doesn't already cover.

Both paths write into the same `reports/` folder. Newest sorts to the top by filename.

## How to run it

### 1. Clarify the scope (only if the request is genuinely ambiguous)

Don't pepper the admin with questions. If they said "VPN tickets" you have enough — pick the obvious time window (last 30 days) and run with it; mention the choice in the report header so they can push back.

Ask only when there's a real fork: "tasks" could mean only-open or all-statuses, "by person" could mean assignee or creator. One question, then go.

### 2. Read the data you need

Everything is local files — use the built-in tools:

- **Tasks** — `Glob "tasks/*.md"`, `Read` each that matches the scope. Each task is a markdown file with YAML frontmatter: `status`, `title`, `assignee`, `createdAt`, `completedAt` (all ISO-8601 timestamps; the body after the closing `---` is free-form markdown). See `instructions/tasks.md` for the full shape.
- **People** — `databases/people/*.json` for assignee lookups (optional; assignee is free-form text, so a People row isn't required).
- **KB** — `Glob "knowledge/**/*.md"` if the report is about KB coverage / recently-changed articles.

For a report scoped to a date range, filter by `createdAt` (for "tasks opened in window") or `completedAt` (for "tasks finished in window"). Both are ISO-8601 strings — `Date.parse()`-comparable. `completedAt` is empty for tasks that have never reached the complete stage.

### 3. Draft the report

Markdown. Lead with a `# Title` that explains what the report covers. Include a one-line generated-at note so the admin can tell which run they're looking at:

```markdown
# Tasks completed — last 30 days

_Generated 2026-04-27T14:32:00Z — 12 tasks completed in window._

## By assignee
| Assignee | Completed |
| --- | --- |
| Alice | 7 |
| Bob | 5 |

## …
```

Use plain markdown tables. No HTML, no charts. If a section has no data, write `_None._` rather than rendering an empty table.

### 4. Write the file

`Write` to `reports/<timestamp>-<slug>.md`:

- **`<timestamp>`** = local time as `YYYY-MM-DD-HHmm` (e.g. `2026-04-27-1432`). Reverse-alphabetical sort on the filename puts the newest report at the top of the explorer with no metadata read.
- **`<slug>`** = kebab-case derived from the report title, max ~40 chars. e.g. `tasks-completed-last-30-days`.

If `reports/` doesn't exist yet, `Write` creates it.

### 5. Tell the admin where it landed

Show the path and the headline numbers so they don't have to open the file to know if it answered the question. Offer to refine in place — further iterations should `Edit` the same file rather than create a new timestamped one (a fresh prompt = fresh file; a refinement = edit-in-place).

```
Wrote reports/2026-04-27-1432-tasks-completed-last-30-days.md.

12 tasks completed in the window — 7 by Alice, 5 by Bob.

Want me to break it down by status, or look at what's still open?
```

## What this skill is *not* for

- **Canned overviews** — use the **Generate overview** button (one click, deterministic, free, runs in <1s).
- **Live dashboards** — reports are point-in-time snapshots. If the admin wants something they'll re-run regularly, write the snapshot now and offer to `/schedule` a recurring agent for it.
- **Multi-step playbooks** — those are workflows (V2). A report is read-only output.

## After this run

Before signing off, re-read this command body. If the admin's choices narrowed any defaults (default scope/time window, format, sections to include, what data sources to pull, whether to schedule a recurring version), rewrite the relevant sections to match — and snapshot the prior body to `filestores/commands/report/_history/<ms>.md` first. If the report scope narrowed substantially, rename to a more specific command. Tell the admin in one line what changed.
