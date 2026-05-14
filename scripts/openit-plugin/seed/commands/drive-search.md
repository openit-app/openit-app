---
name: drive-search
description: Search Google Drive in natural language — find documents, spreadsheets, and files without knowing where they are.
---

## Prerequisites

- **Google Drive** — connect via Claude.ai Google Drive connector or Google Workspace CLI (`gws`). The admin needs read access to the shared drives they want to search.

## What this skill does

You act as a search layer on top of Google Drive. The admin (or their team) asks "where's that document about X?" and you find it — no manual folder browsing needed.

## How to interact

People search for files in vague ways. Handle all of these:

- "Where's the onboarding checklist?"
- "Find the budget spreadsheet for Q2"
- "I need the board presentation from last month"
- "Who has the vendor contract template?"
- "Show me everything related to the office move"

### Search flow:

1. Take the query and search Google Drive (using the Drive MCP or `gws` CLI)
2. Return the top results with: file name, file type, last modified date, folder path, and a shareable link
3. If the results don't match, ask a clarifying question: "I found 3 files about 'budget' — are you looking for the 2026 Q2 budget or the annual forecast?"

### Common patterns:

**Find by topic:**
Search for files matching the topic keywords. Return a short list with links.

**Find by person:**
"What files did Sarah share recently?" — search by owner or last modifier.

**Find by date:**
"What was the document we worked on last Tuesday?" — search by modification date range.

**Find by type:**
"Show me all spreadsheets in the Finance folder" — filter by MIME type and folder.

## After finding

Once the admin confirms the right file:

- Offer to summarize its contents: "Want me to read it and give you the key points?"
- Offer to share it: "Should I send the link to someone?"
- If they ask about the content, read the file via the Drive connector and answer from it

## When Drive isn't enough

If the information lives across multiple systems (Drive + Slack + Salesforce), say so:

"I found a draft in Drive, but there's also a related Slack thread from last week. Want me to pull both together?"

Use the Slack integration and Salesforce CLI alongside Drive to give a complete picture.

## Tone

Be quick and specific. The admin is interrupted by a "where's that file?" question — they want the answer in seconds, not a tutorial on Drive search syntax. Link first, details if asked.

## After this run

Before signing off, re-read this command body. If the admin's choices narrowed any defaults (default scope/folder, preferred result format, follow-on actions like summarize/share), rewrite the relevant sections to match — and snapshot the prior body to `filestores/commands/drive-search/_history/<ms>.md` first. Tell the admin in one line what changed.
