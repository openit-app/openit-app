<p align="center">
  <img src="src-tauri/icons/128x128@2x.png" width="128" alt="OpenIT icon" />
</p>

<h1 align="center">OpenIT</h1>

<p align="center">
  <strong>An IT helpdesk that runs on Claude Code.</strong><br />
  Open source &middot; macOS &middot; Linux &amp; Windows coming soon
</p>

<p align="center">
  <a href="https://github.com/openit-app/openit-app/releases/latest"><img src="https://img.shields.io/github/v/release/openit-app/openit-app?label=download&style=flat-square" alt="Latest release" /></a>
  <a href="https://github.com/openit-app/openit-app/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/openit-app/openit-app/ci.yml?style=flat-square" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/openit-app/openit-app?style=flat-square" alt="License" /></a>
</p>

---

## What is OpenIT?

OpenIT is a desktop app for IT admins at small and mid-size businesses. It wraps [Claude Code](https://docs.anthropic.com/en/docs/claude-code) in a native shell with a file explorer, viewer, and tools catalog — so Claude can handle your ticket queue, provision access, write connectors, and learn how your org works.

**The idea:** you configure your IT helpdesk in plain English. Claude authors the workflows, schemas, and integrations as files on your machine. Open them, edit them, take them with you.

### How it works

1. **Install OpenIT** on your Mac (or build from source).
2. **Claude works alongside you** — reading tickets, writing scripts, connecting to your tools via MCP.
3. **Answer once, automate forever** — each time Claude encounters something new it escalates to you. After you answer, it saves the knowledge as a skill file and handles it next time.

## Download

Grab the latest `.dmg` from [**Releases**](https://github.com/openit-app/openit-app/releases/latest):

| Chip | Download |
|------|----------|
| Apple Silicon (M1–M4) | [`OpenIT_x.x.x_aarch64.dmg`](https://github.com/openit-app/openit-app/releases/latest) |
| Intel Mac | [`OpenIT_x.x.x_x64.dmg`](https://github.com/openit-app/openit-app/releases/latest) |

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
npm run tauri:dev      # dev mode with hot reload
npm run tauri:build    # production build → src-tauri/target/release/bundle/
```

### Running tests

```bash
npm test               # frontend (vitest)
cd src-tauri && cargo test   # backend (rust)
```

## Architecture

OpenIT is **scaffolding around Claude Code**, not a forked IDE. It launches a Claude session in an embedded terminal alongside a project file explorer and viewer.

```
openit-app/
├── src/                 # React frontend (TypeScript)
│   ├── shell/           # Main app shell — file explorer, workbench, chat
│   ├── ui/              # Shared UI components
│   └── lib/             # Core logic — API bindings, state, catalog
├── src-tauri/           # Tauri backend (Rust)
│   └── src/             # Commands, PTY, file watching, state
├── scripts/
│   └── openit-plugin/   # Claude plugin — skills, scripts, schemas
├── landing/             # Marketing site (Astro + Tailwind)
└── integration_tests/   # End-to-end tests
```

### Key concepts

- **Skills** (`scripts/openit-plugin/skills/`) — plain-English instructions Claude follows. e.g. "how to reset a password".
- **Scripts** (`scripts/openit-plugin/scripts/`) — Node.js automations Claude can execute. e.g. offboarding, report generation.
- **Tools catalog** — one-click install for CLI tools (brew, npm) and MCP servers that extend Claude's capabilities.

## Contributing

See [**CONTRIBUTING.md**](CONTRIBUTING.md) for dev setup, coding standards, and the PR process.

## License

Apache License 2.0 — see [LICENSE](LICENSE) for details.

---

Built by [Pinkfish](https://pinkfish.ai). Powered by [Claude Code](https://docs.anthropic.com/en/docs/claude-code).
