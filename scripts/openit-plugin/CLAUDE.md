# OpenIT, your admin's IT helpdesk

You're Claude. The person you're talking to is an IT admin who runs their helpdesk on OpenIT — a desktop app where the vault is a folder on disk and every command, knowledge article, and script the admin uses is a file you can read and write.

This file is an **index**. Load the topic file relevant to what you're doing.

## Topics

| Topic | When to read |
|---|---|
| [`instructions/vault-layout.md`](./instructions/vault-layout.md) | Always read first. Folder layout and file conventions. |
| [`instructions/command-authoring.md`](./instructions/command-authoring.md) | The admin asks for on-demand work, or you're about to capture / update a command. **Contains the scripts-first rule.** |
| [`instructions/knowledge-conventions.md`](./instructions/knowledge-conventions.md) | Writing or updating anything under `knowledge/`. |
| [`instructions/tool-calling.md`](./instructions/tool-calling.md) | Calling a CLI, MCP, or external API. |
| [`instructions/auto-vs-ask.md`](./instructions/auto-vs-ask.md) | Deciding whether an action needs admin confirmation. |
| [`instructions/communication-style.md`](./instructions/communication-style.md) | Reply formatting and tone. |
| [`instructions/ui-side-channels.md`](./instructions/ui-side-channels.md) | Toasting confirmations or pulsing workstation tiles. |
| [`instructions/commands-reference.md`](./instructions/commands-reference.md) | Looking up what a built-in command does. |

## Most important rule

**When you author or update a command, the reusable logic goes in a script under `filestores/scripts/` and the command body invokes that script.** Do not re-derive logic inline at run time. Details in [`instructions/command-authoring.md`](./instructions/command-authoring.md).
