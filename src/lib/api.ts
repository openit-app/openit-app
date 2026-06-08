import { invoke } from "@tauri-apps/api/core";

export type FileNode = { name: string; path: string; is_dir: boolean };

export async function fsList(root: string): Promise<FileNode[]> {
  return invoke("fs_list", { root });
}

export async function fsRead(path: string): Promise<string> {
  return invoke("fs_read", { path });
}

export async function fsReadBytes(path: string): Promise<Uint8Array> {
  const arr = (await invoke<number[]>("fs_read_bytes", { path }));
  return new Uint8Array(arr);
}

export async function fsReveal(path: string): Promise<void> {
  return invoke("fs_reveal", { path });
}

export async function fsDelete(path: string): Promise<void> {
  return invoke("fs_delete", { path });
}

/// User's global git email — used as a best-guess admin identity for
/// in-app writes (conversation reply, etc.). Returns null when git's
/// user.email is unset, blank, or the project-local placeholder.
export async function globalUserEmail(): Promise<string | null> {
  return invoke<string | null>("global_user_email");
}

/// User's global git name — used as the default assignee in the tasks
/// composer. Returns null when git's user.name is unset, blank, or the
/// project-local placeholder ("OpenIT"). Callers fall back to "me".
export async function globalUserName(): Promise<string | null> {
  return invoke<string | null>("global_user_name");
}

/// OS account full ("real") name (e.g. macOS `id -F`). Used as an
/// editable suggestion in the first-run profile prompt — a far better
/// default than git config for non-developers. Returns null when
/// unavailable (non-macOS, or no full name set).
export async function osFullName(): Promise<string | null> {
  return invoke<string | null>("os_full_name");
}

/// Generic binary write to `<repo>/<subdir>/<filename>`. Used by the
/// admin reply composer to land attachment bytes into
/// `filestores/attachments/<ticketId>/`. Mirrors `entityWriteFile`
/// but takes `ArrayBuffer | Uint8Array` for the payload.
export async function entityWriteFileBytes(
  repo: string,
  subdir: string,
  filename: string,
  bytes: ArrayBuffer | Uint8Array,
): Promise<void> {
  const arr = bytes instanceof Uint8Array ? Array.from(bytes) : Array.from(new Uint8Array(bytes));
  return invoke("entity_write_file_bytes", { repo, subdir, filename, bytes: arr });
}

/// Open `path` with the OS default application (Finder/Preview/etc.
/// on macOS, `start` on Windows, `xdg-open` on Linux). Used by the
/// attachment chips in the conversation viewer.
export async function fsOpen(path: string): Promise<void> {
  return invoke("fs_open", { path });
}

export type AppPersistedState = {
  last_repo: string | null;
  pane_sizes: number[] | null;
  pinned_bubbles: string[] | null;
  onboarding_complete: boolean;
  /// Whether the left sidebar is collapsed to an icon-only rail.
  /// `null` = first launch (default expanded). Once the user toggles,
  /// the choice is persisted so it survives app restarts.
  sidebar_collapsed: boolean | null;
};

export async function stateLoad(): Promise<AppPersistedState> {
  return invoke("state_load");
}

export async function stateSave(state: AppPersistedState): Promise<void> {
  return invoke("state_save", { state });
}


export async function claudeDetect(): Promise<string | null> {
  return invoke("claude_detect");
}

/// Run the official Claude Code installer
/// (`curl -fsSL https://claude.ai/install.sh | bash`) and return the resolved
/// binary path. Throws on installer failure. Idempotent: returns the existing
/// path if `claude` is already on PATH or in a known install dir.
///
/// Concurrent callers share a single in-flight install promise — re-mounts of
/// the onboarding view (or any other caller) won't kick off a parallel
/// `curl | bash`. Cleared once the promise settles so a Retry click after
/// failure can run a fresh attempt.
let claudeInstallInflight: Promise<string> | null = null;
export function claudeInstall(): Promise<string> {
  if (claudeInstallInflight) return claudeInstallInflight;
  const p = invoke<string>("claude_install").finally(() => {
    if (claudeInstallInflight === p) claudeInstallInflight = null;
  });
  claudeInstallInflight = p;
  return p;
}


