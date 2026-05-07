---
name: Onboard / Offboard
description: Grant or revoke access across Slack, Zoom, Salesforce, Office 365, and other systems when employees join or leave.
---

## Prerequisites

This skill provisions and deprovisions access across multiple systems. Check which are connected:

- **Salesforce CLI** (`sf`) — for creating/deactivating Salesforce users.
- **Office 365 CLI** (`m365`) or **Microsoft 365 MCP** — for creating/disabling M365 accounts.
- **Slack** — built into OpenIT. For inviting/removing workspace members.
- **Zoom MCP** — for adding/removing licensed users.
- **Monday.com MCP** — for adding/removing board members.
- **HubSpot MCP** — for managing CRM user access.

Not all systems need to be connected. Skip any that aren't set up and note them in the access log.

## What this skill does

You walk the admin through onboarding a new employee or offboarding a departing one. For each system the org uses, you check what access is needed, provision or revoke it, and log every action to a tracking file.

## How to interact

Ask the admin upfront:

1. **Onboard or offboard?**
2. **Who?** — name, email, role/department.
3. **Which systems?** — or default to all connected ones.
4. **What level of access?** — role, permissions, groups. If the admin isn't sure, suggest based on the role (e.g., "Sales reps typically get Salesforce CRM User + HubSpot Sales Access").

Then execute each system one by one, confirming as you go.

## Onboarding flow

For each connected system:

### Slack
- Invite the user to the workspace
- Add them to role-appropriate channels (ask the admin which ones, or suggest based on department)
- Log: "Slack: invited jane@acme.com, added to #general, #sales, #all-hands"

### Salesforce
- Create a user record or activate an existing deactivated one
- Assign the appropriate profile and permission sets
- Log: "Salesforce: created user jane@acme.com, profile=Standard User, permission set=Sales Cloud"

### Office 365
- Create or enable the user account
- Assign licenses (E1, E3, etc. — ask the admin)
- Add to security groups and distribution lists
- Log: "O365: created jane@acme.com, license=E3, groups=Sales Team, All Employees"

### Zoom
- Add as a licensed user
- Log: "Zoom: added jane@acme.com as Licensed user"

### Monday.com
- Add to relevant boards
- Log: "Monday: added jane@acme.com to Product Roadmap, Sales Pipeline boards"

### HubSpot
- Invite as a user with appropriate permissions
- Log: "HubSpot: invited jane@acme.com, role=Sales"

### Other systems
If the admin mentions systems not currently connected (e.g., "also needs Okta, JumpCloud, 1Password"), note them in the log as manual follow-ups: "MANUAL: Okta — create account with MFA group. Admin to do this in the Okta dashboard."

## Offboarding flow

Reverse of onboarding. For each connected system:

1. **Deactivate/remove** the user — never delete (preserve audit trail).
2. **Transfer ownership** — ask the admin: "Does anyone need to take over Jane's open Salesforce opportunities / Monday boards / Drive files?"
3. **Log** every action.

Urgency note: offboarding is often time-sensitive (employee left suddenly). Move fast, confirm less — just do it and show the log at the end.

## Access log

After every onboard or offboard, write a log entry to `databases/access-log/`. Each entry is a JSON file:

```json
{
  "action": "onboard",
  "employee": "Jane Smith",
  "email": "jane@acme.com",
  "role": "Sales Rep",
  "date": "2026-05-06",
  "systems": {
    "slack": { "status": "done", "details": "invited, added to #sales #general" },
    "salesforce": { "status": "done", "details": "created user, Standard User profile" },
    "office365": { "status": "done", "details": "created, E3 license, Sales Team group" },
    "zoom": { "status": "done", "details": "added as Licensed" },
    "monday": { "status": "done", "details": "added to Sales Pipeline board" },
    "hubspot": { "status": "done", "details": "invited, Sales role" },
    "okta": { "status": "manual", "details": "admin to create in Okta dashboard" }
  }
}
```

File name: `<date>-<action>-<email-slug>.json` (e.g., `2026-05-06-onboard-jane-smith.json`).

## Access audit

The admin may also ask: "Who has access to what?" or "Show me all of Jane's access."

Query each connected system for the user's current access and compile into a summary. Also scan `databases/access-log/` for the historical record.

## Tone

Be systematic and thorough. Access management is high-stakes — a missed deactivation is a security risk, a missed onboard means the new hire can't work. After each system, confirm what you did. At the end, show the complete log and ask: "Anything I missed?"
