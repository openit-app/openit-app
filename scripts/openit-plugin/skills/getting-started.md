---
name: getting-started
description: Interactive guided tour — experience the OpenIT learning loop. File a ticket as an employee, teach the agent as an admin, then watch it handle the next one on its own.
---

## When to use

Run when the admin clicks "Start the tour" on the welcome page, or types `/getting-started` directly.

## Tone

You are a friendly guide. One instruction per message. These are IT admins who may never have used Claude Code before. No "and/or", no "by the way". Give them exactly one thing to do, then wait.

## Before you start

1. Read `.openit/intake.json` via Bash to get the intake URL:
   ```bash
   cat .openit/intake.json
   ```
   Extract the `url` field. If the file doesn't exist or has no URL, tell the admin: "The intake server isn't running — try restarting the app." and stop.

2. Glob `databases/tickets/*.json` to note any existing ticket filenames so you can identify new ones later.

---

## Act 1 — File a ticket as an employee

Don't open anything yet. Explain the setup and what they'll need to do, all in one message.

Tell the admin:

> We're going to simulate an employee asking for IT help. You'll play the employee first, then switch back to the admin seat to see how OpenIT handles it.
>
> I'm going to open the intake form in your browser — that's what your employees see when they need help. Here's what to do:
>
> 1. **Enter any email** — like alex@example.com — and **hit Submit**
> 2. **Click the "VPN issues" bubble** to send a question
>
> After that, **come back to OpenIT** — you'll see the agent start working.
>
> Ready?

Wait for acknowledgment (any response — "yes", "ready", "ok", "go", etc.).

Once they acknowledge, open the intake form:
```bash
open "<intake-url>"
```

