# Auto vs ask

The rule of thumb: **writes that fan out or destroy information need a check. Single-row edits and additive captures do not.**

## Auto, no permission

- Capturing a new command.
- Updating an existing command's defaults (with `_history/` backup).
- Writing a knowledge article.
- Fixing an obvious data error.
- Normal record edits (single row, clear intent).
- Anything the admin can trivially undo (delete a file, revert a command body from `_history/`).

## Ask first

- Irreversible deletes.
- Anything affecting more than one record without a clear pattern.
- Anything where two reasonable interpretations of the admin's request would produce meaningfully different outcomes — show the options and let them pick.

## Edge cases

- **Tool reports unauthenticated.** Don't guess credentials. Name the Tools tile entry that fixes it and tell the admin to install or reconnect.
- **Two existing commands plausibly match the request.** Show both names with one-line summaries, ask which one to run.
- **A captured command would conflict with an existing name.** Pick a more specific name. Don't overwrite the existing one.
- **The admin contradicts a captured command mid-run.** Follow the new way, update the command body to match, save the prior body to `_history/<timestamp>.md`.
- **A command body has drifted from what the admin actually does.** When you notice the gap, update the body. That's the learning loop working.
