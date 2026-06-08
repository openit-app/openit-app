/// Vault-path resolution for the OpenIT renderer.
///
/// When the user picks a folder in the vault picker, we want predictable,
/// cross-platform behavior:
///   - An empty selection means "use the Rust default" — the caller passes
///     `undefined` to `projectBootstrap`, which resolves to `~/OpenIT/Personal/`.
///   - A folder that already IS an OpenIT vault (its last segment is
///     `OpenIT`, case-insensitive) is opened as-is. We must NOT append
///     another `OpenIT` segment, or the user ends up one level too deep
///     inside their already-synced vault.
///   - Any other folder is treated as the *parent* for a new vault, so we
///     append an `OpenIT` segment using the selection's own separator.
///
/// Path strings here come straight from the OS file dialog, so they carry
/// the host separator — `\` on Windows, `/` on macOS/Linux. We preserve
/// that separator when appending so the resolved path stays native; we
/// only normalize to `/` internally for the comparison. See `paths.ts`
/// for why separator-aware handling matters on Windows.

const VAULT_SEGMENT = "OpenIT";

/// Detect the separator used by a path. Windows dialogs return
/// backslash-separated paths (`C:\Users\me`); everything else uses `/`.
/// Defaults to `/` when the path has no separator at all.
function separatorOf(p: string): "\\" | "/" {
  return p.includes("\\") ? "\\" : "/";
}

/// True when `p`'s final segment is `OpenIT` (case-insensitive), i.e. the
/// selection already points at an OpenIT vault rather than its parent.
function endsWithVaultSegment(p: string): boolean {
  const norm = p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return norm === VAULT_SEGMENT.toLowerCase() || norm.endsWith("/" + VAULT_SEGMENT.toLowerCase());
}

/// Resolve a folder selection from the vault picker into the path to open.
///
/// Returns `undefined` for an empty/blank selection so the caller can pass
/// it straight to `projectBootstrap` and get the Rust default. Otherwise
/// returns either the selection unchanged (already an OpenIT vault) or the
/// selection with an `OpenIT` segment appended (parent folder), preserving
/// the selection's native separator and dropping any trailing separators.
export function resolveVaultPath(selected: string | null | undefined): string | undefined {
  if (!selected || !selected.trim()) return undefined;
  const trimmed = selected.trim();
  if (endsWithVaultSegment(trimmed)) {
    // Already a vault — just strip trailing separators, leave it be.
    return trimmed.replace(/[\\/]+$/, "");
  }
  const sep = separatorOf(trimmed);
  return trimmed.replace(/[\\/]+$/, "") + sep + VAULT_SEGMENT;
}