Then immediately tell the admin (don't wait — give them this while the form loads):

> Once you've sent the question, **come back to OpenIT**. The app will pull itself to the front.
>
> You'll see an orange banner at the very top that says **"Agent is responding"** with **"Click to view →"** on the right.
>
> **Click that banner** to watch the agent work in real time.

Do NOT wait for the admin to reply here. Instead, immediately start polling the ticket state in the background:

1. `Glob "databases/tickets/*.json"` — find the newest ticket (not in your earlier list).
2. `Read` the ticket. If `status` is `agent-responding`, wait a few seconds and re-read.
3. Once the status is `escalated`, proceed immediately.

Read the conversation: `Glob "databases/conversations/<ticketId>/msg-*.json"`, read the turns.

Now tell the admin (this should appear right as the escalation notification pops up):

> The agent searched the knowledge base, found nothing, and escalated the ticket to you.
>
> You should see a **notification card** in the top-right corner with a pulsing orange dot that says **"Needs your reply"** and **"Click to respond →"**.
>
> **Click that notification.** It will open the conversation AND automatically run `/answer-ticket` in Claude Code so I can help you respond.

Wait for the admin to click the notification. When they do, `/answer-ticket` will auto-run in this Claude Code session. **You will receive the `/answer-ticket` command.** When you do, execute it — but with these overrides for the tour:

**Tour overrides for `/answer-ticket`:**
- **Drafting the reply:** Show the draft and ask "Want me to send this, or would you like to change it?" — this is fine, it's going to the employee.
- **Sending the reply:** On approval, send immediately. Mark the ticket as `resolved` automatically — do NOT ask the admin whether to set `open` or `resolved`. Just resolve it.
- **Capturing the KB article:** Write the KB article immediately. Do NOT ask "Good to save?" — just create it. This is a guided tour; every answer should become knowledge.
- **After the KB article is created:** Tell the admin:

> Done. I replied to the employee, resolved the ticket, and captured your answer as a **knowledge base article**.
>
> Click on the **Knowledge** tile in the left panel. You should see the article I just created. **Click on it to read it. Do you see it?**

Wait for the admin to confirm (e.g. "yes", "I see it", "yep"). This is a direct question — expect a direct answer before moving on.

---

## Act 3 — Prove it learned

Once the admin confirms they've seen the KB article:

Tell the admin:

> Now let's see if the agent actually learned. I'm going to open the intake form again.
>
> This time, pretend you're a **different employee**:
>
> 1. **Enter a different email** — like jordan@example.com — and **hit Submit**
> 2. **Click the "VPN issues" bubble** again
>
> After that, **come back to OpenIT** to see what happens.
>
> Ready?

Wait for acknowledgment, then open the intake form:
```bash
open "<intake-url>"
```

Do NOT say anything else after opening the form. Wait for them to come back.

When they come back (the app will auto-focus when the ticket arrives), check the new ticket:

1. `Glob "databases/tickets/*.json"` — find the newest ticket (different from the one in Act 1).
2. `Read` it. Wait for `status` to leave `agent-responding` if needed.
3. Read the conversation.

If the ticket status is `open` (not `escalated`) — the agent answered from KB:

> The agent answered on its own this time. **No escalation.**
>
> It found the knowledge base article you created and used it to answer Jordan's question.
>
> **You taught it once, and now it handles VPN questions without you.** That's the self-learning loop.

If the ticket was `escalated` instead (edge case — keyword overlap didn't match), say:

> The agent escalated this one — the keyword search didn't match closely enough. But the knowledge is saved, and the more articles you add, the smarter it gets.

Either way, continue immediately in the same message — do NOT wait for acknowledgment:

> Now — during this tour, you already used two **commands** without realizing it:
>
> - `/getting-started` — this tour
> - `/answer-ticket` — which helped you respond and captured the answer as knowledge
>
> Commands are reusable workflows you can run anytime by typing `/` followed by the name. You can also create your own.
>
> **Click the Commands tile** in the left panel. See the first command — **load-sample-data**? **Click Run** next to it to fill the workspace with sample data.

Wait for the admin to click Run. When they do, the `/load-sample-data` command will run in Claude Code and create sample data. Once it completes, continue:

> The workspace is now full of sample data. Click **MORE** in the left panel and explore each tile:
>
> - **People** — click it to see the sample contacts
> - **Access** — onboard/offboard logs
> - **Assets** — device and equipment inventory
> - **Scripts** — automation scripts
>
> Everything in OpenIT is just files in a folder. You can open, edit, and organize them however you want.
>
> One more thing — **click on Tools**. That's where you connect your existing systems like Slack, Google Drive, and more. **Have you clicked on it?**

Wait for acknowledgment.

Then:

> That's OpenIT.
>
> Every ticket you answer teaches the system. Knowledge base articles, scripts, commands — they all compound. The more you use it, the less you have to do.
>
> When you're ready to clean up all the sample data, you can run the **cleanup** command from the Commands tile — or type `/cleanup` here.
>
> **What would you like to do next?**

---

## Rules

- **Every message must end with an action or a question.** Never leave the admin with nothing to do. If you're done explaining something, ask them to click something, confirm something, or tell them what's next. A dead-end message kills the tour.
- **One instruction at a time.** Never give the admin two things to do in one message.
- **Don't narrate mechanics.** Don't say "I'm going to glob the tickets directory." Just do it and talk about the result in plain language.
- **Wait for acknowledgment.** After each instruction, wait for the admin to respond before proceeding.
- **Be flexible with responses.** "done", "ok", "next", "I see it", "yes", or just hitting enter — all mean proceed.
- **Don't skip acts.** The full arc matters.
- **Handle errors gracefully.** If the intake server isn't running, if no ticket appears, if the agent crashes — say what happened plainly and suggest restarting.
- **No ticket creation for the tour itself.** This is a guided tour, not a working session.
- **Reference UI elements by name.** Say "the orange banner at the top" not "a notification." Say "the VPN issues bubble" not "one of the prompts."
- **Acknowledge the context switch.** The admin jumps between the browser and the macOS app. Explicitly say "come back to OpenIT" when they need to switch.
