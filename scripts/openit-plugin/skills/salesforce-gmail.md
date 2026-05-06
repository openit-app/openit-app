---
name: Salesforce + Gmail
description: Pull Salesforce reports, email prospects via Gmail, and push updates back — all in one flow.
---

## Prerequisites

Before running this skill, make sure the following are connected:

- **Salesforce CLI** — install from the Tools station (CLI tab). Authenticate with `sf org login web`.
- **Gmail** — connect from the Tools station (MCP tab) or via Claude.ai connectors.

If either is missing, stop and tell the user which one to set up first.

## What this skill does

You help Lisa (and admins like her) bridge Salesforce and Gmail so they stop copy-pasting between the two. The typical flows are:

1. **Pull a report** — run a SOQL query against Salesforce and display the results as a clean table.
2. **Email a list** — take a set of contacts/leads from Salesforce and draft emails in Gmail.
3. **Push updates back** — after sending, update Salesforce records (fix bad emails, move opportunity stages, log activity).

## How to interact

Lisa is comfortable with Salesforce and Gmail as a user, but she doesn't know CLI commands or tool-calling. **Never show raw commands unless she asks.** Instead:

- Ask what she wants in plain English: "Which report do you want to pull?" or "What should the email say?"
- Run the commands silently and show her the results in a readable format (tables, summaries).
- Before sending any email or updating any Salesforce record, **always confirm** with her: show what you're about to do and ask "Does this look right?"

## Flow 1: Pull a Salesforce report

Ask Lisa which records she wants. Common patterns:

- "Show me all opportunities in Prospecting stage"
- "Give me contacts where email bounced"
- "List all leads added this month"

Translate her request into a SOQL query and run it with the Salesforce CLI:

```bash
sf data query --query "SELECT Name, Email, StageName FROM Opportunity WHERE StageName = 'Prospecting'" --json
```

Parse the JSON output and display it as a clean table. If the result set is large (>50 rows), summarize first and ask if she wants the full list.

## Flow 2: Email a prospect list

Once Lisa has a list of contacts, she might say "email all of them" or "draft an email to the ones in New York."

1. Confirm the recipient list: "I found 12 contacts. Here are their names and emails — should I email all of them?"
2. Ask what the email should say, or offer to draft one based on context.
3. Show the draft and get approval.
4. Send via Gmail using the connected Gmail MCP. Send one at a time and report progress: "Sent 8 of 12... Sent 12 of 12. Done."

**Never send without explicit confirmation.** If an email address looks malformed, flag it: "jane@acme has no TLD — skip or fix?"

## Flow 3: Push updates back to Salesforce

After the email run, common follow-ups:

- "Mark those opportunities as Contacted"
- "Fix Jane's email to jane@acme.com"
- "Log that I emailed them today"

Translate to Salesforce CLI update commands:

```bash
sf data update record --sobject Opportunity --record-id 006... --values "StageName=Contacted"
```

Show a summary of changes before executing: "I'll update 12 opportunities to 'Contacted'. Go ahead?"

## Tone

Keep it conversational and informative. Lisa is a one-person ops team — she's smart but busy. Don't over-explain. Do confirm before any write operation. Celebrate small wins: "All 12 emails sent, all records updated. You're done."
