# PIN-7009: Secure local credentials for scripts and commands — Implementation plan

**Ticket:** [PIN-7009](https://linear.app/pinkfish/issue/PIN-7009/openit-add-secure-local-credentials-store-for-scripts-and-commands)
**Date:** 2026-06-05
**Repo:** `openit-app` (primary)
**References:** `/web` (plugin home, FE patterns), `/platform` (MCPs, services), `/firebase-helpers` (resource APIs), `/pinkfish-connections` (proxy)
**Predecessor:** None

---

## 1. Technical investigation

The Slack feedback reported that admins need credentials in reusable scripts, but the current authoring model pushes them toward putting values in files that live in the shared vault. That is especially risky when the vault is in Dropbox or Google Drive.

Current flow:

1. The command/script authoring model makes `filestores/commands/` and `filestores/scripts/` the admin-owned source of truth. `src/lib/skillMirror.ts:5`-`9` explicitly says these files land in the cloud filestore, sync across devices, and are visible in the cloud dashboard.
2. `skillMirror` mirrors command bodies into `.claude/skills/<name>/SKILL.md` and scripts into `.claude/scripts/<file>` from the shared filestore sources at `src/lib/skillMirror.ts:31`-`64` and `src/lib/skillMirror.ts:103`-`166`.
3. Bundled command seeds route into `filestores/commands/` at `src/lib/skillsSync.ts:209`-`218`, reinforcing that command bodies are editable shared files.
4. The scripts UI creates new scripts directly under `filestores/scripts/` at `src/shell/ScriptsStation.tsx:129`-`148`.
5. The scripts UI runs a script via `scriptRun(repo, script.path)` at `src/shell/ScriptsStation.tsx:83`-`105`.
6. The native script runner resolves the interpreter and spawns the script with `Command::new(...).arg(script).current_dir(repo).output()` at `src-tauri/src/scripts.rs:119`-`144`; it does not inject credentials or read from the keychain.
7. Claude slash commands run inside the PTY. `pty_spawn` sets Claude-specific args and only injects `TERM`/`PATH` at `src-tauri/src/pty.rs:90`-`109`, so commands run through Claude do not get any OpenIT-managed secret environment either.

What already exists:

- Native keychain support already exists through the Rust `keyring` crate. `src-tauri/src/keychain.rs:1`-`49` provides generic `keychain_set`, `keychain_get`, `keychain_delete`, and `keychain_probe` commands.
- `keyring` is configured with `apple-native`, `windows-native`, and `linux-native-sync-persistent` features in `src-tauri/Cargo.toml:31`, which is the right cross-platform foundation.
- These commands are registered in `src-tauri/src/lib.rs:91`-`94`, but there are no typed renderer helpers for a reusable credentials feature.
- App-local state already lives outside the vault. `src-tauri/src/state.rs:20`-`27` uses Tauri's app data directory for `state.json`, and workspaces use app-support/local config paths at `src-tauri/src/workspaces.rs:33`-`53`.

Related but separate:

- `ToolsPanel` currently asks for MCP environment variables in plain text inputs and writes them into the Claude terminal command line at `src/shell/ToolsPanel.tsx:126`-`140`. That is a credential exposure risk, but `PIN-7009` should focus first on local reusable credentials for scripts/commands. A follow-up can migrate MCP install auth to the same store if needed.

Root cause: OpenIT has secure keychain primitives, but no local credential index, no UI for scripts/commands to manage named environment variables, and no runtime bridge that exposes keychain-backed values to app-run scripts or Claude-run commands.

Cross-repo/plugin reach:

- Updating `scripts/openit-plugin/instructions/command-authoring.md` is necessary so Claude stops writing secrets into synced script files and instead uses environment variables. That file currently mandates scripts-first authoring at `scripts/openit-plugin/instructions/command-authoring.md:13`-`33` but says nothing about credentials.
- The older auto-dev docs mention mirroring plugin files into `/web/packages/app/public/openit-plugin/`, but that path is not present in the current `/web` checkout. The implementation must verify the current production mirror path before merge/release and update it if it exists.

## 2. Proposed solution

Build a local-only credentials layer on top of the existing native keychain. Keep secret values out of the vault, out of command/script files, and out of terminal command text.

Approach:

- Store secret values in the OS keychain under stable OpenIT slots.
- Store a non-secret local index of credential names in the app data directory, not in the vault. The index lets the UI list saved variables without needing keychain enumeration.
- Treat credential names as environment variable names. Enforce a conservative cross-platform name regex: `^[A-Z_][A-Z0-9_]*$`.
- Inject saved credentials into:
  - `script_run`, so clicking Run on `filestores/scripts/*.mjs` exposes them as process env vars.
  - Claude PTY spawn, so slash commands and Claude-invoked scripts can use the same env vars.
- Add a restrained credentials manager to the Tools surface, since that is already the app's auth/tooling area. It should show variable names and saved/not-saved state, never values.
- Update command-authoring instructions so generated commands/scripts reference `process.env.MY_SECRET` and explicitly never paste secrets into `filestores/commands/`, `filestores/scripts/`, `.claude/`, or markdown docs.

| File | Change |
| --- | --- |
| `src-tauri/src/keychain.rs` | Add higher-level credential commands/index helpers or delegate to a new native module; remove secret length logging from `keychain_set`. |
| `src-tauri/src/lib.rs` | Register new credential list/set/delete commands if added separately. |
| `src-tauri/src/scripts.rs` | Load indexed credentials and inject them into `Command` before spawning app-run scripts. |
| `src-tauri/src/pty.rs` | Load indexed credentials and inject them into the Claude PTY environment before spawning. |
| `src/lib/api.ts` | Add typed renderer helpers for list/set/delete/probe credential operations. |
| `src/shell/ToolsPanel.tsx` | Add a local credentials section with name/value input, masked value entry, saved variable list, and delete. |
| `src/shell/ToolsPanel.module.css` | Add compact styling for the credentials section. |
| `scripts/openit-plugin/instructions/command-authoring.md` | Add the secure credential authoring rule and an example using `process.env.SALESFORCE_TOKEN`. |
| `/web` plugin mirror, if present | Verify current mirror location; copy the plugin instruction update and bump manifest/version only if this repo still hosts the production plugin copy. |

Unit tests:

- Native Rust tests for credential name validation, index serialization/deserialization, delete removing names from the index, and env injection preserving existing env while adding saved credential vars.
- Existing `cargo test scripts::` should continue to pass after script-run env injection.
- Renderer tests for any extracted credential-name validation helper and the ToolsPanel credentials UI if it can be mocked without brittle full-panel setup.

Manual scenarios:

- Save `TEST_API_TOKEN` through the UI; confirm the value is not written anywhere under the vault with `rg TEST_API_TOKEN <vault>`.
- Run a script from the Scripts tile that prints whether `process.env.TEST_API_TOKEN` exists without printing the value; verify exit 0.
- Invoke a Claude command/script path that checks for the same env var; verify the PTY-spawned Claude environment can reach it.
- Delete the credential; rerun the script and verify the env var is absent.
- On macOS, verify keychain prompt behavior is acceptable with the existing dev codesign setup.
- On Windows, run the native unit tests and manually verify save/run/delete if a Windows runner or machine is available.

Cross-repo plugin steps:

1. Dev edit in `openit-app/scripts/openit-plugin/instructions/command-authoring.md`.
2. Test by copying or syncing that instruction into a real vault and asking Claude to author a credential-using command.
3. Before merge/release, locate the current `/web` production plugin mirror. If present, copy the same instruction update there and bump the relevant manifest version. If absent, document that the old mirror path no longer exists in the PR.

## 3. Implementation checklist

### Step 1 — Native credential foundation

- [ ] Add a local credential index outside the vault.
- [ ] Add validation and typed native commands for listing, saving, and deleting named env-style credentials.
- [ ] Keep keychain values out of logs and test output.

### Step 2 — Runtime availability

- [ ] Inject saved credentials into app-run scripts.
- [ ] Inject saved credentials into Claude PTY sessions so slash commands can use them too.
- [ ] Preserve existing PATH/TERM behavior and script interpreter handling on macOS and Windows.

### Step 3 — User surface and authoring guidance

- [ ] Add a compact credentials manager in the Tools panel.
- [ ] Update command-authoring instructions to use env vars and forbid secrets in synced files.
- [ ] Verify and update any current `/web` plugin mirror path if it exists.

### Step 4 — Verification

- [ ] Run targeted Vitest/Rust tests.
- [ ] Run `npm run build`.
- [ ] Run `cargo test keychain` / credential-module tests plus `cargo test scripts:: pty::` as separate filters.
- [ ] Manual save/run/delete check with a local vault and no secret value present under the vault.

## 4. Approval checkpoint

Stop here and wait for human review/approval before Stage 03 implementation.
