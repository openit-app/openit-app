# OpenIT — landing copy

## Hero

Status badge: Public Beta · macOS · Open Source

**A shared workspace that runs on Claude Code.**

Lede: Your team shares knowledge, reports, commands, and files — and assigns each other tasks. Claude does the work in plain English, so the answers you figure out once are there for everyone, forever.

CTAs:
- Download for macOS — Beta · Apple Silicon + Intel
- View on GitHub ↗

### Architecture block

**One vault · On disk**
A folder your whole team shares.

Put the vault in a synced folder — Google Drive, Dropbox, git, whatever you already use. Knowledge, reports, commands, files, and tasks all live there as plain files you own.

**Plain English · One chat**
Tell Claude what you need.

No new app to learn. Ask Claude in plain English — write it up, run it, assign it — and the result lands in the vault for the rest of the team.

---

## §01 — The thesis

### Configure in Claude Code. Not UI.

Every other tool is configured the same way: clicky admin screens, proprietary workflow builders, vendor agents you have to learn. The configuration is theirs — and so is your knowledge, locked in their database.

> Claude Code is the operating system.

OpenIT inverts it. You configure in plain English with Claude Code; the result is plain files on your machine. Open them. Edit them. Take them with you.

---

## §02 — One shared vault

### One vault. Your whole team.

Stop scattering what you know across docs, threads, and people's heads. Everything your team shares lives in one vault — plain files in a synced folder you already use.

- **Knowledge** — how-tos and answers, written once and reused
- **Reports** — generated from your data, saved as Markdown
- **Commands** — reusable workflows anyone can run
- **Files** — the attachments, exports, and assets you share
- **Tasks** — assign each other work; no ticketing ceremony
- **People** — who's on the team and what they own

No middleware. No vendor database. The vault is a folder — sync it, `git init` it, back it up. It's yours.

---

## §03 — How it learns

### Answer once. Your team reuses it.

The first time someone works something out, Claude captures the answer **and** the workflow — as a knowledge article or a runnable command. The next time anyone on the team hits the same thing, the answer's already there.

The chat (illustrated):
- *Marcus:* "how do we cut a release again?"
- *OpenIT (first time):* haven't written this down yet — walk me through it
- *You:* "bump the version, tag it, push, the workflow does the rest"
- **✓ Saved — `knowledge/cutting-a-release.md` · command `/release` published**
- *(three days later)*
- *Priya:* "need to ship a release, what's the process"
- *OpenIT:* Here's how we cut a release — or run `/release` and I'll walk you through it.

Every answer becomes a file the whole team shares. Two weeks in, you stop repeating yourselves.

---

## §04 — What gets saved

### Done once. Saved forever.

Each thing you work out becomes a file you can read, edit, and reuse — plain instructions when that's enough, code when it's not.

**Knowledge (plain English) — `knowledge/cutting-a-release.md`**
```
# Cutting a release

1. Bump the version in all three files
2. Tag it and push
3. The release workflow builds, signs, and publishes
```

**Script (for code) — `scripts/weekly-report.ts`**
```
async function weeklyReport() {
  const tasks = await vault.tasks.closedThisWeek()
  const md = render(tasks)
  await vault.reports.write("weekly", md)
}
```

Claude builds them. Then runs them — when anyone on the team asks, or on a schedule.

---

## §05 — Local, then cloud

### Try it on your Mac. Deploy when you trust it.

Run OpenIT on your laptop. Real Claude Code, real integrations, real work — no paid sandbox.

When it earns your trust, sync to Pinkfish. The same vault runs in cloud, 24/7 — agents act while you sleep and the team's knowledge stays in reach from anywhere.

---

## §06 — Status

### Public beta.

macOS (Apple Silicon + Intel), signed and notarized — no first-launch warning. Linux and Windows builds follow.

CTA: Download for macOS — Beta · Apple Silicon + Intel