/// Force the app window to the foreground. On macOS uses
/// NSApplication.activate; also bounces the dock icon once.
export function windowFocus(): Promise<void> {
  return invoke("window_focus");
}

export type BootstrapResult = { path: string; created: boolean };

/// Bootstrap a vault at the given path. Creates standard subdirs,
/// getting-started.html, and .openit/config.json if missing. Defaults
/// to `~/OpenIT/Personal/` when path is omitted.
export async function projectBootstrap(vaultPath?: string): Promise<BootstrapResult> {
  return invoke("project_bootstrap", { vaultPath: vaultPath ?? null });
}

// ---------------------------------------------------------------------------
// Workspace registry — tracks which vaults the user has opened.
// ---------------------------------------------------------------------------

export type WorkspaceEntry = {
  path: string;
  name: string;
  lastOpenedAt: number;
};

export type WorkspaceRegistry = {
  workspaces: WorkspaceEntry[];
  active: string | null;
};

export async function listWorkspaces(): Promise<WorkspaceRegistry> {
  return invoke("list_workspaces");
}

export async function createWorkspace(path: string, name: string): Promise<WorkspaceRegistry> {
  return invoke("create_workspace", { path, name });
}


// ---------------------------------------------------------------------------
// MCP discovery
// ---------------------------------------------------------------------------

export type InstalledMcp = {
  name: string;
  source: string; // "claude-code" | "claude-desktop" | "project"
  transport: string; // "stdio" | "http" | "sse"
  command_or_url: string;
};

export async function listInstalledMcps(repo?: string): Promise<InstalledMcp[]> {
  return invoke("list_installed_mcps", { repo: repo ?? null });
}

export type KbLocalFile = { filename: string; mtime_ms: number | null; size: number };
export type KbFileState = {
  remote_version: string;
  pulled_at_mtime_ms: number;
  /// Present iff the row is in conflict state. Records the remote
  /// `updatedAt` at conflict-write time so the resolve script can
  /// signal "user has reconciled against this remote version" without
  /// re-fetching.
  conflict_remote_version?: string;
  /// Legacy (PIN-5827) — pre-PIN-5847 the multipart `/upload` endpoint
  /// returned UUID-prefixed filenames; this field bridged remote→local
  /// naming. PIN-5847 switched to `/upload-request` which returns the
  /// verbatim filename, so this field is no longer set or read. Kept on
  /// the type only so legacy on-disk manifests deserialize without
  /// errors — drops out the next time a manifest is rewritten.
  cloud_filename?: string;
  /// Agents only. Set when a release POST fails after a successful
  /// upsert; cleared on retry success. Persists across restarts so the
  /// next sync tick retries even when nothing else under `agents/` is
  /// dirty. (Agent V2.)
  release_pending?: boolean;
  /// Agents only. SHA-256 of the assembled `common + cloud` instructions
  /// we last sent to the platform. Compared on pull to detect cloud-side
  /// edits — never recomputed from disk, otherwise local edits would
  /// retroactively look like "what we last pushed" and divergence
  /// detection breaks. (Agent V2.)
  pushed_instructions_hash?: string;
  /// Agents only. The platform's user-agent id. Today this lives inside
  /// the agent JSON's `id` field; for retry-only flows (release-pending
  /// retry without re-reading the disk file) we need it accessible at
  /// the manifest layer. (Agent V2.)
  remote_id?: string;
};
export type KbStatePersisted = {
  collection_id: string | null;
  collection_name: string | null;
  files: Record<string, KbFileState>;
  /// Set by the engine after every successful pull pipeline pass — even
  /// when zero items came back. Used by `pushAllEntities` skip-clean
  /// preflight as the "we've talked to remote at least once for this
  /// collection" sentinel. Without it, a brand-new empty collection
  /// (e.g. `openit-attachments` on a project with no ticket
  /// attachments yet) keeps failing skip-clean forever because
  /// `Object.keys(files).length` stays 0 — pulling on every click for
  /// no benefit. Optional on the type for backwards-compat with
  /// pre-PIN-5865 manifests on disk.
  last_pull_at_ms?: number | null;
};


export async function kbDeleteFile(repo: string, filename: string): Promise<void> {
  return invoke("kb_delete_file", { repo, filename });
}


