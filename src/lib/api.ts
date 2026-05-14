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
};

export async function stateLoad(): Promise<AppPersistedState> {
  return invoke("state_load");
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

// ---------------------------------------------------------------------------
// Intake server
// ---------------------------------------------------------------------------

/// Start the localhost ticket-intake HTTP server scoped to `repo`.
/// Returns the URL clients hit (e.g. `http://127.0.0.1:54123`). If a
/// server is already running, it's stopped first so calling this on
/// project switch transparently moves the server to the new repo.
///
/// Note: `intake_stop` and `intake_url` Tauri commands are still
/// registered on the Rust side for future use (Phase 3b settings,
/// programmatic stop), but no JS caller uses them yet — wrappers
/// will be added when there's a real consumer.
export async function intakeStart(repo: string): Promise<string> {
  return invoke("intake_start", { repo });
}

/// Open a public HTTPS tunnel (via localhost.run, no signup) pointing
/// at the local intake server. Returns the public URL (e.g.
/// `https://abc123.lhr.life`). Pair with `intakeStart`: after the
/// local server is up, hand its URL to this command. Tunnel dies
/// when the SSH session ends — laptop sleep, app close, network
/// loss. That ephemerality is intentional; it's the upgrade-to-cloud
/// pitch.

// ---------------------------------------------------------------------------
// Slack — local listener supervisor (V1: DM-only, runs while OpenIT is open).
// ---------------------------------------------------------------------------

export type SlackConfig = {
  workspace_id: string;
  workspace_name: string;
  bot_user_id: string;
  bot_name: string;
  connected_at: string;
  allowed_domains: string[];
};

export type SlackConnectMeta = {
  workspace_id: string;
  workspace_name: string;
  bot_user_id: string;
  bot_name: string;
  connected_at: string;
};

export type SlackHeartbeat = {
  ts: string;
  sessions: number;
  open_tickets: number;
  queue_depth: number;
  workers: number;
};

export type SlackStatus = {
  running: boolean;
  workspace_id: string | null;
  workspace_name: string | null;
  bot_user_id: string | null;
  bot_name: string | null;
  last_heartbeat: SlackHeartbeat | null;
  last_error: string | null;
};

export async function slackConnect(args: {
  repo: string;
  botToken: string;
  appToken: string;
  orgId: string;
}): Promise<SlackConnectMeta> {
  return invoke("slack_connect", {
    repo: args.repo,
    botToken: args.botToken,
    appToken: args.appToken,
    orgId: args.orgId,
  });
}

/// Validate a bot token against Slack without storing anything.
/// Used by the canvas's paste-as-you-go flow so the user gets
/// feedback as soon as they paste the xoxb- token, before they
/// move on to generate the app-level token.
export async function slackValidateBotToken(
  botToken: string,
): Promise<SlackConnectMeta> {
  return invoke("slack_validate_bot_token", { botToken });
}


export async function slackConfigRead(repo: string): Promise<SlackConfig | null> {
  return invoke("slack_config_read", { repo });
}

export async function slackListenerStart(args: {
  repo: string;
  intakeUrl: string;
  orgId: string;
}): Promise<void> {
  return invoke("slack_listener_start", {
    repo: args.repo,
    intakeUrl: args.intakeUrl,
    orgId: args.orgId,
  });
}

export async function slackListenerStop(): Promise<void> {
  return invoke("slack_listener_stop");
}

export async function slackListenerStatus(): Promise<SlackStatus> {
  return invoke("slack_listener_status");
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

