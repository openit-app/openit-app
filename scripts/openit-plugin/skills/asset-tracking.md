---
name: asset-tracking
description: Query and manage device/asset inventory in Monday.com — who owns what, who has extras, trigger offboarding.
---

## Prerequisites

- **Monday.com MCP** — connect from the Tools station (MCP tab). This is where the asset inventory board lives.

## What this skill does

You help the admin query and manage their IT asset inventory stored in Monday.com. Common tasks: look up who owns a device, find people with multiple assets, flag unassigned equipment, and tie into the offboarding flow when someone leaves.

## How to interact

The admin asks about assets in plain language:

- "Who has the MacBook Pro with serial XYZ?"
- "Show me all devices assigned to Sarah"
- "Who has more than one laptop?"
- "List all unassigned devices"
- "Mark David's laptop as returned — he left last week"

### Query flow:

1. Use the Monday.com MCP to read the asset board
2. Filter and search based on the admin's question
3. Present results as a clean table: device name, type, serial, assigned to, status
4. Offer follow-up actions

## Common queries

**Look up by person:**
"Show me everything assigned to [name]" → Query the Monday board for items where the assigned person matches.

**Look up by device:**
"Who has [device/serial]?" → Search items by name or serial number column.

**Find anomalies:**
"Who has more than one laptop?" → Group by assigned person, count devices per person, filter where count > 1.

**Unassigned inventory:**
"What devices don't have an owner?" → Filter for items where the person column is empty.

**Recent changes:**
"What devices were assigned this month?" → Filter by last modified date.

## Actions

**Assign a device:**
Update the person column on the Monday board item. Log: "Assigned MacBook Pro (SN: C02X...) to Jane Smith."

**Mark as returned:**
Clear the person column and update the status to "Returned" or "Available". Log the change.

**Trigger offboarding:**
When the admin says someone is leaving, cross-reference their assigned assets:
1. Show all devices assigned to the person
2. Ask what to do with each: "Return to IT", "Transfer to [someone]", "Decommission"
3. Update the Monday board accordingly
4. Offer to also run the `/onboard-offboard` skill for access revocation

## Reporting

The admin may also want summary reports:

- "How many laptops do we have total?"
- "What's our device-to-employee ratio?"
- "Show me the asset inventory by department"

Query the Monday board and compute the stats. Present as a summary with the table below it.

## Tone

Be precise and inventory-minded. Asset tracking is about accountability — the admin needs to know exactly what's where. Numbers matter: "12 laptops total, 10 assigned, 2 available."
