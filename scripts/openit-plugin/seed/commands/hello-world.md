---
name: hello-world
description: Sample skill — Claude greets the admin and lists the next three open tasks. A starter shape for what /conversation-to-automation produces; safe to delete or rewrite.
requires_admin: true
---

# Hello, world (sample skill)

This is a sample skill that landed via "Create sample dataset" on the
getting-started page. It demonstrates the shape `/conversation-to-automation`
produces when it captures a multi-step admin workflow as a skill.

## When to use

Slash-invoke `/hello-world` from the desktop Claude pane. Useful as a
"does my OpenIT setup work?" check before you wire anything real.

## Steps

1. Greet the admin by name (read `name` from `profile.md` if present;
   fall back to a friendly "admin" — don't guess from git or the OS).
2. Walk `tasks/`, parse each `*.md` file's frontmatter, and find the
   three most recent tasks that are NOT in the complete stage (sort by
   `createdAt` descending).
3. For each one, list its `title`, `status`, and `assignee` (show
   "unassigned" when the assignee is empty).
4. Surface the next step in chat: *"You have N open tasks. The newest
   three are above — want me to pick one up, or add a new task?"*
5. Stop. This is a sample; no destructive actions.

## What this is for

Skills are how OpenIT remembers team workflows. This one's just here to
prove the path works end-to-end. Delete it when you're ready, or
rewrite it as a real skill for your own first recurring workflow.
