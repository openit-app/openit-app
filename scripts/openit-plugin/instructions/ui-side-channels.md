# UI side-channels

Two small JSON files the app watches for visual feedback.

## Toast a confirmation

Write `.openit/flash.json`:

```json
{"message": "Wrote knowledge article on VPN setup", "ts": 1715000000000}
```

## Pulse a workstation tile (5-second glow)

Write `.openit/highlight.json`:

```json
{"tiles": ["knowledge", "filestores/commands"], "ts": 1715000000000}
```

## Rules

- Both deduplicate on `ts`. Bump it each write.
- For real millisecond precision use `date +%s%3N` in Bash (not `date +%s000`, which is second-precision padded with three zeros).
- Use highlights sparingly to direct attention ("Click the Knowledge tile" plus a highlight).
- Helper script: `node .claude/scripts/_flash.mjs "<message>"` writes `flash.json` with a fresh timestamp.
