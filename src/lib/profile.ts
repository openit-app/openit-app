// The admin's profile — identity captured once and reused everywhere.
//
// `profile.md` lives at the vault root and is the single source of truth
// for who the admin is (name/email/role + free-form notes). Both the UI
// (e.g. the Tasks assignee default) and Claude Code read it, so they
// agree without depending on git or any login. See the plugin's
// `instructions/profile.md` for the capture conventions Claude follows.

import { entityWriteFile, fsRead, globalUserName, osFullName } from "./api";

const PROFILE_FILENAME = "profile.md";

/// Parse the `name` field from a profile.md's YAML frontmatter. Returns
/// null when there's no frontmatter or no (non-empty) name.
export function parseProfileName(raw: string): string | null {
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return null;
  const line = fm[1]
    .split("\n")
    .find((l) => l.trim().startsWith("name:"));
  if (!line) return null;
  const value = line
    .replace(/^\s*name:\s*/, "")
    .replace(/^["']|["']$/g, "")
    .trim();
  return value || null;
}

/// Read the admin's name from `<repo>/profile.md`. Returns null when the
/// file is missing or has no name — the signal the first-run capture
/// prompt uses to decide whether to ask.
export async function readProfileName(repo: string): Promise<string | null> {
  try {
    const raw = await fsRead(`${repo}/${PROFILE_FILENAME}`);
    return parseProfileName(raw);
  } catch {
    return null;
  }
}

/// Best-effort suggested name to prefill the capture prompt: the OS
/// account full name first (set for nearly every user), then the git
/// name, then empty. Always an editable suggestion — never adopted
/// silently.
export async function suggestedName(): Promise<string> {
  try {
    const os = await osFullName();
    if (os && os.trim()) return os.trim();
  } catch {
    /* fall through */
  }
  try {
    const git = await globalUserName();
    if (git && git.trim()) return git.trim();
  } catch {
    /* fall through */
  }
  return "";
}

/// YAML-escape a double-quoted scalar (backslash + quote).
function yamlQuote(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/// The seeded body for a brand-new profile, mirroring the shape in the
/// plugin's `instructions/profile.md` so Claude keeps accreting into the
/// same sections over time.
function seedProfile(name: string): string {
  return (
    `---\n` +
    `name: "${yamlQuote(name)}"\n` +
    `---\n\n` +
    `## How they work\n` +
    `- (Claude fills this in over time as you share how you like to work.)\n\n` +
    `## Team\n` +
    `- (Company, size, tools, SSO — captured as you mention them.)\n`
  );
}

/// Set or replace the `name:` field in an EXISTING profile.md without
/// destroying any other frontmatter or body content. Claude may have
/// already accreted notes into `profile.md` (with no `name:` yet), so the
/// first-run capture must merge the name in — never rewrite the file.
/// Handles: frontmatter with a name line (replace), frontmatter without
/// (insert), and no frontmatter at all (prepend a block).
export function upsertName(raw: string, name: string): string {
  const quoted = `name: "${yamlQuote(name)}"`;
  const fm = raw.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
  if (!fm) {
    // No frontmatter — prepend one and keep the existing content as body.
    return `---\n${quoted}\n---\n\n${raw.replace(/^\r?\n/, "")}`;
  }
  const [, open, inner, close] = fm;
  const rest = raw.slice(fm[0].length);
  const lines = inner.split("\n");
  const idx = lines.findIndex((l) => l.trim().startsWith("name:"));
  if (idx >= 0) {
    lines[idx] = quoted;
  } else {
    lines.unshift(quoted);
  }
  return `${open}${lines.join("\n")}${close}${rest}`;
}

/// Persist the admin's name to `<repo>/profile.md`. If the file doesn't
/// exist yet, seed it with the template; if it does (e.g. Claude already
/// wrote notes into it without a name), merge the name into the existing
/// frontmatter instead of overwriting the file.
export async function writeProfileName(repo: string, name: string): Promise<void> {
  const clean = name.trim();
  let existing: string | null = null;
  try {
    existing = await fsRead(`${repo}/${PROFILE_FILENAME}`);
  } catch {
    existing = null;
  }
  const content =
    typeof existing === "string" ? upsertName(existing, clean) : seedProfile(clean);
  // Empty subdir → write at the vault root.
  await entityWriteFile(repo, "", PROFILE_FILENAME, content);
}
