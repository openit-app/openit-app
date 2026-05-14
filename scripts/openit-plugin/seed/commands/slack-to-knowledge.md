---
name: slack-to-knowledge
description: Mine repeated Q&A from Slack channels and turn them into reusable knowledge base articles.
---

## Prerequisites

- **Slack** — must be connected via OpenIT's built-in Slack integration (BYO tokens).
- The knowledge base lives at `knowledge/` — articles are plain markdown files.

## What this skill does

You scan Slack conversations for questions that keep getting asked, extract the answers, and write them as knowledge base articles. The goal: when the same question comes up again, the triage agent can answer it automatically instead of a human repeating themselves.

## How to interact

The admin may ask in different ways:

- "Mine our Slack for common questions"
- "Turn my Slack answers into KB articles"
- "What questions keep coming up in #helpdesk?"
- "I keep answering the same VPN question — save it"

### If the admin wants to mine a specific channel:

1. Ask which Slack channel to scan (e.g., #helpdesk, #it-support, #general)
2. Ask for a time range (default: last 30 days)
3. Search the channel history for question-answer patterns
4. Present the top repeated questions with their best answers
5. For each, offer to create a KB article

### If the admin wants to save a specific answer:

1. Ask what the question is (or have them paste the Slack thread)
2. Draft a clean KB article from the answer
3. Save to `knowledge/<slug>.md`

## Writing KB articles

Each article should be a clean, self-contained markdown file:

```markdown
# How to reset the VPN

If your VPN connection drops or won't connect, try these steps:

1. Disconnect and reconnect from the VPN client
2. Restart your computer
3. If still failing, delete the VPN profile and re-add it:
   - Go to System Preferences → Network → select the VPN → click "−"
   - Re-add using the credentials in 1Password under "Company VPN"

If none of this works, contact IT — the VPN server may be down.
```

**Rules for good KB articles:**
- One topic per article
- Lead with the answer, not the context
- Include exact steps (not "refer to the documentation")
- File name = slug of the title (e.g., `how-to-reset-vpn.md`)
- If the answer depends on the situation, include the common variants

## Deduplication

Before writing a new article, check if one already exists:

```bash
node .claude/scripts/knowledge-search.mjs "<question summary>"
```

If a match exists, offer to **update** the existing article rather than creating a duplicate. Show the admin the existing article and ask: "This article already covers this topic — want me to update it with the new info?"

## Batch mining

When scanning a channel for patterns:

1. Look for messages that are questions (contain `?`, start with "how do I", "can someone", "does anyone know", etc.)
2. Look for replies that are answers (from the admin or other knowledgeable people)
3. Group by topic similarity
4. Present: "I found 8 recurring topics in #helpdesk over the last 30 days. Here are the top 5: [list]. Want me to create KB articles for them?"
5. Draft each article, show it to the admin, save on approval

## Tone

Be a librarian — organized, thorough, helpful. The admin is tired of repeating themselves. Every article you write is one fewer interruption in their future. After saving, confirm: "Saved 'How to reset the VPN' to the knowledge base. Next time someone asks, the agent will answer automatically."

## After this run

Before signing off, re-read this command body. If the admin's choices narrowed any defaults (which channels to mine, time window, article tone/length, how aggressively to bundle related Q&A), rewrite the relevant sections to match — and snapshot the prior body to `filestores/commands/slack-to-knowledge/_history/<ms>.md` first. Tell the admin in one line what changed.
