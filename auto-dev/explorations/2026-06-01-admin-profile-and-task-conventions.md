# Admin profile + task assignee/auto-create conventions

**Date:** 2026-06-01
**Status:** instruction-layer changes shipped in the plugin; app-side surfacing (a Profile tile) is a follow-up.

## Problem

1. **Tasks land "Unassigned" when Claude creates them.** The Tasks UI pre-fills the assignee from the laptop's global git config (`global_user_name()` → `git config --global user.name`), but Claude, writing the task file, never set an assignee — its instructions didn't mention the field or who the admin is.
2. **Git inference is the wrong fix.** Many admins don't have git installed, and inferring identity from the OS/machine is a guess. A confident wrong guess is worse than asking.

## Decision: ask once, then remember — in a profile

Replace identity *inference* with identity *capture*, mirroring OpenIT's "answer once, automate forever" model (and Claude's own memory system):

- **`profile.md` at the vault root** holds durable facts about the admin: `name`/`email`/`role` in frontmatter, plus free-form sections for working style, team, and preferences. Plain markdown the admin can read and edit; surfaced as a workstation tile (follow-up).
- Claude **reads it at session start** and **captures durable facts** the admin shares (same bar as a good memory — no transient/conversation-specific noise, no guesses).
- When Claude needs a fact it doesn't have (commonly the admin's name for a task assignee), it **asks once, saves it to `profile.md`, and reuses it** — never infers from git/OS.

### Why root `profile.md`, not `knowledge/` or `library/`
- `knowledge/` is **employee-facing answers** — a profile about the admin isn't that, and it would pollute KB search.
- `filestores/library/` (reference docs) fits loosely, but burying it there loses the point: its value is being **read at the start of every session**. A first-class, always-read root file (like `vault-layout.md` is "always read first") is the right altitude.

### Open trade-off: shared vs. private
The vault is synced (Drive/Dropbox) and team-shared, so a single `profile.md` is *the admin's* and syncs to teammates. Fine for single-admin installs; multi-admin would want per-person profiles, but we can't reliably key by identity (no git). v1 = one profile = "whoever set up this vault." If privacy outweighs shareability, the profile could instead live local-only in `.openit/` (unsynced) — at the cost of teammate visibility. (Related: the same shared-vault tension drives the [credentials feature](#related) design.)

## Decision: don't auto-create tasks, don't auto-cycle status

- **Auto-creating a task per session is not wanted** and already discouraged (`instructions/tasks.md`: "Do not create a task for every session… the trace already captures it"). Every session is auto-recorded as a **trace** — that's the durable log. Tasks are deliberate.
- **Status is never auto-cycled** without the admin's direction (already the rule). Auto-advancing `in-progress → complete` is unreliable (Claude can't truly know when work is "done") and strips the admin's control. Claude should *propose* a status change; the admin clicks the pill.
- The dev-facing `CLAUDE.md` previously described an "every session is a ticket → auto-create tickets" behavior — that was stale and has been corrected.

## Changes shipped (plugin instruction layer)

- `instructions/profile.md` (new) — the profile convention + capture rules; added to `manifest.json`; manifest bumped to `2026-06-01-001`.
- `instructions/tasks.md` — assignee now sourced from `profile.md` (ask-once if unknown), explicitly **not** from git/OS.
- `CLAUDE.md` (vault) — `profile.md` added to the topics table as "always read first."
- `instructions/vault-layout.md` — `profile.md` added to the layout table; task frontmatter now lists `assignee`.
- `CLAUDE.md` (dev/repo) — corrected the stale auto-create-tickets description.

## Follow-ups (not yet built)

- **Profile workstation tile** — surface `profile.md` in the app (view/edit), like other stores.
- **Multi-admin / privacy** — decide shared-root vs. local-`.openit/` once there's a real multi-admin case.

<a name="related"></a>
## Related
- Credentials feature (separate exploration): secret *values* in the OS keychain (`keychain.rs`, never synced), name-only definitions shared in the vault, injected as env vars at the CC-session and script spawn points. Same "shared vault can't hold private/secret data" root cause.
