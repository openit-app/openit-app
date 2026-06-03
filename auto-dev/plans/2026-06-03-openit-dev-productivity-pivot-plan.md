# OpenIT pivot: ITSM helpdesk → dev-productivity / team-knowledge tool

**Epic:** [PIN-6928](https://linear.app/pinkfish/issue/PIN-6928)
**Children:** [PIN-6930](https://linear.app/pinkfish/issue/PIN-6930) (Slack) · [PIN-6931](https://linear.app/pinkfish/issue/PIN-6931) (ticket→task) · [PIN-6932](https://linear.app/pinkfish/issue/PIN-6932) (copy)
**Date:** 2026-06-03
**Phase:** 1 — Planning

---

## Why

OpenIT was built as "your IT helpdesk, powered by Claude Code" (ITSM for 10–200-person companies). Real usage has drifted: small teams of **2–3 share one vault over Google Drive** and use it to share **knowledge, reports, commands, and files**, and to **assign each other tasks** (the feature that replaced tickets in PIN-6605). This epic aligns the product surface with that reality.

## Locked decisions (owner, 2026-06-03)

| Decision | Choice |
|---|---|
| Name + tagline | **Keep** `OpenIT` + `get IT done`, read generically. No rename. |
| Command catalog | **Leave as-is** this pass (`/onboard`, `/offboard`, `/backup-saas-systems`, `/salesforce-*`, `/asset-tracking`). Fresh dev-productivity set is a later effort. |
| Ticket backend | **Finish the migration** — rip it out, don't leave it dormant. |
| Sequence | **Plan + Linear first** (this), then 3 child PRs. |
| Slack | **Remove entirely.** |

## Sequence & dependencies

```
PIN-6930 (Slack)  ──►  PIN-6931 (ticket→task)  ──►  PIN-6932 (copy)
        └──────────────── both touch intake/mod.rs ─┘        (copy reflects
                                                              no-Slack / no-tickets reality)
```

- **6930 first** — surgical, low-risk, removes `TransportMeta::Slack` from `intake/mod.rs`.
- **6931 next** — guts the rest of the intake/ticket backend (shares `intake/mod.rs`, hence blocked-by).
- **6932 last** — copy can only be final once Slack + tickets are actually gone.

All three are separate PRs against `main` (protected — PR + frontend/rust checks).

---

## Workstream A — Remove Slack (PIN-6930)

Well-modularized; mostly deletion. **~15 files deleted, ~10 modified, ~2,000 LOC.**

**Delete:** `src-tauri/src/slack/` (mod/api/config/listener) · `src/ui/SlackChip.tsx` · plugin skills `connect-slack.md` + `slack-to-knowledge.md` · plugin scripts `slack-listen.src.mjs` / `slack-listen.bundle.cjs` (848KB) / `slack-copy-manifest.mjs` / `slack-manifest.yml` / `slack-disconnect.mjs` / `slack-send-intro.mjs` / `build-slack-listener.mjs` · seed `sample-*-slack.json` · deps `@slack/socket-mode` + `@slack/web-api` + `build:slack-listener` script (+ check `libc` in Cargo.toml).

**Modify:** `lib.rs` (mod + state + 8 commands) · `intake/mod.rs` (`TransportMeta::Slack` + `/skill/slack-send-intro`) · `api.ts` (types + 6 bindings) · `App.tsx` (state + 3 effects + handler + props) · `StatusBar/Shell/SkillActionDock/CommandPalette.tsx` · `explorer/helpers.ts` (`looksLikeSlackId`) · `manifest.json` (7 refs, bump version) · README + root CLAUDE.md. Close dependabot PR #212.

**Done when:** `rg -i slack` clean in shipping code; cargo/npm/tsc/clippy clean; app launches with no Slack chip or palette entries; lockfiles regenerated.

## Workstream B — Finish ticket→task migration (PIN-6931)

PIN-6605 took the ticket UI; the backend lingers. Remove/repoint:

- **Responder/backend:** `ai-intake.md` (helpdesk responder) · `intake/` ticket+conversation writing · `databases/tickets/` + `databases/conversations/`.
- **Reporting:** `report.md` + `report-overview.mjs` (`TICKETS_DIR`/`CONVERSATIONS_DIR`) → repoint onto `tasks/`.
- **Samples:** `hello-world.md`, `sample-2026-05-01-weekly-overview.md`, `cleanup.md` → tasks.
- **Frontend:** `DatastoreViewer.tsx` empty states; `viewerTypes.ts` / `App.tsx` `ticketId` trace fields (assess rename vs. leave).

**Resolved (owner, 2026-06-03): delete the chat-intake server entirely.** Not repurposed. Remove `src-tauri/src/intake/` (server + `chat_ui.html` + `prompts.rs`), the `ai-intake.md` responder, its `lib.rs` registration/state + tunnel/URL exposure, and any frontend that surfaced the intake URL/QR/web form. Tasks are created in-app and via Claude — no hosted intake page.

**Done when:** nothing writes `databases/tickets|conversations`; reports + samples speak "tasks"; `rg -i ticket src` clean except intentional trace internals.

## Workstream C — Reposition copy (PIN-6932)

Working narrative (refine in Phase 1):

> OpenIT is a shared, file-based workspace for small teams. Put your vault in Google Drive and your team shares knowledge, reports, commands, and files — and assigns each other tasks. Claude Code is the operating system: configure everything in plain English, and it lives as plain files you own. No vendor lock-in.

**Rewrite:** README (problem / what / how / commands intro) · `landing/copy/home.md` + `index.astro` (hero, lede, §01 "Every other ITSM", §02 tool list, §03/§04, **remove Slack mock**) · `BaseLayout.astro` meta · `privacy.astro` vault-contents line · `tauri.conf.json` short/long description (keep productName) · root + plugin `CLAUDE.md` (plugin opener: solo IT admin → shared team vault) · `commands-reference.md` descriptions · `getting-started.md` ~L84 stale "onboard/offboard logs" bullet (rest of tour already task-centric).

**Keep:** name, `get IT done` tagline.

**Done when:** no "IT helpdesk / ITSM / ticket queue / onboard-offboard employee" framing in README/landing/metadata; no Slack/Teams in landing; Astro builds; plugin CLAUDE.md describes a team vault.

---

## Notes for whoever picks these up

- The **tour is in good shape** — only one stale bullet; the 3 acts already revolve around tasks. Don't over-scope it.
- The **intake-server fate** is decided: **delete it** (no repurpose). B removes the whole `intake/` module after 6930 has stripped the Slack bits from it.
- Cross-repo mirror reminder (per prior plans): plugin file changes under `scripts/openit-plugin/` may need copying into `web/packages/app/public/openit-plugin/` post-merge — verify the current sync path.

## Status log

- **2026-06-03** — Plan + Linear epic (PIN-6928) and children (6930/6931/6932) created; all at Phase 1 (Auto-Planning). Awaiting plan review before implementation.
