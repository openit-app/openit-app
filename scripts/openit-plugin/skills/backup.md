---
name: Backup
description: Export data from Salesforce, HubSpot, Monday, and Slack, then upload to Google Drive.
---

## Prerequisites

This skill exports data from multiple systems and uploads backups to Google Drive. Check which sources the admin wants to back up and verify the required tools are connected:

- **Salesforce** — Salesforce CLI (`sf`). Auth: `sf org login web`.
- **HubSpot** — HubSpot MCP. Connect from the Tools station (MCP tab).
- **Monday.com** — Monday.com MCP. Connect from the Tools station (MCP tab).
- **Slack** — Slack is built into OpenIT. No extra setup needed if already connected.
- **Google Drive** — Google Drive MCP or Google Workspace CLI (`gws`). This is where backups land.

Not all sources need to be connected. Ask the admin which ones they want to back up and skip any that aren't set up.

## What this skill does

You run a monthly (or on-demand) data backup: export records from each connected system and upload the resulting files to a designated Google Drive folder.

## How to interact

The admin may not know what's exportable from each system. Guide them:

1. **Ask what to back up**: "Which systems do you want to back up? Salesforce, HubSpot, Monday, Slack — or all of them?"
2. **Ask where to put it**: "What Google Drive folder should I upload to? (e.g. `Backups/2026-05/`)"
3. Run each export silently, report progress per system.
4. Upload all files to Drive, confirm when done.

## Salesforce backup

Export key objects as CSV files using the Salesforce CLI:

Common objects to export:
- Contacts: `sf data query --query "SELECT Id, Name, Email, Phone, Account.Name FROM Contact" --result-format csv`
- Opportunities: `sf data query --query "SELECT Id, Name, StageName, Amount, CloseDate, Account.Name FROM Opportunity" --result-format csv`
- Accounts: `sf data query --query "SELECT Id, Name, Industry, BillingCity, BillingState FROM Account" --result-format csv`
- Leads: `sf data query --query "SELECT Id, Name, Email, Company, Status FROM Lead" --result-format csv`
- Cases: `sf data query --query "SELECT Id, CaseNumber, Subject, Status, Priority, Contact.Name FROM Case" --result-format csv`

Save each as a file named `salesforce-<object>-<YYYY-MM-DD>.csv`.

Ask the admin if they want all objects or a subset. If they mention specific reports, translate those into the right SOQL queries.

## HubSpot backup

Use the HubSpot MCP to export:
- Contacts
- Companies
- Deals
- Tickets

Save each as `hubspot-<object>-<YYYY-MM-DD>.csv` or `.json`.

## Monday.com backup

Use the Monday.com MCP to export:
- Boards and their items
- Ask the admin which boards matter (they may have dozens but only care about a few)

Save as `monday-<board-name>-<YYYY-MM-DD>.json`.

## Slack backup

Export recent messages from key channels using the Slack integration:
- Ask which channels to back up
- Export the last 30 days of messages (or whatever window the admin specifies)

Save as `slack-<channel>-<YYYY-MM-DD>.json`.

## Upload to Google Drive

After all exports are complete:
1. Create a date-stamped folder in Drive (e.g. `Backups/2026-05-06/`)
2. Upload each file
3. Report: "Uploaded 14 files to Backups/2026-05-06/. Here's what's in there: [list]"

## Scheduling

After the first successful run, offer to set up a recurring backup:

"Want me to schedule this to run automatically every month? I'll need to set up a couple of things first."

Claude Code routines run on Anthropic's cloud, which needs a GitHub repo to clone. Walk through the setup:

### Step 1: Check prerequisites

- **GitHub CLI** (`gh`) must be installed. Check with `which gh`. If missing, tell the admin to install it from the Tools station.
- **GitHub auth**: Check with `gh auth status`. If not logged in, run `gh auth login`.

### Step 2: Create a GitHub repo for the vault (first time only)

Check if the vault is already a GitHub repo:
```bash
gh repo view 2>/dev/null
```

If not, create one:
```bash
git init
git add -A
git commit -m "initial: OpenIT vault"
gh repo create openit-vault --private --source=. --push
```

Confirm with the admin: "I'll create a private GitHub repo called 'openit-vault' to store your project. This is needed for scheduled routines to work. OK?"

### Step 3: Wire up the routine

```
/schedule monthly backup on the 1st at 6am
```

Make sure the routine includes the same MCP connectors the backup needs (Salesforce, HubSpot, Monday, Google Drive).

### Step 4: Save for future use

After the first scheduling setup succeeds, write a KB article at `knowledge-bases/scheduling-setup.md` documenting:
- That the vault is connected to GitHub at `<repo-url>`
- How to add new scheduled routines (just run `/schedule`)
- The MCP connectors that are wired up

This way, future scheduling requests skip the setup and go straight to `/schedule`.

## Tone

Be methodical and reassuring. Backups are anxiety-inducing — the admin wants to know nothing was missed. After each system export, confirm the count: "Exported 847 Salesforce contacts." After upload, give a full inventory. End with: "All backups complete. Everything's in Drive."
