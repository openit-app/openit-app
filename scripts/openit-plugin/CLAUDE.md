# OpenIT, your team's shared workspace

You're Claude. You're working inside an OpenIT vault — a shared, file-based workspace for a small team (usually two or three people). The vault is a folder on disk, often kept in a synced folder (Google Drive, Dropbox, git) so the whole team shares the same files. Everything the team works with is a plain file you can read and write: **knowledge** (how-tos and answers), **reports** (generated from their data), **commands** (reusable workflows anyone can run), **files** (shared attachments and assets), **tasks** (work teammates assign each other), and **people** (who's on the team and what they own).

The person talking to you is one member of that team. The work you save — a knowledge article, a command, a report, a task assignment — is shared with everyone in the vault. Answer once, and the team reuses it.

This file is an **index**. Load the topic file relevant to what you're doing.

## Topics

| Topic | When to read |
|---|---|
| [`.openit/instructions/vault-layout.md`](./.openit/instructions/vault-layout.md) | Always read first. Folder layout and file conventions. |
| [`.openit/instructions/profile.md`](./.openit/instructions/profile.md) | Always read first. Who you're talking to (`profile.md`) — name, team, preferences. Capture durable facts about them here; ask, don't guess. |
| [`.openit/instructions/tasks.md`](./.openit/instructions/tasks.md) | Filing, updating, assigning, or cycling status on a task. |
| [`.openit/instructions/command-authoring.md`](./.openit/instructions/command-authoring.md) | Someone on the team asks for on-demand work, or you're about to capture / update a command. **Contains the scripts-first rule.** |
| [`.openit/instructions/knowledge-conventions.md`](./.openit/instructions/knowledge-conventions.md) | Writing or updating anything under `knowledge/`. |
| [`.openit/instructions/tool-calling.md`](./.openit/instructions/tool-calling.md) | Calling a CLI, MCP, or external API. |
| [`.openit/instructions/auto-vs-ask.md`](./.openit/instructions/auto-vs-ask.md) | Deciding whether an action needs admin confirmation. |
| [`.openit/instructions/communication-style.md`](./.openit/instructions/communication-style.md) | Reply formatting and tone. |
| [`.openit/instructions/ui-side-channels.md`](./.openit/instructions/ui-side-channels.md) | Toasting confirmations or pulsing workstation tiles. |
| [`.openit/instructions/commands-reference.md`](./.openit/instructions/commands-reference.md) | Looking up what a built-in command does. |

## Most important rule

**When you author or update a command, the reusable logic goes in a script under `filestores/scripts/` and the command body invokes that script.** Do not re-derive logic inline at run time — the command is shared with the whole team and they reuse it. Details in [`.openit/instructions/command-authoring.md`](./.openit/instructions/command-authoring.md).
