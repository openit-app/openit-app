// Bundled-seed helper, exposed via the "Create sample dataset" CTA in
// `getting-started.md`. Writes sample tickets/people/conversations/KB
// articles to disk so a user has something to interact with.
//
// **Connected mode never auto-seeds.** Seeding is exclusively user-
// triggered — once an account is in the loop, we trust whatever's on
// disk and in the cloud.
//
// Gate is **per-file**, not per-folder: re-clicking the CTA fills in
// any missing sample without clobbering files that already exist on
// disk. A user who deleted `sample-ticket-3.json` and clicks again
// gets just that one file back. A user who has authored their own
// tickets alongside the samples gets nothing rewritten.

import { invoke } from "@tauri-apps/api/core";
import { fsRead, scriptResolveInterpreter } from "./api";
import { fetchSkillFile, fetchSkillsManifest } from "./skillsSync";

/// Rewrite `#!/usr/bin/env <interpreter>` to a hard-coded absolute path
/// for newly-seeded script files. Solves the macOS GUI-launch PATH
/// problem: when the desktop app spawns these scripts later, it can't
/// rely on `env` finding `node` because the inherited PATH from
/// Finder / Dock doesn't include Homebrew. Baking the resolved path
/// at seed time guarantees the script runs on first try regardless
/// of how the host shell is configured.
///
/// Returns the original content unchanged when:
///   - the file has no `#!/usr/bin/env <interpreter>` shebang,
///   - the interpreter isn't one we know how to run (`node`, `python3`),
///   - the file's extension doesn't match the interpreter,
///   - the interpreter isn't installed on this machine (rare — the
///     runner still surfaces a friendly "install Node.js" message).
///
/// Only newly-seeded files pass through here. Already-on-disk scripts
/// are left alone (per the per-file seed gate in `seedIfEmpty`), so
/// users who got the broken seeds in an earlier build keep whatever
/// workaround they had.
export async function rewriteShebangForSeed(
  filename: string,
  content: string,
): Promise<string> {
  // Match the canonical "env"-style shebang on the first line only.
  // Anything more exotic (custom path, explicit absolute path
  // already, multi-arg) is intentionally untouched.
  // Capture the trailing newline (`\r\n` on Windows, `\n` elsewhere)
  // so we can preserve the original line ending in the output.
  // Using `[\t ]*` instead of `\s*` for the optional trailing
  // whitespace so `\s*` doesn't gobble the `\r` and leave only `\n`
  // in the capture group.
  const match = content.match(/^#!\/usr\/bin\/env[\t ]+(\S+)[\t ]*(\r?\n)/);
  if (!match) return content;
  const interpreter = match[1];
  // Restrict the rewrite to interpreters we actually run from the
  // app's "Run" affordance. Anything else (bash, ruby, perl, ...) is
  // a script the admin manages themselves; don't touch their shebang.
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  const allowedByExt: Record<string, string> = {
    mjs: "node",
    js: "node",
    cjs: "node",
    py: "python3",
  };
  const expected = allowedByExt[ext];
  if (!expected || expected !== interpreter) return content;
  let abs: string | null = null;
  try {
    abs = await scriptResolveInterpreter(interpreter);
  } catch (err) {
    console.warn(`[seed] resolve ${interpreter} failed:`, err);
    return content;
  }
  if (!abs) return content;
  const newline = match[2]; // preserve LF vs CRLF
  const rest = content.slice(match[0].length);
  return `#!${abs}${newline}${rest}`;
}

/// Map a `seed/<target>/<...>` manifest path to its workspace destination.
/// Returns null if the path doesn't match a known seed pattern.
export function seedRoute(
  manifestPath: string,
): { subdir: string; filename: string } | null {
  if (manifestPath.startsWith("seed/tickets/")) {
    return { subdir: "databases/tickets", filename: manifestPath.replace("seed/tickets/", "") };
  }
  if (manifestPath.startsWith("seed/people/")) {
    return { subdir: "databases/people", filename: manifestPath.replace("seed/people/", "") };
  }
  if (manifestPath.startsWith("seed/knowledge/")) {
    return { subdir: "knowledge", filename: manifestPath.replace("seed/knowledge/", "") };
  }
  if (manifestPath.startsWith("seed/commands/")) {
    return { subdir: "filestores/commands", filename: manifestPath.replace("seed/commands/", "") };
  }
  if (manifestPath.startsWith("seed/scripts/")) {
    return { subdir: "filestores/scripts", filename: manifestPath.replace("seed/scripts/", "") };
  }
  if (manifestPath.startsWith("seed/access/")) {
    return { subdir: "databases/access", filename: manifestPath.replace("seed/access/", "") };
  }
  if (manifestPath.startsWith("seed/assets/")) {
    return { subdir: "databases/assets", filename: manifestPath.replace("seed/assets/", "") };
  }
  if (manifestPath.startsWith("seed/reports/")) {
    return { subdir: "reports", filename: manifestPath.replace("seed/reports/", "") };
  }
  if (manifestPath.startsWith("seed/conversations/")) {
    // Preserve the per-ticket subfolder: seed/conversations/<ticketId>/<file>
    // → databases/conversations/<ticketId>/<file>.
    const rel = manifestPath.replace("seed/conversations/", "");
    const lastSlash = rel.lastIndexOf("/");
    if (lastSlash < 0) return null;
    return {
      subdir: `databases/conversations/${rel.slice(0, lastSlash)}`,
      filename: rel.slice(lastSlash + 1),
    };
  }
  return null;
}

/// Does the destination file already exist on disk? Used by the
/// per-file seed gate to skip without clobbering. `fsRead` throws
/// (file not found / permission / unreadable) → treat as missing.
async function fileExists(repo: string, subdir: string, filename: string): Promise<boolean> {
  try {
    await fsRead(`${repo}/${subdir}/${filename}`);
    return true;
  } catch {
    return false;
  }
}

/// Run the seed pass. Gate is per-file: every missing sample lands,
/// every existing sample is skipped (no clobber).
export async function seedIfEmpty(args: {
  repo: string;
  onLog?: (msg: string) => void;
}): Promise<{ wrote: number; skipped: number }> {
  const { repo, onLog } = args;
  const manifest = await fetchSkillsManifest(null);

  let wrote = 0;
  let skipped = 0;
  for (const file of manifest.files) {
    const route = seedRoute(file.path);
    if (!route) continue;
    if (await fileExists(repo, route.subdir, route.filename)) {
      skipped += 1;
      continue;
    }
    try {
      const raw = await fetchSkillFile(file.path, null);
      // Bake the resolved interpreter path into the shebang for
      // `filestores/scripts/*` so a fresh install doesn't trip over
      // the macOS GUI-PATH gap (Finder-launched apps lose Homebrew
      // paths, so `/usr/bin/env node` fails to find `node`). All
      // other seed paths pass through untouched.
      const content =
        route.subdir === "filestores/scripts"
          ? await rewriteShebangForSeed(route.filename, raw)
          : raw;
      await invoke("entity_write_file", {
        repo,
        subdir: route.subdir,
        filename: route.filename,
        content,
      });
      wrote += 1;
    } catch (err) {
      console.warn(`[seed] failed to write ${file.path}:`, err);
    }
  }

  onLog?.(`seed: wrote ${wrote} sample file(s), skipped ${skipped} already on disk`);
  return { wrote, skipped };
}
