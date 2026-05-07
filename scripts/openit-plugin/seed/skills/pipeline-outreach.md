---
name: pipeline-outreach
description: Pull a Salesforce pipeline report, draft personalized emails for prospects in a specific stage, and send via Gmail.
---

## Prerequisites

- **Salesforce CLI** (`sf`) — installed and authenticated via `sf org login web`.
- **Gmail** — connected via Claude.ai Gmail connector or Google Workspace CLI (`gws`).

## What this skill does

You automate the recurring pipeline-to-outreach workflow: pull a report from Salesforce, filter contacts by stage, draft personalized emails, send via Gmail, and update Salesforce records. This replaces the manual process of running a report, exporting to a spreadsheet, writing individual emails, and updating the CRM.

## How to interact

The admin describes what they want in plain terms:

- "Run the pipeline report and email everyone in Prospecting"
- "Send follow-ups to all leads that haven't responded in 2 weeks"
- "Draft outreach emails for the Q2 prospects"
- "Email the board with this month's pipeline summary"

### Outreach flow:

1. **Pull the report**: Ask what stage/filter to use, run the SOQL query
2. **Show the list**: Present contacts with name, email, company, stage, last activity
3. **Draft emails**: For each contact (or group), draft a personalized email
4. **Review**: Show all drafts for approval before sending
5. **Send**: Send via Gmail, report progress
6. **Update CRM**: Mark contacts as "Contacted", log activity date

### Report-only flow:

Sometimes the admin just wants the report, not the outreach:

- "Show me the pipeline by stage"
- "How many opportunities are in each stage?"
- "What's the total pipeline value this quarter?"

Pull the data and present it as a clean summary with totals.

## Common Salesforce queries

**Pipeline by stage:**
```bash
sf data query --query "SELECT StageName, COUNT(Id) cnt, SUM(Amount) total FROM Opportunity WHERE IsClosed = false GROUP BY StageName ORDER BY StageName" --result-format csv
```

**Prospects to contact:**
```bash
sf data query --query "SELECT Id, Name, Email, Account.Name, StageName, LastActivityDate FROM Opportunity WHERE StageName = 'Prospecting' AND Email != null ORDER BY LastActivityDate ASC" --result-format csv
```

**Stale leads (no activity in N days):**
```bash
sf data query --query "SELECT Id, Name, Email, Company, LastActivityDate FROM Lead WHERE LastActivityDate < LAST_N_DAYS:14 AND Status = 'Open'" --result-format csv
```

## Email drafting

For each contact, draft a personalized email based on:
- Their name and company
- The opportunity stage and context
- Any notes from the Salesforce record
- The admin's instructions ("keep it short", "mention the demo", etc.)

Show all drafts in a batch for review: "Here are 8 draft emails. Review and tell me to send all, edit specific ones, or skip any."

**Never send without explicit approval.** The admin's reputation is on the line.

## Scheduling

After a successful run, offer to schedule it as a routine:

"Want me to run this pipeline outreach every Monday at 9am? I'll pull the report, draft the emails, and wait for your approval before sending."

Guide through the GitHub repo + `/schedule` setup if needed (same pattern as the backup skill).

## After sending

Update Salesforce:
- Set `LastActivityDate` to today
- Add a note: "Outreach email sent via OpenIT on [date]"
- If the admin wants, move the stage forward (e.g., Prospecting → Qualification)

Confirm: "Sent 8 emails, updated 8 Salesforce records. Next pipeline outreach is scheduled for next Monday."

## Tone

Be efficient and sales-aware. The admin is doing outreach on behalf of their team — the emails need to sound professional and personal, not mass-blasted. Show them you understand the pipeline context, not just the data.
