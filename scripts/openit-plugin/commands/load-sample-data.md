---
name: load-sample-data
description: Load sample data into the workspace — people, access logs, assets, KB articles, and reports — so you can see what OpenIT looks like with real content.
---

## When to use

Run when the admin wants to see OpenIT with sample data across all tiles, or when the getting-started tour suggests it. Idempotent — skips files that already exist.

## What to create

Write the following sample data. For each file, check if it already exists first (Glob or Read). Skip any file that already exists — never overwrite.

### 1. People (`databases/people/`)

Write 3 sample people as JSON files:

**`databases/people/jane-smith.json`**
```json
{
  "name": "Jane Smith",
  "email": "jane.smith@company.com",
  "department": "Engineering",
  "role": "Software Engineer",
  "location": "San Francisco",
  "startDate": "2024-03-15",
  "status": "active"
}
```

**`databases/people/tom-chen.json`**
```json
{
  "name": "Tom Chen",
  "email": "tom.chen@company.com",
  "department": "Marketing",
  "role": "Marketing Manager",
  "location": "New York",
  "startDate": "2023-09-01",
  "status": "active"
}
```

**`databases/people/sarah-jones.json`**
```json
{
  "name": "Sarah Jones",
  "email": "sarah.jones@company.com",
  "department": "Sales",
  "role": "Account Executive",
  "location": "Chicago",
  "startDate": "2025-01-10",
  "status": "active"
}
```

### 2. Access logs (`databases/access/`)

**`databases/access/onboard-sarah-jones.json`**
```json
{
  "type": "onboard",
  "employee": "Sarah Jones",
  "email": "sarah.jones@company.com",
  "date": "2025-01-10",
  "systems": ["Google Workspace", "Slack", "GitHub", "Jira"],
  "completedBy": "admin",
  "notes": "New hire — Account Executive, Sales team."
}
```

**`databases/access/offboard-mike-davis.json`**
```json
{
  "type": "offboard",
  "employee": "Mike Davis",
  "email": "mike.davis@company.com",
  "date": "2025-04-30",
  "systems": ["Google Workspace", "Slack", "AWS", "GitHub"],
  "completedBy": "admin",
  "notes": "Last day was April 30. All access revoked."
}
```

### 3. Assets (`databases/assets/`)

**`databases/assets/macbook-pro-001.json`**
```json
{
  "type": "laptop",
  "make": "Apple",
  "model": "MacBook Pro 14\" M3",
  "serialNumber": "C02X12345678",
  "assignedTo": "Jane Smith",
  "purchaseDate": "2024-03-15",
  "status": "active"
}
```

**`databases/assets/dell-monitor-002.json`**
```json
{
  "type": "monitor",
  "make": "Dell",
  "model": "U2723QE 27\" 4K",
  "serialNumber": "DL-9876543210",
  "assignedTo": "Tom Chen",
  "purchaseDate": "2023-10-01",
  "status": "active"
}
```

### 4. Knowledge base articles (`knowledge/`)

**`knowledge/how-to-reset-slack-password.md`**
```markdown
# How to reset your Slack password

1. Go to your-workspace.slack.com
2. Click "Forgot password" on the sign-in page
3. Enter your work email and click "Send reset link"
4. Check your email and click the reset link
5. Choose a new password (must be at least 8 characters)

If you're having trouble, contact IT.
```

**`knowledge/how-to-request-figma-access.md`**
```markdown
# How to request Figma access

Figma seats are managed by the Design team.

1. Send a message in Slack to #design-ops
2. Include your name, role, and what project you need access for
3. A design lead will add you within 1 business day

Note: Figma viewer access is free. Editor seats require manager approval.
```

### 5. Sample scripts (`filestores/scripts/`)

Write 2 small runnable scripts so the Scripts tile demonstrates the pattern. These are intentionally trivial — the admin reads, edits, or deletes them.

**`filestores/scripts/say-hello.mjs`**
```javascript
#!/usr/bin/env node
// say-hello.mjs — the simplest possible script.
const today = new Date().toISOString().slice(0, 10);
console.log(`Hello from OpenIT — today is ${today}.`);
```

**`filestores/scripts/list-people.mjs`**
```javascript
#!/usr/bin/env node
// list-people.mjs — walk the People directory and print a roster.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const PEOPLE_DIR = join(process.cwd(), "databases", "people");

async function main() {
  let entries;
  try {
    entries = await readdir(PEOPLE_DIR);
  } catch {
    console.error(`No people dir at ${PEOPLE_DIR}.`);
    process.exit(1);
  }
  const people = [];
  for (const name of entries) {
    if (!name.endsWith(".json") || name === "_schema.json") continue;
    try {
      const p = JSON.parse(await readFile(join(PEOPLE_DIR, name), "utf8"));
      if (p?.name) people.push(p);
    } catch { /* skip malformed */ }
  }
  console.log(`${people.length} people on file:`);
  for (const p of people) {
    console.log(`  - ${p.name} (${p.role ?? "—"}) — ${p.email ?? "no email"}`);
  }
}

main().catch((err) => {
  console.error("list-people failed:", err);
  process.exit(1);
});
```

### 6. Reports (`reports/`)

**`reports/sample-weekly-overview.md`**
```markdown
# Weekly IT Overview — Sample

**Period:** Sample week

## Summary
- 12 tickets received
- 8 resolved by agent (67% auto-resolution rate)
- 4 escalated to admin
- Average response time: 45 seconds

## Top issues
1. VPN connectivity (4 tickets)
2. Password resets (3 tickets)
3. Software access requests (3 tickets)
4. Hardware issues (2 tickets)

## Knowledge base impact
- 2 new articles created
- Agent auto-resolved 3 tickets using existing KB articles
```

### 7. Done

After writing all files, tell the admin:

> Done — I populated the workspace with sample people, access logs, assets, knowledge base articles, a couple of runnable scripts, and a report.
>
> The tiles in the left panel should now show updated counts. Click through them to see what each one holds — the Scripts tile has runnable examples you can click to execute.

Do not create any sample tickets or conversations — those were already created during the tour.

## Rules

- **Never overwrite existing files.** Check before writing.
- **Don't ask for confirmation.** Just write the files.
- **Be quick.** Write all files, then summarize at the end.
