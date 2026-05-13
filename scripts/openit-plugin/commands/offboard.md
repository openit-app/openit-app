---
name: offboard
description: Revoke access across Slack, Zoom, Salesforce, Office 365, and other systems when an employee leaves.
---

## Prerequisites

This skill deprovisions access across multiple systems. Check which are connected:

- **Salesforce CLI** (`sf`) — for deactivating Salesforce users.
- **Office 365 CLI** (`m365`) or **Microsoft 365 MCP** — for disabling M365 accounts.
- **Slack** — built into OpenIT. For removing workspace members.
- **Zoom MCP** — for removing licensed users.
- **Monday.com MCP** — for removing board members.
- **HubSpot MCP** — for revoking CRM user access.

Not all systems need to be connected. Skip any that aren't set up and note them as manual follow-ups in the access log.

## What this skill does

You walk the admin through offboarding a departing employee. For each system the org uses, you revoke access, hand off ownership, and log every action.

Offboarding is often time-sensitive (employee left suddenly, security risk). Move fast, confirm less — just do it and show the log at the end.

## How to interact

Ask the admin upfront:

1. **Who?** — name, email, last day.
2. **Which systems?** — or default to all connected ones.
3. **Ownership transfers?** — who takes over open Salesforce opportunities, Monday boards, Drive files, etc.

Then execute each system one by one.

## Offboarding flow

For each connected system:

1. **Deactivate/remove** the user — never delete (preserve audit trail).
2. **Transfer ownership** of any records the user owned, per the admin's earlier answer.
3. **Log** every action.

### Slack
- Deactivate the workspace account
- Log: "Slack: deactivated jane@acme.com"

### Salesforce
- Deactivate the user (don't delete)
- Transfer ownership of open Opportunities, Leads, Accounts to the named successor
- Log: "Salesforce: deactivated jane@acme.com, transferred 12 open Opps to bob@acme.com"

### Office 365
- Disable sign-in (block the user)
- Convert the mailbox to shared, or set up an auto-reply, per admin preference
- Remove from security groups and distribution lists
- Log: "O365: blocked sign-in, mailbox → shared, removed from Sales Team"

### Zoom
- Remove the licensed seat (license freed for reuse)
- Log: "Zoom: removed jane@acme.com"

### Monday.com
- Remove from boards
- Transfer ownership of items the user owned
- Log: "Monday: removed jane@acme.com, transferred 7 items to bob@acme.com"

### HubSpot
- Deactivate the user
- Transfer ownership of contacts/deals
- Log: "HubSpot: deactivated jane@acme.com, transferred deals to bob@acme.com"

### Other systems
If the admin mentions systems not currently connected (e.g., "also revoke Okta, JumpCloud, 1Password"), note them as manual follow-ups: "MANUAL: Okta — deactivate user in the Okta dashboard."

## Access log

After every offboard, write a log entry to `databases/access/`. Each entry is a JSON file:

```json
{
  "action": "offboard",
  "employee": "Jane Smith",
  "email": "jane@acme.com",
  "lastDay": "2026-05-06",
  "date": "2026-05-06",
  "systems": {
    "slack": { "status": "done", "details": "deactivated" },
    "salesforce": { "status": "done", "details": "deactivated, 12 Opps → bob@acme.com" },
    "office365": { "status": "done", "details": "blocked, mailbox → shared" },
    "zoom": { "status": "done", "details": "license removed" },
    "monday": { "status": "done", "details": "removed, items → bob@acme.com" },
    "hubspot": { "status": "done", "details": "deactivated, deals → bob@acme.com" },
    "okta": { "status": "manual", "details": "admin to deactivate in Okta dashboard" }
  }
}
```

File name: `<date>-offboard-<email-slug>.json` (e.g., `2026-05-06-offboard-jane-smith.json`).

## Tone

Be systematic and fast. A missed deactivation is a security risk. After each system, log what you did. At the end, show the complete log and ask: "Anything I missed?"
