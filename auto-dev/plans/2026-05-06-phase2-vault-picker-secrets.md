# Phase 2 — Vault picker, secrets relocation, git removal

**Date:** 2026-05-06
**Repo:** `openit-app` (branch: `local-first`)
**Predecessor:** Phase 1 — local-first strip (commit `2cb5e35`)

---

## 1. Technical investigation

### What exists today

**Vault is hardcoded.** `App.tsx` calls `projectBootstrap({ orgName: "Personal", orgId: "Personal" })` which creates `~/OpenIT/Personal/`. No way to pick a different folder. No multi-workspace.

**Git is initialized on every vault.** `project.rs:219` calls `git_ensure_repo()` during bootstrap. A `.git/` and `.gitignore` are created inside the vault. Nobody uses git anymore — Phase 1 disabled auto-commit, removed the Sync tab, and stripped all cloud sync. The only active git caller is `skillsSync.ts:254` which commits bundled plugin files after install.

**Secrets live inside the vault.** Slack tokens are stored in OS keychain (good) but the Slack config pointer lives at `<vault>/.openit/slack.json` (bad for folder-sync — Dropbox would sync it to teammates). Other runtime state (`.openit/slack-sessions.json`, `.openit/slack-delivery.json`, `.openit/agent-traces/`, `.openit/skill-state/`) also lives in the vault.

**Dead code from Phase 1:**
- `src-tauri/src/git_ops.rs` (387 lines) — 12 Tauri commands, none called from active UI
- `src-tauri/src/git_history.rs` (87 lines) — 2 Tauri commands, none called from active UI
- `src/lib/autoCommitDriver.ts` (159 lines) — orphaned, imports never referenced
- `src/shell/SourceControl.tsx` (~260 lines) — disconnected from UI tree
- `src/lib/syncEngine.ts` — `commitTouched()` only used by skillsSync; rest is conflict infrastructure for cloud sync
- `src/lib/api.ts` git wrappers (14 functions) — only `gitGlobalUserEmail` actively called (Viewer.tsx admin identity)
- `claude.rs::claude_generate_commit_message` — no caller

### File-by-file disposition

| File | Lines | Action |
|---|---|---|
| `src-tauri/src/git_ops.rs` | 387 | **Delete.** No active callers. |
| `src-tauri/src/git_history.rs` | 87 | **Delete.** No active callers. |
| `src/lib/autoCommitDriver.ts` | 159 | **Delete.** Orphaned. |
| `src/shell/SourceControl.tsx` | ~260 | **Delete.** Disconnected. |
| `src/lib/syncEngine.ts` | ~290 | **Strip** to just shadow helpers + conflict types. Remove `commitTouched`, `withRepoLock`, git import. |
| `src/lib/api.ts` git functions | 14 fns | **Delete** all except `gitGlobalUserEmail` (admin identity fallback). |
| `src-tauri/src/project.rs:219` | 1 call | **Remove** `git_ensure_repo` call. Stop creating `.git/` on bootstrap. |
| `src-tauri/src/lib.rs` | 13 entries | **Remove** all git command registrations. Keep `git_global_user_email` only. |
| `src/lib/skillsSync.ts:254` | 1 call | **Remove** `git_commit_paths` call. Plugin sync just writes files, no commit. |
| `src/shell/Shell.tsx:8` | imports | **Remove** unused git imports. |

---

## 2. Proposed solution — three workstreams

### (a) Vault picker + multi-workspace

**Obsidian-style.** On first launch (no workspace registry), show a picker: "Open Vault" with a folder chooser, defaulting to `~/OpenIT/Personal/`. User picks any folder on disk.

**Registry** at `~/Library/Application Support/OpenIT/workspaces.json`:
```json
{
  "workspaces": [
    { "path": "/Users/me/OpenIT/Personal", "name": "Personal", "lastOpenedAt": 1715020800000 },
    { "path": "/Users/me/Dropbox/TeamVault", "name": "TeamVault", "lastOpenedAt": 1715020900000 }
  ],
  "active": "/Users/me/OpenIT/Personal"
}
```

**Switcher** — small dropdown or button in the UI (header area) showing the current workspace name. Click to switch or create new.

**Bootstrap change:** `project_bootstrap(path)` takes an arbitrary path instead of deriving from `orgId`. Creates the standard subdirs if missing. No git init.

| File | Change |
|---|---|
| New: `src-tauri/src/workspaces.rs` | Registry CRUD: `list_workspaces`, `create_workspace(path, name)`, `set_active_workspace`, `remove_workspace` |
| `src-tauri/src/project.rs` | `project_bootstrap(path)` — accept arbitrary path, remove `orgId`/`orgName` params, remove `git_ensure_repo` call |
| `src-tauri/src/lib.rs` | Register workspace commands, remove git commands |
| `src/lib/api.ts` | Add workspace Tauri wrappers, remove git wrappers |
| `src/App.tsx` | On launch: read registry → if empty show vault picker, else load `active`. Store workspace name for display. |
| New: `src/shell/WorkspaceSwitcher.tsx` | Header dropdown: current workspace name, switch, create new, open in Finder |
| `src/Onboarding.tsx` | Becomes the vault picker: folder chooser + Claude detection + continue |

### (b) Secrets out of vault

Everything credential-bearing or per-user moves to app-support. The vault contains only safe-to-share data.

**Layout:**
```
~/Library/Application Support/OpenIT/
├── workspaces.json                      # workspace registry
└── <workspace-hash>/
    └── credentials/
        └── slack.json                   # Slack config (was <vault>/.openit/slack.json)
```

