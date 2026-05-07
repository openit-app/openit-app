# Vault cleanup — skills station redesign + agent simplification

**Date:** 2026-05-06
**Branch:** `local-first`
**Context:** Lisa demo tomorrow; whatever ships here ships for every user on every platform.

---

## Problem

The vault is cluttered with cloud-era artifacts that confuse users and waste space:

1. **`.claude/scripts/`** has 10 files — 2 are dead (sync-push, sync-resolve-conflict), the rest are internal plumbing the user never touches directly.
2. **`.claude/skills/`** has 7 skill folders — 1 is dead (connect-to-cloud). The skills are hidden behind "show system files" toggle, yet this is where slash commands live. Users can't see, edit, or manage them.
3. **`agents/triage/`** has 4 files — 2 are dead (cloud.md, triage.json). The agent is just a markdown persona; the V2 folder layout was for cloud sync.
4. **`filestores/skills/`** and **`filestores/scripts/`** are empty — they were meant for user-captured automations, but the user never sees the pre-installed ones since those live in `.claude/`.

The Skills station in the Workbench shows "No skills yet" even though 7 slash commands are installed. That's broken.

---

## Principles

- **Everything is a file.** Users should see, edit, and delete any skill or agent from the file explorer.
- **No hidden magic.** `.claude/` is Claude Code's internal directory — we shouldn't ask users to dig into it. Skills and agents should live in user-visible locations.
- **Pre-installed ≠ immutable.** Users can edit pre-installed skills to customize them. They can delete ones they don't need.
- **Cross-platform, every user.** Whatever we ship is what every new OpenIT user gets on macOS, Linux, and Windows.

---

## 1. Agent simplification

### Current state
```
agents/
  triage/
    triage.json      ← structured fields for cloud API (dead)
    common.md         ← shared persona
    cloud.md          ← cloud instructions (dead)
    local.md          ← local instructions
```

### Target state
```
agents/
  triage.md           ← single file, the full agent persona
```

**What to do:**
- Merge `common.md` + `local.md` into a single `triage.md`
- Delete `triage.json` and `cloud.md`
- The agent viewer in the app renders the markdown file
- Creating a new agent = creating a new `.md` file in `agents/`
- No special folder structure, no JSON config

**Migration:** The bundled plugin manifest ships `agents/triage.md` instead of the 4-file template. Existing vaults: the `migrateFlatTriage` function in App.tsx already handles V1→V2 migration; we add a V2→V3 migration that merges the markdown files and cleans up.

**Impact on the app:**
- `agents/` viewer (entityRouting.ts) needs to handle `.md` files as agents, not just `.json`
- The agent station card counts `.md` files instead of subdirectories
- The intake server's agent prompt assembly reads `agents/triage.md` directly instead of concatenating common.md + local.md

---

## 2. Scripts cleanup

### Current state (`.claude/scripts/` — 10 files)

| File | Status | Action |
|------|--------|--------|
| `sync-push.mjs` | Dead (no cloud sync) | **Delete from manifest** |
| `sync-resolve-conflict.mjs` | Dead (no cloud sync) | **Delete from manifest** |
| `slack-listen.bundle.cjs` | Active (Slack listener) | Keep |
| `slack-copy-manifest.mjs` | Active (connect-slack) | Keep |
| `slack-manifest.yml` | Active (connect-slack) | Keep |
| `slack-send-intro.mjs` | Active (connect-slack) | Keep |
| `slack-disconnect.mjs` | Active (connect-slack) | Keep |
| `kb-search.mjs` | Active (KB search) | Keep |
| `report-overview.mjs` | Active (reports) | Keep |
| `_flash.mjs` | Active (toast notifications) | Keep |

