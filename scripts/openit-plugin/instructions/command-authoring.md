# Command authoring

Commands are the admin's reusable workflows. When the admin asks for on-demand work, you either run an existing command or capture a new one. The whole point of capturing is so the **next** run is faster, cheaper, and more deterministic than the first — which only happens if the command leans on pre-baked scripts instead of re-deriving logic inline.

## Be proactive about commands

When the admin asks for on-demand work, **check `filestores/commands/` first** before improvising. Use Glob and Read to scan command bodies for one that matches the request. The admin will almost never start a session by typing a command name or clicking Run on a tile; they'll describe what they want. Your job is to recognize when an existing command applies and follow it, instead of rebuilding the workflow from scratch.

If a command matches, follow it.

If nothing matches, do the work, then **automatically capture it as a new command** in `filestores/commands/<name>.md` so the next time the admin asks for something similar, you find it. Don't ask permission to capture. Do it, then say in one line what you saved: "Saved /weekly-pipeline-snapshot so I can repeat this." The admin can delete it if they don't want it.

## Scripts-first rule (MANDATORY)

**When you author or update a command, the reusable logic must live in a script under `filestores/scripts/` — and the command body must invoke that script.** Do not re-derive the logic inline at run time.

This is the single most important rule in this file. Re-deriving logic inline makes every run non-deterministic, slow, and expensive. Pre-baked scripts make the second run cheap.

### What counts as "reusable logic"

Anything that's not a one-off judgement call:
- Querying a CLI or MCP and shaping the result
- Reading, filtering, or transforming files on disk
- Generating reports, JSON payloads, or formatted output
- Validating inputs, parsing dates, normalizing identifiers
- Anything you'd otherwise type into Bash, Read, Glob, or Edit more than once

### How to author a command

1. **Do the work once, with judgement.** First time through, drive it yourself with tool calls. Note where you make non-trivial decisions vs. where you mechanically transform data.
2. **Extract the mechanical parts into a script** at `filestores/scripts/<name>.mjs`. Always Node.js (`.mjs`). The script should take its inputs as CLI args or stdin and emit structured output (JSON or formatted text) to stdout.
3. **Write the command body** at `filestores/commands/<name>.md`. The body says, in plain language, what the command does — and then **shells out to the script** for the actual work. Reserve inline tool-calls for the judgement steps that genuinely need them (picking which record matched, deciding whether to escalate, etc.).
4. **Test the command end-to-end** by running it once. If it fails, fix the script — not the command body. The command body should stay thin.

### What a command body should look like

```markdown
# /weekly-pipeline-snapshot

Pull this week's pipeline from Salesforce, summarize movement vs. last week, and write a report.

Run:

\`\`\`bash
node filestores/scripts/weekly-pipeline-snapshot.mjs --week current
\`\`\`

The script writes `reports/pipeline-<YYYY-MM-DD>.md` and prints its path. Open that file and walk the admin through the highlights.
```

Not:

```markdown
# /weekly-pipeline-snapshot

1. Use the `sf` CLI to query opportunities closing this quarter.
2. Use the `sf` CLI again to query last week's snapshot.
3. Diff the two lists.
4. Write a markdown report with the deltas.
5. Save it to `reports/`.
```

The second version re-derives the SOQL, the diff logic, and the report format every run. The first version captures all of that in a script and runs deterministically.

## Secrets and credentials (MANDATORY)

**Never write a secret value into a file.** API tokens, passwords, client
secrets, and connection strings must never appear in `filestores/commands/`,
`filestores/scripts/`, `.claude/`, knowledge articles, reports, or any other
file. Those files live in the vault, which syncs to Dropbox / Google Drive and
the cloud dashboard — a secret pasted there leaks to every synced device.

Instead, the admin saves secrets in OpenIT's **Local credentials** store (Tools
panel → Local credentials). Values are kept in the OS secure store (macOS
Keychain, Windows Credential Manager) and are injected into your environment —
and into app-run scripts — as environment variables. **Reference them by name
through `process.env`; never inline the value.**

```js
// filestores/scripts/sync-salesforce.mjs
const token = process.env.SALESFORCE_TOKEN;
if (!token) {
  console.error("Missing SALESFORCE_TOKEN. Save it in Tools → Local credentials.");
  process.exit(1);
}
// …use `token` to authenticate; never log or print it.
```

If a script needs a credential the admin hasn't saved, tell them the exact
env-var name to add in Tools → Local credentials — do **not** ask them to paste
the value into the chat or a file. Credential names are UPPER_SNAKE_CASE
(`^[A-Z_][A-Z0-9_]*$`), e.g. `SALESFORCE_TOKEN`, `WORDPRESS_APP_PASSWORD`.

### When inline logic is OK

- The admin is mid-conversation and explicitly says "just do it this once, don't bother capturing."
- The work is genuinely one-off (no plausible second run).
- The judgement is the whole point (e.g. answering an employee question — there's no script that can answer it for you).

In every other case: extract a script.

## Commands learn from how they're actually used

When a command runs and the admin's choices narrow its behavior (e.g. `/backup` always meaning Salesforce to Drive in this org), **rewrite the command body to reflect the new default** when the run finishes. Save the prior body to `filestores/commands/<name>/_history/<timestamp>.md` first so nothing is lost. If the scope narrowed substantially, rename the command too (`backup` becomes `backup-salesforce`). Tell the admin in one line what you changed: "Updated /backup to default to Salesforce → Drive. Old version in `_history/`."

Do this automatically. Don't ask. The admin has the history file if they disagree.

When you narrow the body, also consider whether the underlying script needs to grow a new default or argument. If so, update the script alongside the command.