export async function kbWriteFileBytes(
  repo: string,
  filename: string,
  bytes: ArrayBuffer | Uint8Array,
): Promise<void> {
  const arr = bytes instanceof Uint8Array ? Array.from(bytes) : Array.from(new Uint8Array(bytes));
  return invoke("kb_write_file_bytes", { repo, filename, bytes: arr });
}

export async function kbStateLoad(repo: string): Promise<KbStatePersisted> {
  return invoke("entity_state_load", { repo, name: "kb" });
}

export async function kbStateSave(
  repo: string,
  state: KbStatePersisted,
): Promise<void> {
  return invoke("entity_state_save", { repo, name: "kb", state });
}

// ---------------------------------------------------------------------------
// Filestore local commands (mirrors kb_* but for filestore/ directory)
// ---------------------------------------------------------------------------

/// Generic entity_list_local wrapper. Pass the subdir relative to repo
/// (e.g. "filestores/library", "filestores/docs-123", "knowledge").
/// Returns local files in that directory only.
export async function entityListLocal(
  repo: string,
  subdir: string,
): Promise<KbLocalFile[]> {
  return invoke("entity_list_local", { repo, subdir });
}


export async function fsStoreWriteFileBytes(
  repo: string,
  filename: string,
  bytes: ArrayBuffer | Uint8Array,
  subdir?: string,
): Promise<void> {
  const arr = bytes instanceof Uint8Array ? Array.from(bytes) : Array.from(new Uint8Array(bytes));
  return invoke("fs_store_write_file_bytes", { repo, filename, bytes: arr, subdir: subdir ?? null });
}

export async function fsStoreStateLoad(repo: string): Promise<KbStatePersisted> {
  return invoke("entity_state_load", { repo, name: "fs" });
}

export async function fsStoreStateSave(
  repo: string,
  state: KbStatePersisted,
): Promise<void> {
  return invoke("entity_state_save", { repo, name: "fs", state });
}


export async function entityWriteFile(repo: string, subdir: string, filename: string, content: string): Promise<void> {
  return invoke("entity_write_file", { repo, subdir, filename, content });
}

export async function entityDeleteFile(repo: string, subdir: string, filename: string): Promise<void> {
  return invoke("entity_delete_file", { repo, subdir, filename });
}

export async function entityRemoveDir(repo: string, subdir: string): Promise<void> {
  return invoke("entity_remove_dir", { repo, subdir });
}

/// Rename a file within a subdir. Used to reconcile when the filestore
/// server sanitizes a filename on upload (e.g. spaces → dashes) so the
/// local working tree matches the canonical name and the next pull
/// doesn't create a duplicate.
export async function entityRenameFile(
  repo: string,
  subdir: string,
  from: string,
  to: string,
): Promise<void> {
  return invoke("entity_rename_file", { repo, subdir, from, to });
}


/// Run the local helpdesk-overview script
/// (`.claude/scripts/report-overview.mjs`) in the given repo and
/// return the repo-relative path to the markdown file it wrote, e.g.
/// `reports/2026-04-27-1432-overview.md`. Rejects on failure.
export async function reportOverviewRun(repo: string): Promise<string> {
  return invoke("report_overview_run", { repo });
}

/// Run an arbitrary `.mjs` script in the repo with `node` and return
/// the captured stdout/stderr/exitCode. The Rust side rejects scripts
/// that resolve outside the repo root (canonicalize + starts_with),
/// so a bad UI path or crafted arg can't escape into system binaries.
/// Powers the "Run" button on each filestores/scripts/ card.
export interface ScriptRunOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

export async function scriptRun(
  repo: string,
  scriptPath: string,
): Promise<ScriptRunOutput> {
  return invoke("script_run", { repo, scriptPath });
}

