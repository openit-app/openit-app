# Tasks

A task is **something the admin wants to track for themselves**. File a task when the admin says "remind me to ...", "I need to do X", or asks you to track work that spans multiple sessions.

**Do not create a task for every session.** A session where the admin pokes around, runs `/backup`, or asks you a question is *not* a task — the trace already captures it. Forcing those into the task list pollutes it.

## Task file shape

`tasks/task-<unix-ms>-<rand>.md`:

```markdown
---
status: todo
title: "Roll out new SSO provider"
assignee: "Ada Lovelace"
createdAt: 2026-05-23T14:00:00Z
---

Notes / checklist / scratch space goes here. Free-form markdown.
```

- `status` is one of `todo`, `in-progress`, `complete`. Nothing else — there is no `blocked`, `cancelled`, etc. in v1.
- `title` is short and human-readable.
- `assignee` is who owns the task. **Default it to the admin** — the person running OpenIT — so tasks you file on their behalf don't land as "Unassigned". Get the admin's name from their profile (`profile.md`; see [`profile.md`](./profile.md)). If the profile has no name yet, **ask once** ("Who should I put down — what's your name?"), save it to `profile.md`, then use it from then on. **Never guess the name from git, the OS, or the laptop** — many admins don't have git installed, and a wrong guess is worse than asking. Only set a different name when the task is explicitly for someone else. If you still can't determine it, omit the field rather than guessing.
- The body is free-form markdown.

## Creating and cycling

To create a task, write the file directly (`tasks/task-<unix-ms>-<rand>.md`) or tell the admin to use the **+ New** affordance on the Tasks station. Set `assignee` to the admin (from `profile.md`, asking once if it's not recorded yet) unless the task is for someone else. Cycle status by updating the frontmatter field. The user can also click the status pill in the UI to cycle.

The admin owns the task list. **Do not auto-resolve tasks or auto-cycle status without their direction.**
