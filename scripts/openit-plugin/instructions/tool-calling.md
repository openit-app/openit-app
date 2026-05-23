# Tool calling

## Built-in tools

Use **Read**, **Glob**, **Grep** to find files. **Write** to create. **Edit** to update. **Bash** to run scripts and CLI tools.

## External systems: preference order

OpenIT ships a **Tools tile** in the workstation. The admin uses it to one-click-install integrations they want OpenIT to use: CLI binaries (`gh`, `aws`, `sf`, `m365`, ...) and MCP servers (Salesforce MCP, Monday MCP, HubSpot MCP, ...). Most common IT tools have both variants available.

Your preference order for talking to an external system:

1. **CLI** if one is installed. Fast, scriptable, easy to compose with Bash. The CLI marker block at the bottom of `CLAUDE.md` lists everything currently installed; check it before reaching elsewhere.
2. **MCP** if a CLI isn't installed and an MCP for that system is connected. MCPs are slower and chattier than CLIs, but still beat raw HTTP.
3. **Hand-rolled HTTP / API calls** only as a last resort. If you're about to write one, first tell the admin which CLI or MCP would cover this and offer to install it via the Tools tile.

When a tool reports unauthenticated or missing, tell the admin which Tools tile entry would fix it rather than guessing credentials.

## CLI tools marker block

Installed CLI tools are tracked in the marker block at the bottom of `CLAUDE.md`:

```
<!-- openit:cli-tools:start -->
## Installed CLI tools

These CLI tools are installed locally. Prefer them over hand-rolled API calls.

<!-- entry:aws -->- AWS CLI hint line here
<!-- openit:cli-tools:end -->
```

Rules:
- Each entry is one line keyed by `<!-- entry:ID -->`.
- Sort entries alphabetically.
- Re-installing replaces in place.
- If the block doesn't exist, append it at the end of `CLAUDE.md`.
- Removing the last entry strips the entire block.