/// Resolve the absolute filesystem path to an interpreter binary
/// (`node`, `python3`, ...) so seed-time can bake the result into a
/// script's shebang line. Returns `null` when the interpreter isn't
/// installed on this machine — callers should leave the script's
/// `#!/usr/bin/env <interpreter>` line untouched in that case.
///
/// Why this exists: macOS GUI apps launched from Finder / Dock
/// inherit a restricted PATH that excludes Homebrew (`/opt/homebrew/bin`
/// on Apple Silicon, `/usr/local/bin` on Intel). The OS-level spawn
/// in `script_run` then fails with `os error 2`. Resolving here and
/// rewriting the shebang sidesteps the PATH problem entirely.
export async function scriptResolveInterpreter(
  interpreter: string,
): Promise<string | null> {
  return invoke("script_resolve_interpreter", { interpreter });
}

// ---------------------------------------------------------------------------
// Secure local credentials (PIN-7009)
//
// Vault-safe secret store: values live in the OS secure store (macOS
// Keychain / Windows Credential Manager / libsecret on Linux) via the
// Rust `keyring` crate; only the non-secret *names* are listed here.
// Scripts and Claude commands reference a credential by its env-var name
// (`process.env.MY_SECRET`) and the Rust runtime injects the value into
// the child process — secrets never touch the vault or sync to the cloud.
// ---------------------------------------------------------------------------

/// Env-var-style credential name pattern, mirrored from the Rust
/// validator (`^[A-Z_][A-Z0-9_]*$`). Exported so the UI can validate
/// before round-tripping to the backend and give immediate feedback.
export const CREDENTIAL_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

/// Reserved environment-variable names a credential may NOT use. Values are
/// injected into spawned child processes *after* PATH (and friends) are set
/// up, using an env override — so a credential named PATH / HOME /
/// NODE_OPTIONS / etc. would hijack the spawned environment and break Claude
/// Code or script spawning. Mirror of `RESERVED_CREDENTIAL_NAMES` in
/// `src-tauri/src/credentials.rs` — keep the two lists in lockstep.
export const RESERVED_CREDENTIAL_NAMES: readonly string[] = [
  // POSIX / shell
  "PATH",
  "HOME",
  "PWD",
  "OLDPWD",
  "SHELL",
  "USER",
  "LOGNAME",
  "TMPDIR",
  "TEMP",
  "TMP",
  "HOSTNAME",
  "LANG",
  "LC_ALL",
  "TERM",
  "DISPLAY",
  "IFS",
  "ENV",
  "BASH_ENV",
  "PROMPT_COMMAND",
  "PS1",
  "PS2",
  // dynamic-loader / runtime injection
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
  "NODE_OPTIONS",
  "PYTHONPATH",
  // Windows
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "PATHEXT",
  "HOMEDRIVE",
  "HOMEPATH",
];

/// Whether `name` collides with a reserved environment variable (see
/// `RESERVED_CREDENTIAL_NAMES`). Case-insensitive; valid names are already
/// uppercase so this is an exact match in practice.
export function isReservedCredentialName(name: string): boolean {
  return RESERVED_CREDENTIAL_NAMES.includes(name.toUpperCase());
}

/// Whether `name` is a valid credential / env-var name. Conservative on
/// purpose: uppercase + digits + underscore, not starting with a digit, and
/// not a reserved environment variable that would hijack the spawned env.
export function isValidCredentialName(name: string): boolean {
  return CREDENTIAL_NAME_PATTERN.test(name) && !isReservedCredentialName(name);
}

/// List saved credential names. Never returns values.
export async function credentialsList(): Promise<string[]> {
  return invoke("credentials_list");
}

/// Save (create or overwrite) a credential. The value is written to the
/// OS secure store; only the name is indexed locally. Rejects invalid
/// names and empty values (Rust enforces both).
export async function credentialsSet(name: string, value: string): Promise<void> {
  return invoke("credentials_set", { name, value });
}

/// Delete a credential from the OS secure store and the local index.
/// Idempotent — deleting a missing credential resolves cleanly.
export async function credentialsDelete(name: string): Promise<void> {
  return invoke("credentials_delete", { name });
}

import type { TraceDoc } from "../shell/viewerTypes";

/// Latest persisted agent-trace doc for a ticket, or null if none yet.
/// Backed by `traces/<ticketId>/<startedAt>.json` —
/// filenames are ISO timestamps so the lex-max sort = most recent.
export async function agentTraceLatest(
  repo: string,
  ticketId: string,
): Promise<TraceDoc | null> {
  return invoke("agent_trace_latest", { repo, ticketId });
}

