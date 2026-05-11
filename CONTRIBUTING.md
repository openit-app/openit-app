# Contributing to OpenIT

Thanks for your interest in contributing to OpenIT! This guide covers everything you need to get started.

## Getting started

### Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | >= 20 | [nodejs.org](https://nodejs.org/) |
| Rust | stable | [rustup.rs](https://rustup.rs/) |
| npm | >= 10 | Ships with Node.js |

### Dev setup

```bash
git clone https://github.com/openit-app/openit-app.git
cd openit-app
npm install
```

### Running locally

```bash
npm run tauri dev          # launches the app with hot reload
```

This starts both the Vite dev server (frontend) and the Tauri Rust backend. Changes to `src/` hot-reload instantly; changes to `src-tauri/src/` trigger a Rust recompile.

### Running tests

```bash
npm test                   # frontend unit tests (vitest)
cd src-tauri && cargo test # rust unit tests
```

## Project structure

```
src/                  # React + TypeScript frontend
  shell/              # App shell (file explorer, workbench, viewers)
  ui/                 # Reusable UI components
  lib/                # Core logic (API, state, catalogs)
src-tauri/            # Rust backend (Tauri commands, PTY, file watch)
scripts/
  openit-plugin/      # Claude plugin shipped with the app
    skills/           # Plain-English skill files
    scripts/          # Node.js automation scripts
    schemas/          # JSON schemas for entities
landing/              # Marketing site (Astro + Tailwind)
integration_tests/    # End-to-end integration tests
```

## Making changes

### Branch naming

Create a feature branch off `main`:

```bash
git checkout -b feat/short-description    # new feature
git checkout -b fix/short-description     # bug fix
```

### Code style

- **TypeScript** — strict mode, no `any` unless unavoidable. We use the built-in `tsc` for type checking.
- **Rust** — standard `cargo fmt` + `cargo clippy`. CI fails on warnings.
- **CSS** — CSS modules (`.module.css`) colocated with components.

### Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add MCP server one-click install
fix: file explorer not refreshing after rename
docs: update build instructions for Linux
chore: remove unused sync engine exports
```

### Testing

- Write tests for new logic. Tests live alongside source files (`*.test.ts`) or in `integration_tests/`.
- Run `npm test` before pushing — CI will catch it anyway but saves a round trip.
- For Rust changes, run `cargo test` and `cargo clippy -- -D warnings`.

## Pull requests

1. **Keep PRs focused.** One feature or fix per PR. Easier to review, easier to revert.
2. **Write a clear description.** What changed, why, and how to test it.
3. **CI must pass.** The PR checks run `tsc`, `vitest`, `cargo fmt`, `cargo clippy`, and `cargo test`.
4. **Screenshots welcome** for UI changes.

### PR template

```markdown
## What

Brief description of the change.

## Why

Link to issue or explain the motivation.

## How to test

Steps to verify the change works.
```

## Reporting issues

File issues on [GitHub Issues](https://github.com/openit-app/openit-app/issues). Include:

- What you expected vs. what happened
- Steps to reproduce
- macOS version and chip (Apple Silicon / Intel)
- OpenIT version (from the app's title bar or `About` menu)

## Adding skills and scripts

One of the best ways to contribute is adding new skills and scripts to the Claude plugin:

- **Skills** (`scripts/openit-plugin/skills/`) are plain Markdown files that teach Claude how to handle a specific IT task. No code needed.
- **Scripts** (`scripts/openit-plugin/scripts/`) are Node.js (`.mjs`) automations that Claude can invoke.

See existing files in those directories for examples.

## License

By contributing, you agree that your contributions will be licensed under the Apache License 2.0. See [LICENSE](LICENSE).
