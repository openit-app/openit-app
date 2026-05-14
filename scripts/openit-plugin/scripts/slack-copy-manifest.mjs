#!/usr/bin/env node
// slack-copy-manifest.mjs — copy the Slack app manifest YAML to the
// system clipboard so the user can paste it into
// https://api.slack.com/apps → Create New App → From an app manifest.
//
// Invoked by the connect-slack skill on the `create-app` step. Pure
// Node + a per-OS clipboard CLI — no Tauri / IPC. Reads the YAML from
// `.claude/scripts/slack-manifest.yml` (mirrored by the plugin manifest
// from openit-plugin/scripts/slack-manifest.yml in this repo).
//
// Platform clipboard CLIs: `pbcopy` on macOS, `clip.exe` on Windows
// (ships with the OS), `xclip` or `wl-copy` on Linux.
//
// Output: a single JSON line on stdout, either
//   {"ok": true, "bytes": <n>}
// or
//   {"ok": false, "error": "<reason>"}
// so Claude can branch on it.

import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { flash } from "./_flash.mjs";

function emit(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

/// Per-OS clipboard CLI. On Windows `clip.exe` expects UTF-16 LE
/// (otherwise non-ASCII characters come out as mojibake), so we feed
/// it that. macOS `pbcopy` and Linux `xclip` are both UTF-8 native.
function clipboardCommand() {
  switch (process.platform) {
    case "darwin":
      return { cmd: "pbcopy", args: [], encoding: "utf8" };
    case "win32":
      return { cmd: "clip.exe", args: [], encoding: "utf16le" };
    case "linux":
      // Prefer wl-copy when running under Wayland; fall back to xclip.
      // We can't easily detect at spawn time, so try xclip first — it
      // works under XWayland too, which is the common Linux case.
      return { cmd: "xclip", args: ["-selection", "clipboard"], encoding: "utf8" };
    default:
      return null;
  }
}

async function copyToClipboard(text) {
  const spec = clipboardCommand();
  if (!spec) {
    throw new Error(`clipboard copy not supported on ${process.platform}`);
  }
  return new Promise((resolveP, reject) => {
    const child = spawn(spec.cmd, spec.args);
    child.on("error", (err) => {
      // ENOENT means the CLI isn't installed — give the user something
      // actionable in the JSON error payload instead of a bare errno.
      if (err && err.code === "ENOENT") {
        reject(new Error(`${spec.cmd} not found on PATH`));
      } else {
        reject(err);
      }
    });
    child.on("close", (code) => {
      if (code === 0) resolveP();
      else reject(new Error(`${spec.cmd} exited with code ${code}`));
    });
    child.stdin.end(text, spec.encoding);
  });
}

try {
  const here = dirname(fileURLToPath(import.meta.url));
  const yamlPath = resolve(here, "slack-manifest.yml");
  const yaml = await readFile(yamlPath, "utf8");
  await copyToClipboard(yaml);
  await flash("📋 Slack manifest copied to clipboard");
  emit({ ok: true, bytes: Buffer.byteLength(yaml, "utf8") });
} catch (e) {
  emit({ ok: false, error: String(e?.message ?? e) });
  process.exit(1);
}
