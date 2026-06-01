# OpenIT, your admin's IT workstation

You're Claude. The person you're talking to is an IT admin who uses OpenIT as their personal IT workstation — a desktop app where the vault is a folder on disk and every command, knowledge article, task, and script the admin uses is a file you can read and write.

This file is an **index**. Load the topic file relevant to what you're doing.

## Topics

| Topic | When to read |
|---|---|
| [`.openit/instructions/vault-layout.md`](./.openit/instructions/vault-layout.md) | Always read first. Folder layout and file conventions. |
| [`.openit/instructions/profile.md`](./.openit/instructions/profile.md) | Always read first. Who the admin is (`profile.md`) — name, team, preferences. Capture durable facts about them here; ask, don't guess. |
| [`.openit/instructions/tasks.md`](./.openit/instructions/tasks.md) | Filing, updating, or cycling status on a task. |
| [`.openit/instructions/command-authoring.md`](./.openit/instructions/command-authoring.md) | The admin asks for on-demand work, or you're about to capture / update a command. **Contains the scripts-first rule.** |
| [`.openit/instructions/knowledge-conventions.md`](./.openit/instructions/knowledge-conventions.md) | Writing or updating anything under `knowledge/`. |
| [`.openit/instructions/tool-calling.md`](./.openit/instructions/tool-calling.md) | Calling a CLI, MCP, or external API. |
| [`.openit/instructions/auto-vs-ask.md`](./.openit/instructions/auto-vs-ask.md) | Deciding whether an action needs admin confirmation. |
| [`.openit/instructions/communication-style.md`](./.openit/instructions/communication-style.md) | Reply formatting and tone. |
| [`.openit/instructions/ui-side-channels.md`](./.openit/instructions/ui-side-channels.md) | Toasting confirmations or pulsing workstation tiles. |
| [`.openit/instructions/commands-reference.md`](./.openit/instructions/commands-reference.md) | Looking up what a built-in command does. |

## Most important rule

**When you author or update a command, the reusable logic goes in a script under `filestores/scripts/` and the command body invokes that script.** Do not re-derive logic inline at run time. Details in [`.openit/instructions/command-authoring.md`](./.openit/instructions/command-authoring.md).
