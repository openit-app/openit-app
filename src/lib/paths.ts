/// Cross-platform path utilities for the OpenIT renderer.
///
/// File paths returned by the Rust backend use the host OS separator —
/// `\` on Windows, `/` on macOS/Linux. JavaScript string comparisons on
/// those paths must normalize the separator first. The bugs that came
/// from skipping this step on Windows ranged from invisible tile counts
/// to the file explorer rendering everything at depth 0 to folder
/// clicks falling through to the file viewer (which then errored with
/// `ERROR_ACCESS_DENIED`).

/// Replace backslashes with forward slashes. Idempotent on Unix paths.
export function fsNorm(p: string): string {
  return p.replace(/\\/g, "/");
}

/// Forward-slash path of `abs` relative to `repo`, or `null` if `abs`
/// is not under `repo`. Accepts either separator on either side.
/// Returns "" when `abs === repo`.
export function relUnderRepo(repo: string, abs: string): string | null {
  const r = fsNorm(repo);
  const a = fsNorm(abs);
  if (a === r) return "";
  if (a.startsWith(r + "/")) return a.slice(r.length + 1);
  return null;
}

/// True when `abs` is the repo itself or a descendant of it.
export function isUnderRepo(repo: string, abs: string): boolean {
  return relUnderRepo(repo, abs) !== null;
}