Net: remove 2 dead scripts from the manifest. The remaining 8 are internal plumbing — they stay in `.claude/scripts/` (hidden by default, which is correct — users don't edit these).

---

## 3. Skills station redesign

### Problem
Skills live in `.claude/skills/<name>/SKILL.md` (hidden). The Skills station card points to `filestores/skills/` (empty). Users can't see pre-installed slash commands.

### Target
Skills station shows **two sections** (like the MCP tab does):

**"Built-in"** — pre-installed slash commands that ship with OpenIT. Read from `.claude/skills/`. Each card shows:
- Skill name (from frontmatter `name:`)
- Description (from frontmatter `description:`)
- "Run" button → inserts `/<skill-name>` into Claude chat
- "Edit" button → opens the SKILL.md in the viewer for editing
- "docs" link or preview

**"Custom"** — user-created skills from `filestores/skills/`. Same card layout plus:
- "Delete" button
- "New +" button at the top to create a new skill

### Dead skills to remove from manifest
- `connect-to-cloud` — dead (no cloud)

### Pre-installed skills for every user (6)

| Skill | Slash command | Purpose |
|-------|-------------|---------|
| ai-intake | `/ai-intake` | Agent-facing: auto-loaded by chat intake server |
| answer-ticket | `/answer-ticket` | Admin: reply to escalated tickets, capture KB |
| connect-slack | `/connect-slack` | Admin: set up Slack listener with BYO tokens |
| conversation-to-automation | `/conversation-to-automation` | Admin: harvest resolutions into skills/scripts |
| report | `/report` | Admin: generate custom helpdesk reports |
| salesforce-gmail | `/salesforce-gmail` | Admin: Salesforce + Gmail bridge (Lisa's #1) |

### Implementation
- Skills station card in Workbench points to a new `ViewerSource` kind (or reuse `entity-folder` with both paths merged)
- The viewer reads both `.claude/skills/` (built-in) and `filestores/skills/` (custom)
- "Run" button calls `writeToActiveSession("/<skill-name>\r")`
- "Edit" opens the file in the markdown viewer/editor
- No changes to how Claude Code discovers skills — `.claude/skills/` convention stays

---

## 4. Manifest changes

Remove from `files[]`:
- `skills/connect-to-cloud.md` (dead)
- `scripts/sync-push.mjs` (dead)
- `scripts/sync-resolve-conflict.mjs` (dead)
- `agents/triage/triage.template.json` (replaced by triage.md)
- `agents/triage/cloud.md` (dead)
- `agents/triage/common.md` (merged into triage.md)
- `agents/triage/local.md` (merged into triage.md)

Add to `files[]`:
- `agents/triage.md` (new single-file agent)

Bump version.

Remove `bubbles[]` entirely (already removed from UI).

---

## 5. Implementation checklist

### Step 1 — Clean up dead files from manifest
- [ ] Remove connect-to-cloud, sync-push, sync-resolve-conflict from manifest
- [ ] Remove bubbles array from manifest
- [ ] Bump manifest version

### Step 2 — Simplify agents to single markdown file
- [ ] Create `scripts/openit-plugin/agents/triage.md` by merging common.md + local.md
- [ ] Remove the 4-file template from manifest, add triage.md
- [ ] Update `routeFile()` in skillsSync.ts to handle `agents/<name>.md` → `agents/<name>.md`
- [ ] Add V2→V3 migration in App.tsx: if `agents/triage/` folder exists, merge common.md + local.md → `agents/triage.md`, delete the folder
- [ ] Update entityRouting.ts agent resolver to handle `.md` files
- [ ] Update Workbench agent station card to count `.md` files
- [ ] Update intake server's agent prompt assembly to read `agents/triage.md`

### Step 3 — Skills station redesign
- [ ] Update the Skills station viewer to read from both `.claude/skills/` and `filestores/skills/`
- [ ] Two sections: "Built-in" and "Custom"
- [ ] Each card: name, description, Run button, Edit button
- [ ] Custom section: Delete button, New + button
- [ ] Remove the "No skills yet" empty state when built-in skills exist

### Step 4 — Verify
- [ ] Fresh vault: `npm run tauri dev` → agents/ has `triage.md` (no folder)
- [ ] Skills station shows 6 built-in skills
- [ ] `/salesforce-gmail` autocomplete works in Claude Code
- [ ] Clicking "Run" on a skill inserts the slash command into chat
- [ ] Clicking "Edit" opens the markdown in the viewer
- [ ] `.claude/scripts/` has 8 files (no sync-push, no sync-resolve-conflict)
- [ ] `connect-to-cloud` skill is gone

---

## 6. Stop. Review before implementing.
