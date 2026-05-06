# Brief — BYO-cloud rearchitecture (Pinkfish-free, Obsidian model)

**Status:** exploratory — pre-Linear-ticket
**Author:** ben@pinkfish.ai
**Date:** 2026-05-06
**Predecessor work:** existing local-first sync engine (`src/lib/syncEngine.ts`), git-backed vault at `~/OpenIT/<orgId>/`, plugin-script system

---

## Problem

OpenIT today is tightly coupled to Pinkfish cloud:

- A runtime OAuth token is required to do almost anything (`pinkfishAuth.ts`).
- Five entity adapters (kb, filestore, datastore, agents, workflows) round-trip through Pinkfish REST/skills endpoints.
- Third-party integrations beyond Slack are brokered through the Pinkfish Connections Proxy.
- Plugin scripts ship via the four-sibling repo chain: `openit-app` → `/web` → Pinkfish CDN → user's `.claude/`.

This makes the project hard to position, hard to open-source, and forces every user through a Pinkfish account regardless of whether they want cloud features. It also creates ongoing infra and OAuth-broker costs that scale with users, not with paying customers.

Separately, the current **commit / push / Sync-tab UX is confusing for users**. It's a vestigial concept inherited from the cloud-sync era — most users don't have a mental model for "I edited a file but it isn't synced until I click Push."

## Desired Outcome

OpenIT becomes a **fully local-first desktop app where the vault is just a folder**. Users pick where the folder lives:

- **Local-only** — `~/OpenIT/<workspace>/`. Never leaves the machine.
- **Folder-sync** — drop the vault in `~/Dropbox/`, `~/iCloud Drive/`, `~/Google Drive/`, or any synced folder. Colleagues with the same shared folder collaborate automatically.
- **Git** — the vault is a git repo; push/pull to GitHub/GitLab/Gitea/self-hosted. Built-in pull/commit/push UI, but only in this mode.

No Pinkfish account is required. No sign-up. No runtime token. The four-sibling repo chain collapses to one repo plus optional connector repos.

**The user pitch:** *"Save a file. That's it. If your folder is on Dropbox, your team sees it. If it's a git repo, you push when you're ready. If it's just on your laptop, it stays there."*

## Scope

### In