`<workspace-hash>` is a stable hash of the vault path (e.g., SHA-256 of the canonical path, truncated to 16 chars).

**What moves:**
- `.openit/slack.json` → app-support `credentials/slack.json`
- `.openit/slack-sessions.json` → app-support (or just ephemeral — don't persist across launches)
- `.openit/slack-delivery.json` → app-support

**What stays in vault `.openit/`:**
- `config.json` — admin-editable, safe to share
- `plugin-version` — sentinel, no secrets
- `skill-state/` — Claude writes dock state here, no secrets
- `flash.json` — ephemeral toast notifications

**Plugin scripts** read from `process.env.SLACK_BOT_TOKEN` / `SLACK_APP_TOKEN` instead of `.openit/slack.json`. Tauri injects these when spawning the listener.

| File | Change |
|---|---|
| New: `src-tauri/src/secrets.rs` | `get_secret(workspace_hash, name)`, `set_secret(workspace_hash, name, value)` — reads/writes `credentials/` dir at `0o700` |
| `src-tauri/src/slack.rs` | Read/write Slack config via `secrets.rs` instead of `<vault>/.openit/slack.json`. Inject tokens as env vars when spawning listener. |
| `src-tauri/src/intake.rs` | Push-markers stay in `.openit/` (no secrets) |
| `scripts/openit-plugin/scripts/slack-listen.src.mjs` | Read `process.env.OPENIT_SLACK_BOT_TOKEN` etc. instead of file reads |

### (c) Remove git

Strip all git infrastructure. The vault is just a folder — no `.git/`, no `.gitignore`, no commits.

| File | Change |
|---|---|
| `src-tauri/src/git_ops.rs` | **Delete** |
| `src-tauri/src/git_history.rs` | **Delete** |
| `src/lib/autoCommitDriver.ts` | **Delete** |
| `src/shell/SourceControl.tsx` | **Delete** |
| `src-tauri/src/lib.rs` | Remove 13 git command registrations. Keep `git_global_user_email` as a standalone in a small helper. |
| `src/lib/api.ts` | Remove 13 git wrapper functions. Keep `gitGlobalUserEmail` (rename to just `globalUserEmail`). |
| `src/lib/syncEngine.ts` | Remove `commitTouched`, `withRepoLock`, `gitCommitPaths` import. Keep shadow helpers and conflict types (used by ConflictBanner). |
| `src/lib/skillsSync.ts` | Remove the `git_commit_paths` call at line 254. Plugin files just write to disk. |
| `src/shell/Shell.tsx` | Remove unused git imports. |
| `src-tauri/src/project.rs` | Remove `use crate::git_ops` and the `git_ensure_repo` call. |

**`gitGlobalUserEmail`** survives as an admin-identity helper — it reads `git config --global user.email` which is a system setting, not vault git. Move it from `git_ops.rs` to a small `src-tauri/src/user_identity.rs` before deleting git_ops.

---

## 3. Implementation checklist

### Step 1 — Remove git (cleanest to do first, unblocks the rest)

- [ ] Move `git_global_user_email` to new `src-tauri/src/user_identity.rs`
- [ ] Delete `git_ops.rs` and `git_history.rs`
- [ ] Delete `autoCommitDriver.ts` and `SourceControl.tsx`
- [ ] Remove 13 git command registrations from `lib.rs`; register `user_identity::global_user_email`
- [ ] Remove 13 git wrapper functions from `api.ts`; keep/rename `gitGlobalUserEmail` → `globalUserEmail`
- [ ] Remove `git_ensure_repo` call from `project.rs` bootstrap
- [ ] Remove `git_commit_paths` call from `skillsSync.ts`
- [ ] Strip `commitTouched` and `withRepoLock` from `syncEngine.ts`
- [ ] Remove unused git imports from `Shell.tsx`
- [ ] Verify: `npx tsc --noEmit` + `cargo check` pass

### Step 2 — Vault picker + multi-workspace

- [ ] `workspaces.rs` — registry CRUD with Tauri commands
- [ ] Update `project.rs` — `project_bootstrap(path)` accepts arbitrary path, no orgId
- [ ] `api.ts` — workspace Tauri wrappers
- [ ] Rewrite `Onboarding.tsx` as vault picker (folder chooser + Claude detect + continue)
- [ ] `App.tsx` — registry-driven boot: empty → vault picker, otherwise load active workspace
- [ ] `WorkspaceSwitcher.tsx` — header dropdown
- [ ] Verify: fresh install → vault picker → pick folder → app loads

### Step 3 — Secrets relocation

- [ ] `secrets.rs` — credential storage in app-support with `0o700` permissions
- [ ] `slack.rs` — migrate to reading/writing via `secrets.rs`
- [ ] Slack listener spawning — inject tokens as env vars
- [ ] `slack-listen.src.mjs` — read from `process.env.*`
- [ ] One-time migration: if `.openit/slack.json` exists in vault, move to app-support on boot
- [ ] Verify: `rg -E '(xoxb|xapp)' <vault>/` returns zero hits after Slack connect

### Step 4 — Manual sign-off

- [ ] Fresh install → vault picker → pick `~/Dropbox/TeamVault/` → app loads, no `.git/` in vault
- [ ] Create second workspace → switcher shows both → switch works
- [ ] Connect Slack → tokens land in `~/Library/Application Support/OpenIT/<hash>/credentials/`, not in vault
- [ ] Grep vault for token-shaped strings → zero hits
- [ ] Existing `~/OpenIT/Personal/` vault still opens (backward compat)

---

## 4. Stop. Ask the human to review and approve before stage 03.
