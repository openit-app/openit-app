<p align="center">
  <img src="src-tauri/icons/128x128@2x.png" width="128" alt="OpenIT icon" />
</p>

<h1 align="center">OpenIT</h1>

<p align="center">
  <strong>A shared, file-based workspace for small teams, powered by Claude Code.</strong><br />
  Answer once, reuse forever. Open source. Runs on your Mac.
</p>

<p align="center">
  <a href="https://github.com/openit-app/openit-app/releases/latest"><img src="https://img.shields.io/github/v/release/openit-app/openit-app?label=download&style=flat-square" alt="Latest release" /></a>
  <a href="https://github.com/openit-app/openit-app/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/openit-app/openit-app/ci.yml?style=flat-square" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/openit-app/openit-app?style=flat-square" alt="License" /></a>
</p>

---

## The problem

You're on a small team — two or three people who do a bit of everything. The knowledge that keeps things running is scattered: half in someone's head, half in a doc nobody can find, the rest in a thread you'll never scroll back to. The same questions get answered over and over. Work gets handed off in passing and dropped. Every tool that promises to fix this wants you in *its* UI, on *its* schedule, storing *your* knowledge in *its* database.

You don't need another dashboard to log into. You need a place your team actually shares — that learns how *you* work and hands the repetitive stuff back to you as something you can run again.

## What OpenIT does

OpenIT is a desktop app that wraps [Claude Code](https://docs.anthropic.com/en/docs/claude-code) in a native shell built around a shared, file-based vault. It gives Claude a file explorer, viewer, tools catalog, and a set of skills — so your team can share knowledge, reports, commands, and files, assign each other tasks, and let Claude do the work in plain English.

**The idea:** you configure your workspace in plain English. Claude authors the knowledge, workflows, schemas, and integrations as files on your machine. Put the vault in a synced folder — Google Drive, Dropbox, git, whatever you already use — and your whole team shares it. Open the files, edit them, take them with you.

### How it works

1. **Install and open.** OpenIT creates a vault — a folder where everything lives: knowledge, reports, commands, files, tasks, and people. Drop it in a synced folder and your team shares one vault.
2. **Talk to Claude.** Describe what you need. "Write up how we cut a release" or "assign Priya the vendor audit." Claude writes the file, and you review it.
3. **Answer once, reuse forever.** The first time someone works something out, Claude saves it as knowledge or a runnable command. Next time, anyone on the team just reuses it.
4. **Everything is a file.** Knowledge and commands are Markdown. Schemas are JSON. Scripts are JavaScript. No vendor lock-in, no black boxes. `git init` and you have version control.

### Built-in commands

OpenIT ships with ready-to-run commands for common team tasks:

- `/onboard` — walk through granting access for a new employee across Slack, Google Workspace, Zoom, and more
- `/offboard` — walk through revoking access for a departing employee
- `/backup-saas-systems` — export data from Salesforce, HubSpot, Monday, Slack to cloud storage
- `/conversation-to-automation` — turn a solved ticket into a reusable knowledge base article + skill

Run `/getting-started` after install for a guided walkthrough.

## Download

Grab the latest `.dmg` from [**Releases**](https://github.com/openit-app/openit-app/releases/latest):

| Chip | Download |
|------|----------|
| Apple Silicon (M1–M4) | [`OpenIT_aarch64.dmg`](https://github.com/openit-app/openit-app/releases/latest) |
| Intel Mac | [`OpenIT_x64.dmg`](https://github.com/openit-app/openit-app/releases/latest) |

> **First launch:** macOS will say "OpenIT can't be opened because Apple cannot check it for malicious software." Open **System Settings → Privacy & Security**, scroll down, and click **Open Anyway**. This is expected for beta builds — signed releases are coming.

> **Requires [Claude Code](https://docs.anthropic.com/en/docs/claude-code)** — OpenIT will guide you through setup if it's not installed.

> Linux and Windows builds are planned — contributions welcome.

## Build from source

### Prerequisites

- **Node.js** >= 20
- **Rust** (stable) — install via [rustup](https://rustup.rs/)
- **Tauri CLI** — `npm install` handles this via `@tauri-apps/cli`
- An [Anthropic API key](https://console.anthropic.com/) for Claude Code

### Steps

```bash
git clone https://github.com/openit-app/openit-app.git
cd openit-app
npm install
npm run tauri dev      # dev mode with hot reload
npm run tauri build    # production build → src-tauri/target/release/bundle/
```

### Running tests

```bash
npm test                       # frontend (vitest)
cd src-tauri && cargo test     # backend (rust)
```

## Architecture

OpenIT is **scaffolding around Claude Code**, not a forked IDE. It launches a Claude session in an embedded terminal alongside a project file explorer and viewer.

```
openit-app/
├── src/                 # React frontend (TypeScript)
│   ├── shell/           # App shell — file explorer, viewers, workbench
│   │   ├── viewers/     # Entity-specific viewers (agents, datastores, traces)
│   │   ├── explorer/    # File tree with drag-drop, context menu
│   │   └── routing/     # Path → viewer source resolution
│   ├── ui/              # Design system components
│   └── lib/             # Core logic — API bindings, sync, catalog
├── src-tauri/           # Tauri backend (Rust)
│   └── src/
│       ├── kb/          # Knowledge base sync (local + cloud)
│       └── ...          # PTY, file watching, git ops, tools
├── scripts/
│   └── openit-plugin/   # Claude plugin — skills, scripts, schemas, seed data
├── landing/             # Website (Astro + Tailwind) → GitHub Pages
└── integration_tests/   # End-to-end test suite
```

### Key concepts

| Concept | What it is | Where it lives |
|---------|-----------|----------------|
| **Skills** | Plain-English instructions Claude follows (e.g., "how we cut a release") | `skills/*.md` |
| **Scripts** | Node.js automations Claude can execute (e.g., report generation, exports) | `scripts/*.mjs` |
| **Knowledge base** | Articles Claude references and your team reuses — grows over time | `knowledge-bases/` |
| **Datastores** | Structured data — tasks, people, assets, access logs | `databases/` |
| **Tools catalog** | One-click install for CLI tools and MCP servers that extend Claude | In-app Tools panel |

## Contributing

We welcome contributions. See [**CONTRIBUTING.md**](CONTRIBUTING.md) for dev setup, coding standards, and the PR process.

Good first issues are labeled [`good first issue`](https://github.com/openit-app/openit-app/labels/good%20first%20issue).

## License

Apache License 2.0 — see [LICENSE](LICENSE) for details.

---

Built with [Claude Code](https://docs.anthropic.com/en/docs/claude-code).
