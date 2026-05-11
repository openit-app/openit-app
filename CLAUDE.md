---
name: OpenIT
description: Open-source IT helpdesk desktop app powered by Claude Code. macOS, Apache 2.0.
---

## Quick reference

| What | Where |
|------|-------|
| GitHub | `openit-app/openit-app` |
| Landing page | `https://openit-app.github.io/openit-app` |
| Tech stack | React + TypeScript frontend, Rust (Tauri) backend |
| Tests | `npm test` (vitest), `cd src-tauri && cargo test` |
| Lint | `cargo fmt -- --check`, `cargo clippy` |
| Dev mode | `npm run tauri dev` |
| Production build | `npm run tauri build` |

## Releasing

Releases are fully automated. To cut a release:

```bash
# 1. Bump version in ALL THREE files (must match):
#    - src-tauri/tauri.conf.json
#    - src-tauri/Cargo.toml
#    - package.json
# 2. Update Cargo.lock:
cd src-tauri && cargo generate-lockfile && cd ..
# 3. Commit, tag, push:
git add -A && git commit -m "chore: bump version to X.Y.Z"
git push origin HEAD:main
git tag vX.Y.Z && git push origin vX.Y.Z
```

The release workflow (`.github/workflows/release.yml`) then:
1. Builds both DMGs (Apple Silicon + Intel) sequentially on one runner
2. Signs, notarizes, and uploads DMGs + updater archives
3. Signs the updater archives with `tauri signer` and builds `latest.json`
4. Uploads `latest.json` to the release (auto-updater endpoint)
5. The landing page auto-rebuilds on release publish (picks up new download links)

**Do NOT set `includeUpdaterJson: true` in tauri-action** — it's broken. The workflow builds `latest.json` itself in a separate step.

### Updater signing key

The updater uses a minisign keypair. The private key is in GitHub Secrets (`TAURI_SIGNING_PRIVATE_KEY`), the public key is in `src-tauri/tauri.conf.json` under `plugins.updater.pubkey`. These must match. If you regenerate the keypair:
1. `npm run tauri -- signer generate -w /tmp/key --ci -f`
2. Update the pubkey in `tauri.conf.json`
3. Update `TAURI_SIGNING_PRIVATE_KEY` in GitHub Secrets
4. Set `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` to empty string in GitHub Secrets

### In-app auto-updater

The app checks for updates on launch and every 5 minutes. When a new version is available, an "Update vX.Y.Z" button appears in the title bar. Users click it → download, install, relaunch. The updater fetches `latest.json` from the latest GitHub release.

## Architecture

```
src/                    # React frontend (TypeScript)
  shell/                # App shell — file explorer, workbench
    viewers/            # Entity-specific viewers (agent, datastore, conversation, etc.)
    explorer/           # File tree (TreeNode, ContextMenu, useTreeState)
    routing/            # Path → ViewerSource resolvers (per-entity-group)
  ui/                   # Design system components
  lib/                  # Core logic — API bindings, sync, catalogs, updater
src-tauri/src/          # Tauri backend (Rust)
  intake/               # Chat intake HTTP server (mod.rs + prompts.rs + chat_ui.html)
  kb/                   # Knowledge base (local.rs + cloud.rs + types.rs)
  slack/                # Slack integration (config.rs + api.rs + listener.rs)
  ...                   # PTY, file watching, git ops, tools, tunnel
scripts/openit-plugin/  # Claude plugin — skills, scripts, schemas, seed data
landing/                # Website (Astro + Tailwind) → GitHub Pages
```

## Data model — primitives and stores

Everything in OpenIT is a file or folder on disk. The workstation organizes them into **primitives** (top-level container types) and **stores** (instances the user creates inside them).

### Primitives (always available)

| Primitive | Disk path | What lives inside |
|-----------|-----------|-------------------|
| Databases | `databases/` | JSON-row collections (people, access, assets, tickets, + user-created) |
| Filestores | `filestores/` | File collections (attachments, library, skills, scripts, + user-created) |
| Knowledge | `knowledge-bases/` | Markdown articles |
| Reports | `reports/` | Generated markdown reports |
| Agents | `agents/` | Agent definitions (.md files) |

### System entities (not user-customizable containers)

| Entity | Disk path | Notes |
|--------|-----------|-------|
| Tools | (synthetic) | Detected via `which`, no on-disk folder |
| Traces | `.openit/agent-traces/` | Auto-generated agent activity logs |
| Inbox | `databases/tickets/` + `databases/conversations/` | Handled by the hero card, not a standalone tile |

### Workstation config (`.openit/workstation.json`)

The workstation layout is fully customizable. Users (or Claude Code) can create, delete, promote, demote, and customize any store. The config file controls:

