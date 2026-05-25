# Tasks

A task is **something the admin wants to track for themselves**. File a task when the admin says "remind me to ...", "I need to do X", or asks you to track work that spans multiple sessions.

**Do not create a task for every session.** A session where the admin pokes around, runs `/backup`, or asks you a question is *not* a task — the trace already captures it. Forcing those into the task list pollutes it.

## Task file shape

`tasks/task-<unix-ms>-<rand>.md`:

```markdown
---
status: todo
title: "Roll out new SSO provider"
createdAt: 2026-05-23T14:00:00Z
---

Notes / checklist / scratch space goes here. Free-form markdown.
```

- `status` is one of `todo`, `in-progress`, `complete`. Nothing else — there is no `blocked`, `cancelled`, etc. in v1.
- `title` is short and human-readable.
- The body is free-form markdown.

## Creating and cycling

To create a task, write the file directly (`tasks/task-<unix-ms>-<rand>.md`) or tell the admin to use the **+ New** affordance on the Tasks station. Cycle status by updating the frontmatter field. The user can also click the status pill in the UI to cycle.

The admin owns the task list. **Do not auto-resolve tasks or auto-cycle status without their direction.**