- Strip Pinkfish auth + cloud round-trips from the five entity adapters; make sync engine storage-only by default.
- Vault picker on first launch (Obsidian-style). Default `~/OpenIT/Personal`. Multi-workspace switcher.
- Per-vault `syncMode` setting: `local` / `folder` / `git`. Sensible defaults; user can change later.
- In folder-sync mode, relocate `.git/` to a sidecar outside the synced folder (`~/Library/Application Support/OpenIT/repos/<workspace-hash>/`) so cloud drives don't corrupt it. Git stays as the internal dirty-detector and history store; user never sees it.
- **Hard split between synced and per-user state.** Cloud drives don't honor `.gitignore`, so today's `.openit/` (which holds `slack.json` bot tokens, delivery ledgers, agent traces, plugin version) would leak into Dropbox/iCloud/Drive in folder-sync mode. **All credential-bearing and per-user state lives outside the vault** in `~/Library/Application Support/OpenIT/<workspace-hash>/`. The vault's `.openit/` keeps only safe-to-share metadata: team-MCP manifest, Slack-leader heartbeat lock, plugin-version markers. The user picks one folder (the vault); the app-support path is derived and hidden, not user-configurable.
- **Plugin scripts get secrets via env vars, not file reads.** Today some scripts read `.openit/slack.json` directly. New pattern: the Tauri app injects relevant secrets (`SLACK_BOT_TOKEN`, etc.) into the environment when spawning Claude or running a plugin script. Scripts read `process.env.*`. Nothing credential-shaped ever sits in a path Claude reads on its own — Claude operates on vault files only.
- **Remove the user-facing commit/push/Sync surface in local-only and folder-sync modes.** Only git mode exposes Pull/Commit/Push.
- File-watcher-driven conflict detection in folder-sync mode (replacing today's server-`updatedAt` trigger). Existing shadow-file UX (`<base>.server.<ext>`) stays.
- **Third-party integrations = MCPs, not in-app connectors.** OpenIT does not broker OAuth or ship per-service adapters for Google / Okta / Jira / Linear / etc. Users install the relevant MCP into Claude Desktop or Claude Code (the MCP handles its own auth — OAuth flow, token paste, whatever the MCP author chose). OpenIT discovers, lists, and helps manage those MCPs but never sees their credentials.
- **Connectors view in OpenIT** — reads `~/Library/Application Support/Claude/claude_desktop_config.json` and `~/.claude.json` (and project-level `.mcp.json`), shows installed MCPs with status, and exposes an "Install" action for any MCP the user doesn't yet have.
- **OpenIT does not write to Claude's config files directly.** Instead, the OpenIT plugin ships a slash command (e.g. `/install-mcp <name>`) that walks the user through installation interactively in their Claude Code session — same pattern the plugin already uses for `sync-push.mjs` and friends. The Connectors view's "Install" button surfaces the command and the args; the user runs it. This sidesteps the schema-coupling risk entirely and keeps OpenIT credential-free.
- **Synced team-MCP manifest at `<vault>/.openit/mcp-team-config.json`.** Lists MCPs the team uses (name, registry URL/package, required env-var schema — **no credentials**). Synced via the vault like any other file, so each teammate sees what colleagues have installed. The Connectors view diffs this manifest against the user's local Claude config and marks each entry as `installed` / `not installed locally` / `version mismatch`. **Installation is never automatic** — clicking "Install" runs the slash command on the user's machine; they confirm and supply their own credentials.
- Slack stays a special case — Slack-as-helpdesk needs a streaming socket-mode listener, which doesn't fit the request/response MCP shape. Keep the existing BYO-creds Slack flow; revisit when a streaming-MCP standard exists.
- **For multi-user shared-vault setups, elect a designated Slack listener via a `.openit/slack-leader.lock` file in the vault** (timestamp + owner heartbeat every minute, stale takeover after N minutes). Whichever teammate's app is up claims it; others stand down. **v1 assumes a teammate's laptop is on during business hours** — closed-laptop / always-on coverage is out of scope for v1.
- Onboarding "stack picker": vault location → sync mode → optional ingress (ngrok / Cloudflare Tunnel / Tailscale Funnel / none) → optional Slack listener → "install MCPs from registry" prompt. Every step skippable.
- Plugin distribution via in-app-bundle on first launch + GitHub-releases update channel (no CDN, no `/web`).

### Out

- Replacing the Pinkfish MCP gateway (semantic search, NL datastore queries). Delete instead — Claude Code/Desktop reads files directly via filesystem MCPs; ripgrep is enough for v1. Local vector search becomes an opt-in power-user upgrade.
- Real-time collaborative editing (CRDTs / p2p). Folder-sync's eventual consistency + shadow-file conflicts is good enough.
- **Always-on Slack ingestion.** No headless listener daemon, no hosted SaaS listener, no webhook-middleware recipe in v1. If everyone's laptops are closed, Slack events queue up to Slack's retry window (~1 hour) and then drop. Backfill via `conversations.history` on wake is also out of scope. Future milestone candidates: (a) ship a headless `openit-listener` binary for VPS/NAS/Pi, (b) project-operated hosted listener as the first paid SKU.
- Building a connector marketplace or per-service adapters in OpenIT. Defer to the MCP ecosystem — every non-Slack integration is "install the MCP into Claude."
- Brokering OAuth for any third-party service. MCPs handle their own auth; OpenIT never sees user credentials for Google / Okta / Jira / etc.
- Keeping the four-sibling repo structure. `/web`, `/platform`, `/firebase-helpers`, `/pinkfish-connections` no longer needed by the desktop app.

## Success Criteria

- [ ] A new user can launch the app, pick `~/Dropbox/MyTeam/`, and use OpenIT end-to-end with **no account creation, no Pinkfish credentials, no commit/push interaction**.
- [ ] A second teammate pointed at the same Dropbox folder sees the first user's tickets/KB/agents within the cloud drive's sync latency.
- [ ] When two users edit the same file simultaneously, the conflict shadow-file UX surfaces and resolution works without invoking any sync server.
- [ ] In a fresh local-only install, the word "Pinkfish" never appears in the UI and no network calls go to `*.pinkfish.ai`.
- [ ] In folder-sync mode, no file inside the synced vault contains a credential, token, or per-user secret. Verifiable by grepping the vault for known token-shaped strings after onboarding completes — must return zero hits.
- [ ] Slack connector continues to work end-to-end (existing BYO-creds flow).
- [ ] Connectors view lists MCPs installed locally in Claude Desktop / Claude Code, with status (connected / errored / not running).
- [ ] Connectors view also lists MCPs installed by *other teammates* (read from the synced `<vault>/.openit/mcp-team-config.json`), each marked as `installed` / `not installed locally`.
- [ ] Clicking "Install" on a not-yet-installed MCP surfaces the `/install-mcp <name>` slash command; running that command in Claude Code walks the user through installation and writes their own Claude config (OpenIT itself never touches Claude's config files).
- [ ] An agent run can call a user-installed MCP (e.g. Google Calendar) without OpenIT touching credentials.
- [ ] Git mode users see Pull/Commit/Push controls; non-git modes do not.
- [ ] No regression in: local Slack listener, plugin-script execution, file explorer, agent runs, intake server, ticket/KB editing.

## Phasing (rough — to be refined in stage 02)

1. **Strip** — make `pinkfishAuth` and all cloud adapters optional / no-op when no creds. ~1 week.
2. **Vault picker + multi-workspace** — Obsidian-style. ~1 week.
3. **Sync modes + sidecar `.git/`** — folder-sync mode, git mode UI, mode-detection at vault create. ~2 weeks.
4. **Remove commit/push UI** in non-git modes; rewrite onboarding without sync ceremony. ~1 week.
5. **Connector framework** — generalize Slack pattern, ship one new connector as proof. ~2 weeks.
6. **Open-source polish** — README, contributor docs, single-repo restructure, public-OAuth-removal sweep. ~1 week.

Total: ~6–8 focused weeks for v1.

## Open questions

- **Commercialization.** Pure OSS removes the recurring-revenue handle. Optional paid layers (managed git remote with RBAC, hosted ingress, project-operated Slack listener as the first paid SKU) are the Obsidian Sync analogue — to be decided separately.
- **Naming / branding.** "OpenIT" works post-rebrand; `openit-app` repo can stay. Anything currently called "Pinkfish-*" in code paths needs renaming.

## What stays the same

- The on-disk format. Data is already JSON + Markdown one-file-per-record in a git repo. No migration of file contents, only of vault location.
- The sync engine's core loop. `syncEngine.ts` diffs `updatedAt` vs `mtime` and calls adapters; the change is what the adapters do (file ops only, in default modes).
- The shadow-file conflict UX. The trigger changes (file watcher vs. server `updatedAt`), the resolution flow doesn't.
- Tauri shell, file explorer, intake server, agent runtime, plugin script system, Slack listener.
- The 6-stage dev process and `auto-dev/` doc tree.

## Notes

- This brief is one strategic decision. Stage 02 will likely fan it out into multiple Linear tickets (one per phase, plus one per open question).
- Keep `auto-dev/00-autodev-overview.md` updated as the cross-repo cheatsheet — large parts become obsolete once the four-sibling structure collapses.
