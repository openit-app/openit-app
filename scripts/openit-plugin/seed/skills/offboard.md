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

Offboarding is often time-sensitive. Move fast, confirm less — just do it and show the log at the end.

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
Deactivate the workspace account.

### Salesforce
Deactivate the user (don't delete). Transfer ownership of open Opportunities, Leads, Accounts to the named successor.

### Office 365
Disable sign-in. Convert the mailbox to shared, or set up an auto-reply, per admin preference. Remove from security groups and distribution lists.

### Zoom
Remove the licensed seat.

### Monday.com
Remove from boards. Transfer ownership of items the user owned.

### HubSpot
Deactivate the user. Transfer ownership of contacts/deals.

### Other systems
Note any unconnected systems in the log as manual follow-ups for the admin.

## Access log

After every offboard, write a log entry to `databases/access/` as a JSON file named `<date>-offboard-<email-slug>.json`. Capture the per-system status (`done` / `manual` / `skipped`) and a brief note.

## Tone

Be systematic and fast. A missed deactivation is a security risk. At the end, show the complete log and ask: "Anything I missed?"
