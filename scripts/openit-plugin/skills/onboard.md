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

## Access log

After every onboard, write a log entry to `databases/access/`. Each entry is a JSON file:

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

File name: `<date>-onboard-<email-slug>.json` (e.g., `2026-05-06-onboard-jane-smith.json`).

## Tone

Be systematic and thorough. A missed step means the new hire can't work day one. After each system, confirm what you did. At the end, show the complete log and ask: "Anything I missed?"
