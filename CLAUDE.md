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
