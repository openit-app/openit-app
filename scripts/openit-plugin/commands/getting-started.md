---
name: getting-started
description: Interactive guided tour — meet the OpenIT workstation. File a task, watch the status flow, then explore the commands that automate the second loop.
---

## When to use

Run when the admin clicks "Start the tour" on the welcome page, or types `/getting-started` directly.

## Tone

You are a friendly guide. One instruction per message. These are small-team members who may never have used Claude Code before. No "and/or", no "by the way". Give them exactly one thing to do, then wait.

## Before you start

1. Glob `tasks/*.md` to note any existing task filenames so you can identify a new one later. If the folder doesn't exist yet, that's fine — it'll be created on first write.

---

## Act 1 — File your first task

Open with one short message that introduces the workstation in plain English.

Tell the admin:

> OpenIT is your team's shared workspace. Two loops drive it:
>
> 1. **Tasks** — a Linear-style task list for tracking work and assigning it to teammates.
> 2. **Commands** — reusable workflows anyone on the team (or I) can run.
>
> Let's start with tasks. **Click the Tasks tile** in the left panel — it's the one that says "TODAY" at the top.

Wait for acknowledgment (any response — "yes", "done", "open", "clicked", etc.).

Once they're on the Tasks view, tell them:

> Type a quick task in the box at the top — something simple, like **"write up our release process"** — and hit **Enter**.
>
> You should see it appear under **Todo**.

Wait for acknowledgment that the task appeared.

---

## Act 2 — Cycle a task through its statuses

Tell the admin:

> Each task has a **status pill** on the left — "Todo", "In progress", or "Complete". Click it.
>
> Watch what happens. Click it a couple more times.

Wait for acknowledgment.

> That's it — three statuses, one click each. No due dates, no ticketing ceremony. Just `todo → in-progress → complete`. Your team owns the list.

Pulse the Tasks tile so the admin can find their way back:

```bash
node -e "require('fs').writeFileSync('.openit/highlight.json',JSON.stringify({tiles:['tasks'],ts:Date.now()}))"
```

---

## Act 3 — The commands loop

Tell the admin:

> Now the other half. **Click the Commands tile** in the left panel.

Wait for acknowledgment.

> Commands are reusable workflows — anything from "run the weekly backup" to "generate the team report." You invoke them by typing `/` followed by the name in the chat.
>
> You already used one without realising — `/getting-started` is this tour.
>
> Let's run another. See **load-sample-data** in the list? **Click Run** next to it to fill the workspace with sample people, access logs, assets, and a couple of knowledge articles.

Wait for the admin to click Run. The `/load-sample-data` command will run in Claude Code and create sample data. Once it completes, continue:

> The workspace is now full of sample data. Click **MORE** in the left panel and explore each tile:
>
> - **People** — your teammates and contacts
> - **Knowledge** — how-tos and answers the team shares
> - **Assets** — device and equipment inventory
> - **Scripts** — runnable scripts
>
> Everything in OpenIT is a file or folder on disk. You can open, edit, and organize them however you want — and share the vault with your team.
>
> One more thing — **click Tools**. That's where you connect your existing systems like Google Drive and more. **Have you clicked on it?**

Wait for acknowledgment.

---

## Wrap-up

> That's OpenIT.
>
> Two loops: a personal task list for things you want to track, and a growing library of commands for the work you do over and over. The commands you capture, the knowledge articles you save, the scripts you write — they all compound. The more you use it, the less you have to do.
>
> When you're ready to clear the sample data, you can run the **cleanup** command from the Commands tile — or type `/cleanup` here.
>
> **What would you like to do next?**

---

## Rules

- **Every message must end with an action or a question.** Never leave the admin with nothing to do. A dead-end message kills the tour.
- **One instruction at a time.** Never give the admin two things to do in one message.
- **Don't narrate mechanics.** Don't say "I'm going to glob the tasks directory." Just do it and talk about the result in plain language.
- **Wait for acknowledgment.** After each instruction, wait for the admin to respond before proceeding.
- **Be flexible with responses.** "done", "ok", "next", "I see it", "yes", or just hitting enter — all mean proceed.
- **Don't skip acts.** The full arc matters: file a task → cycle status → meet the commands tile.
- **Handle errors gracefully.** If the Tasks station doesn't appear, if the task doesn't show up, if a command fails to run — say what happened plainly and suggest restarting.
- **No auto-filing of tasks for the tour itself.** This is a guided tour, not a working session. The admin files their own task in Act 1.
- **Reference UI elements by name.** Say "the status pill on the left of the row" not "the button." Say "the Tasks tile with TODAY at the top" not "the inbox."
