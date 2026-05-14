---
name: asset-tracking
description: Query and manage device/asset inventory — who owns what, who has extras, trigger offboarding.
---

## What this skill does

You help the admin query and manage their IT asset inventory. Common tasks: look up who owns a device, find people with multiple assets, flag unassigned equipment, and tie into the offboarding flow when someone leaves.

## Where assets live

Assets are stored as JSON files in `databases/assets/`. Each file is one device or piece of equipment. Check `databases/assets/_schema.json` for the field structure.

If the admin has also connected an external system (Monday.com MCP, Airtable, or a spreadsheet), query that too — but the local vault is always the source of truth.

## How to interact

The admin asks about assets in plain language:

- "Who has the MacBook Pro with serial XYZ?"
- "Show me all devices assigned to Sarah"
- "Who has more than one laptop?"
- "List all unassigned devices"
- "Mark David's laptop as returned — he left last week"

### Query flow:

1. Read files in `databases/assets/` using Glob + Read
2. Filter and search based on the admin's question
3. Present results as a clean table: device name, type, serial, assigned to, status
4. Offer follow-up actions

## Common queries

**Look up by person:**
"Show me everything assigned to [name]" → Read all asset files, filter where assignee matches.

**Look up by device:**
"Who has [device/serial]?" → Search files by name or serial field.

**Find anomalies:**
"Who has more than one laptop?" → Group by assignee, count per person, filter where count > 1.

**Unassigned inventory:**
"What devices don't have an owner?" → Filter for files where assignee is empty or null.

**Recent changes:**
"What devices were assigned this month?" → Filter by last modified or date field.

## Actions

**Assign a device:**
Update the assignee field in the asset JSON file. Log the change in a ticket.

**Mark as returned:**
Clear the assignee and set status to "available". Log the change.

**Add a new device:**
Create a new JSON file in `databases/assets/` with the device details.

**Trigger offboarding:**
When the admin says someone is leaving, cross-reference their assigned assets:
1. Show all devices assigned to the person
2. Ask what to do with each: "Return to IT", "Transfer to [someone]", "Decommission"
3. Update the asset files accordingly
4. Offer to also run `/offboard` for access revocation

## Reporting

The admin may also want summary reports:

- "How many laptops do we have total?"
- "What's our device-to-employee ratio?"
- "Show me the asset inventory by department"

Read all asset files and compute the stats. Present as a summary with the table below it.

## Tone

Be precise and inventory-minded. Asset tracking is about accountability — the admin needs to know exactly what's where. Numbers matter: "12 laptops total, 10 assigned, 2 available."

## After this run

Before signing off, re-read this command body. If the admin's choices narrowed any defaults (which fields define an asset, what "available" means here, default action on offboarding cross-reference, summary format), rewrite the relevant sections to match — and snapshot the prior body to `filestores/commands/asset-tracking/_history/<ms>.md` first. Tell the admin in one line what changed.
