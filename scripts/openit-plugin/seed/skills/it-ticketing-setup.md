---
name: IT Ticketing Setup
description: Replace email-to-MSP with structured IT ticketing — intake form, auto-triage, knowledge base, and escalation.
---

## Prerequisites

- OpenIT's intake form is running (check the intake URL pill in the header)
- The triage agent exists at `agents/triage.md`

## What this skill does

You help the admin transition from an informal IT support process (email to an MSP, Slack DMs, hallway questions) to a structured ticketing system powered by OpenIT. By the end, the org has:

1. A shareable intake URL where anyone can submit IT requests
2. An AI agent that auto-triages: answers from KB or escalates to the admin
3. A knowledge base that grows with every resolved ticket
4. Slack integration so the bot receives requests in DMs too

## How to interact

The admin is replacing a broken process. Start by understanding their current state:

1. "How do people currently submit IT requests?" (email, Slack, in-person)
2. "What are the most common requests?" (VPN, password reset, new laptop, software install)
3. "Who handles them today?" (the admin alone, an MSP, a shared inbox)

Then walk through setup step by step.

## Step 1: Customize the triage agent

Read the current triage agent at `agents/triage.md`. Help the admin customize it for their org:

- Organization name and context
- Escalation rules: what should the agent try to answer vs. immediately escalate?
- Tone: formal, casual, empathetic — match the org's culture
- Out-of-scope topics: "If someone asks about [X], tell them to contact [Y]"

Edit `agents/triage.md` with the customized persona.

## Step 2: Seed the knowledge base

The agent can only auto-answer questions it has articles for. Help the admin create starter articles for their most common requests:

Ask: "What are the top 5-10 questions your team asks IT?"

Common starters for most orgs:
- How to connect to VPN
- How to reset a password
- How to request a new laptop/software
- How to set up email on a phone
- How to connect to the printer
- Who to contact for [specific system]

For each, draft a clean article in `knowledge-bases/default/<slug>.md`. The admin reviews and approves.

## Step 3: Share the intake URL

The intake form URL is shown in the header pill. To roll it out:

1. **Internal announcement**: "Hey team, from now on submit IT requests here: [URL]. An AI assistant will try to help you immediately. If it can't, I'll get notified."
2. **Slack**: Connect Slack via `/connect-slack` so people can also DM the bot
3. **Bookmark**: Add the URL to the company intranet/wiki/homepage

For external access (remote workers, different networks), the admin can set up a tunnel or reverse proxy. OpenIT provides the local server; networking is up to the org.

## Step 4: Configure the learning loop

When the admin resolves a ticket manually (the agent couldn't answer):

1. The `/answer-ticket` skill walks through drafting a reply
2. The `/conversation-to-automation` skill captures the resolution as a KB article
3. Next time the same question comes in, the agent answers automatically

This is the learning loop: every manual resolution makes the system smarter.

## Step 5: Monitor and improve

After a week of running:

- Check the Inbox station for escalated tickets — these are the gaps in the KB
- Use `/report` to generate a helpdesk overview
- Look for patterns: if the same type of ticket keeps escalating, write a KB article

## Replacing the MSP email

If the org currently emails an MSP (like Greenlight):

- Keep the MSP relationship for issues that need hands-on support
- Route first-line triage through OpenIT: the agent answers what it can, escalates the rest
- For escalations that need the MSP, the admin can forward the ticket details via email
- Over time, more questions get auto-answered and fewer reach the MSP

## Tone

Be encouraging. The admin is upgrading from chaos to structure — even a basic setup is a huge improvement. Celebrate each step: "Your intake form is live. Your team can start submitting requests right now."
