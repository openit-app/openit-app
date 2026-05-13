---
name: onboard
description: Grant access across Slack, Zoom, Salesforce, Office 365, and other systems when a new employee joins.
---

## Prerequisites

This skill provisions access across multiple systems. Check which are connected:

- **Salesforce CLI** (`sf`) — for creating Salesforce users.
- **Office 365 CLI** (`m365`) or **Microsoft 365 MCP** — for creating M365 accounts.
- **Slack** — built into OpenIT. For inviting workspace members.
- **Zoom MCP** — for adding licensed users.
- **Monday.com MCP** — for adding board members.
- **HubSpot MCP** — for granting CRM user access.

Not all systems need to be connected. Skip any that aren't set up and note them as manual follow-ups in the access log.

## What this skill does

You walk the admin through onboarding a new employee. For each system the org uses, you check what access is needed, provision it, and log every action.

## How to interact

Ask the admin upfront:

1. **Who?** — name, email, role/department.
2. **Which systems?** — or default to all connected ones.
3. **What level of access?** — role, permissions, groups. If the admin isn't sure, suggest based on the role (e.g., "Sales reps typically get Salesforce CRM User + HubSpot Sales Access").

Then execute each system one by one, confirming as you go.

## Onboarding flow

For each connected system:

### Slack
- Invite the user to the workspace
- Add them to role-appropriate channels (ask the admin which ones, or suggest based on department)

### Salesforce
- Create a user record or activate an existing deactivated one
- Assign the appropriate profile and permission sets

### Office 365
- Create or enable the user account
- Assign licenses (E1, E3, etc. — ask the admin)
- Add to security groups and distribution lists

### Zoom
- Add as a licensed user

### Monday.com
- Add to relevant boards

### HubSpot
- Invite as a user with appropriate permissions

### Other systems
Note any unconnected systems in the log as manual follow-ups for the admin.

## Access log

After every onboard, write a log entry to `databases/access/` as a JSON file named `<date>-onboard-<email-slug>.json`. Capture the per-system status (`done` / `manual` / `skipped`) and a brief note.

## Tone

Be systematic and thorough. A missed step means the new hire can't work day one. After each system, confirm what you did. At the end, show the complete log and ask: "Anything I missed?"
