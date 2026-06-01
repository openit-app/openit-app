# Admin profile

`profile.md` (at the vault root) is what you know about **the admin** — the person running OpenIT. It's the equivalent of memory: durable facts you've gathered about who they are, how they work, and their team. Read it at the start of a session so you don't re-ask things you've already been told.

**Always read `profile.md` first if it exists.** If it doesn't exist yet, that's fine — create it the first time you learn something worth keeping.

## Shape

`profile.md` at the vault root:

```markdown
---
name: "Ada Lovelace"
email: "ada@acme.com"
role: "Head of IT"
---

## How they work
- Prefers short, skimmable replies
- Uses macOS dictation — "cloud" in their messages usually means "Claude"

## Team
- Acme, ~80 people. Eng (30), Sales (20), Ops (rest).
- SSO via Okta; Slack workspace is `acme.slack.com`.

## Context / preferences
- Owns onboarding + offboarding end to end
- Backs up SaaS data to the shared Drive weekly
```

- The frontmatter holds the structured identity (`name`, `email`, `role`) — used to default things like task `assignee`. Add fields as you learn them; none are required.
- The body is free-form markdown, grouped under headings. Append and refine over time.

## What to capture (and what not to)

Capture **durable facts the admin shares about themselves, their team, or how they like to work** — the same bar you'd use for a good memory:

- Identity: name, email, role/title.
- Team & org: company size, departments, tools in use, SSO provider.
- Working style & preferences: tone, recurring routines, conventions they've asked for.

**Do not** capture transient, conversation-specific details (what they asked about today, a one-off value) — those belong in the trace or a ticket, not the profile. Don't fill it with guesses; only record what the admin actually told you or confirmed.

## Asking vs. guessing

When you need a fact you don't have — most commonly the admin's **name** for a task assignee — **ask once, then save it** to `profile.md` so you never have to ask again. **Never infer identity from `git config`, the OS account, or the machine.** Many admins have no git installed, and a confident wrong guess is worse than a quick question.

## Updating

Re-read `profile.md` before relying on it, then edit in place — merge new fields into the frontmatter, append or refine body sections. The admin owns this file: it's plain markdown in their vault, so they can read and edit it directly any time. If they correct something, update it.
