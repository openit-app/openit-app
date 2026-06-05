# PIN-7008: Change Vault preserves current path and supports cancel — Implementation plan

**Ticket:** [PIN-7008](https://linear.app/pinkfish/issue/PIN-7008/openit-fix-change-vault-preserve-current-vault-path-and-provide-cancelback)
**Date:** 2026-06-05
**Repo:** `openit-app` (primary)
**References:** `/web` (plugin home, FE patterns), `/platform` (MCPs, services), `/firebase-helpers` (resource APIs), `/pinkfish-connections` (proxy)
**Predecessor:** None

---

## 1. Technical investigation

The Slack feedback reported that Change Vault currently opens a picker/default state around `~/OpenIT`, even when the user is already in a shared vault, and provides no way to cancel/back out to the active vault.

Current flow:

1. Command palette dispatches `openit:change-vault` from `src/shell/CommandPalette.tsx:185`.
2. `App` handles that event at `src/App.tsx:276`-`284` by setting `bypassOnboarding(false)` and `repo(null)`.
3. `showOnboarding` becomes true at `src/App.tsx:326`, and `App` renders `Onboarding` at `src/App.tsx:332`-`355`.
4. `Onboarding` owns its own `vaultPath` state initialized to `null` at `src/Onboarding.tsx:23`; the visible fallback path is the hard-coded `~/OpenIT` constant at `src/Onboarding.tsx:8` and `src/Onboarding.tsx:127`-`129`.
5. If the user clicks the CTA without browsing, `Onboarding` passes `""` to `onOpenVault` at `src/Onboarding.tsx:92`-`101`. `projectBootstrap` defaults missing paths to `~/OpenIT/Personal/` per `src/lib/api.ts:121`-`125`.
6. `App` has extra path normalization in the onboarding callback at `src/App.tsx:335`-`352`, appending `OpenIT` to selected parent directories unless the path already ends with `/OpenIT`.

Root cause: Change Vault reuses first-run onboarding without giving it any "current vault" context, and the event handler clears the only state (`repo`) needed for a cancel/back path. The default bootstrap contract then makes the blank path resolve to the default personal vault.

Existing tests:

- The closest relevant frontend tests are isolated Vitest component/unit tests under `src/**/*.test.ts(x)`, with mocks for Tauri APIs and local modules.
- No current test covers `App` vault switching or onboarding path resolution.
- Path normalization logic is embedded in `App.tsx`, which makes cross-platform path tests awkward.

Cross-repo reach:

- No plugin scripts, generated clients, or Pinkfish service endpoints are touched.
- `/web` mirror work is not required for this ticket.

## 2. Proposed solution

Keep the fix in the React app. Do not change the Rust/Tauri bootstrap contract.

Approach:

- Track whether onboarding is being shown for first-run setup or for a vault-change flow.
- Do not clear `repo` when Change Vault is opened. Preserve it as the current vault until the user confirms a new vault.
- Pass the current vault path into `Onboarding` as the initial/displayed path for change mode.
- Add a Cancel/back action to `Onboarding` only when there is an active vault to return to.
- Extract the selected-folder-to-vault-path normalization from `App.tsx` into a small pure helper so macOS/Unix and Windows behavior can be unit-tested.
- Keep `openVault` and `createWorkspace` as the only commit point. Until the user clicks the CTA, no bootstrap or workspace registry mutation should happen.

| File | Change |
| --- | --- |
| `src/App.tsx` | Preserve `repo` during `openit:change-vault`, pass current vault/change-mode props into `Onboarding`, handle cancel by hiding onboarding, and use the extracted path helper before bootstrapping. |
| `src/Onboarding.tsx` | Accept optional `initialVaultPath`, `mode`, and `onCancel` props; seed/display the current vault path in change mode; render a secondary Cancel/back action only when `onCancel` exists. |
| `src/lib/vaultPath.ts` | New pure helper for resolving a selected folder into an OpenIT vault path while leaving already-selected OpenIT vaults unchanged. |
| `src/lib/vaultPath.test.ts` | New Vitest coverage for default path, existing `/OpenIT`, parent-directory selection, trailing slash, and Windows backslash paths. |
| `src/App.css` | Minor layout/style support for the added secondary onboarding action if existing button spacing is insufficient. |

Unit tests:

- `src/lib/vaultPath.test.ts`: cover path normalization independent of React/Tauri.
- `src/Onboarding.test.tsx` if the component can be mocked cleanly without brittle setup: verify initial path display and Cancel click. If the Tauri/Claude mocks make the test noisy, keep this as a manual UI scenario and rely on the pure helper for path correctness.

Manual scenarios:

- Existing vault loaded; trigger Change Vault; current vault path is shown instead of `~/OpenIT`.
- Click Cancel/back from Change Vault; the previous vault returns without creating/registering another vault.
- Choose a parent folder on macOS; app opens `<selected>/OpenIT`.
- Choose an existing `OpenIT` folder; app opens that folder directly without appending another `OpenIT`.
- Repeat equivalent path checks on Windows path strings through unit tests, and manually verify on Windows before release if available.

## 3. Implementation checklist

### Step 1 — Path contract

- [ ] Add `src/lib/vaultPath.ts` so path normalization is explicit and testable.
- [ ] Add focused unit tests for Unix/macOS and Windows path cases.

### Step 2 — Change-vault state flow

- [ ] Update `App` so Change Vault shows onboarding without discarding the active `repo`.
- [ ] Wire confirm/cancel handlers so only confirm bootstraps/registers a vault, while cancel restores the current shell.

### Step 3 — Onboarding UI

- [ ] Add change-mode props to `Onboarding` and seed the visible path from the current vault.
- [ ] Add the conditional secondary Cancel/back action with existing button styling.

### Step 4 — Verification

- [ ] Run the targeted Vitest tests.
- [ ] Run `npm run build` for typecheck/build coverage.
- [ ] Click through the Change Vault scenarios in the app.

## 4. Approval checkpoint

Stop here and wait for human review/approval before Stage 03 implementation.