```json
{
  "main": [
    { "rel": "knowledge-bases" },
    { "rel": "filestores/skills" }
  ],
  "more": [
    { "rel": "databases/people", "icon": "person", "tone": "sage", "label": "People", "description": "Contacts directory" },
    { "rel": "databases/roles", "icon": "shield", "tone": "link", "label": "Roles" }
  ]
}
```

- **`rel`**: repo-relative path (the tile's identity)
- **`label`**: custom display name (overrides the default)
- **`icon`**: key from `ICON_GALLERY` in `entityIcons.tsx` (34 icons available)
- **`tone`**: color theme — `accent`, `sage`, `ochre`, `link`, `clay`, `neutral`
- **`description`**: short text shown on list-view cards

Tiles in `main` appear in the primary workstation area. Tiles in `more` appear in the collapsible "More" pool. Newly created stores auto-register in `more`. Deleted stores are auto-cleaned from the config.

### What can be deleted

Only the 5 primitives and system entities are protected — they cannot be deleted:
- **Non-deletable**: `databases`, `filestores`, `knowledge-bases`, `reports`, `agents`, `tools`, `.openit/agent-traces`
- **Deletable**: everything inside a primitive — `databases/tickets`, `databases/people`, `databases/access`, `filestores/library`, `filestores/scripts`, any user-created store, etc.

Deleting a store removes the folder from disk and cleans it from `.openit/workstation.json`.

### Creating a new store

To create a new database via CC: `mkdir databases/<name>` and optionally add a `_schema.json` for structured fields. To create a new filestore: `mkdir filestores/<name>`. Both automatically appear as workstation tiles on the next refresh.

To customize the tile appearance, write to `.openit/workstation.json` — set `icon`, `tone`, `label`, and `description` on the relevant entry.

### Key source files

| File | What it does |
|------|-------------|
| `src/lib/workstationConfig.ts` | Config schema, load/save, filesystem discovery, merge logic |
| `src/shell/Workbench.tsx` | Dynamic workstation rendering, promote/demote/customize/delete |
| `src/shell/IconPicker.tsx` | Icon gallery + tone picker for tile customization |
| `src/shell/entityIcons.tsx` | `ENTITY_META` registry, `ICON_GALLERY` (34 icons), `iconForKey()` |

## Plugin CLAUDE.md (what users see)

`scripts/openit-plugin/CLAUDE.md` is the instruction file Claude reads when working in a user's vault. It defines:
- Directory layout (tickets, people, KB, skills, scripts, etc.)
- The "every session is a ticket" behavior — auto-create tickets, log conversations, capture KB
- Commands reference table
- Communication style rules

**Keep this file current.** When you add a new command or change behavior, update this file.

## Commands / Skills

Skills live in `scripts/openit-plugin/skills/`. The manifest (`scripts/openit-plugin/manifest.json`) lists every file that ships with the plugin. When adding or removing skills:
1. Add/remove the `.md` file in `skills/`
2. Add/remove seed data in `seed/skills/` if applicable
3. Update the manifest
4. Update the commands table in `scripts/openit-plugin/CLAUDE.md`
5. Bump the manifest version (`YYYY-MM-DD-NNN`)

Skills must be generic — useful for any IT admin. No customer-specific commands.

## Code quality standards

This is an open-source repo. Code should be approachable for contributors.

- **No god files.** If a file exceeds ~500 lines, consider splitting it. Use the existing patterns: `viewers/`, `explorer/`, `routing/`, `intake/`, `kb/`, `slack/` modules.
- **cargo fmt + clippy must pass.** CI checks both. Run before pushing.
- **No debug console.log in production code.** Use `console.warn` for recoverable errors, `console.error` for real failures.
- **No `as any` casts.** The codebase currently has zero — keep it that way.
- **Conventional Commits** for commit messages: `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`.
- **Clean up worktrees** after use. Stale worktrees cause vitest to pick up duplicate test files.

## Git worktrees

Claude Code creates worktrees inside `.claude/worktrees/` by default. This directory is gitignored.

- **Quick fixes:** commit directly on main, no worktree needed.
- **Larger refactors or risky changes:** use a worktree, cherry-pick back to main when done.
- **Always clean up:** `git worktree list` to see what exists, `git worktree remove <path>` to delete.
- **Naming:** use descriptive names (`fix-auth-bug`, `refactor-viewer`), not auto-generated IDs.

## Vite worktree note

When running `tauri dev` from a worktree, fonts load from the repo root's `node_modules`. The `vite.config.ts` has `server.fs.allow: [".", ".."]` to permit this. If you see "outside of Vite serving allow list" warnings, the worktree is too deeply nested.

## Keychain pop-ups

Follow the steps in `src-tauri/scripts/README.md` to set up code signing and avoid keychain prompts during development.

## Dictation note

The project owner uses macOS dictation. "Cloud" in messages always means "Claude" (as in Claude Code). Interpret accordingly.
