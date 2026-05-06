// Local-only sync engine utilities: locks, conflict tracking, shadow helpers,
// and the auto-commit helper. Cloud pull/push pipeline and collection sync
// have been removed — entity sync files and their adapters are deleted.

import { gitCommitPaths, type KbStatePersisted } from "./api";

export type Manifest = KbStatePersisted;

/// Thrown by push adapters when the server reports a version conflict
/// (PATCH 409 today; future entities can map other "you're behind"
/// signals to the same class). Cross-cutting so any push wrapper can
/// catch it without each entity defining its own.
export class OutOfSync extends Error {
  constructor(public readonly serverHint?: string) {
    super(serverHint ? `out of sync: ${serverHint}` : "out of sync");
    this.name = "OutOfSync";
  }
}

/// Sentinel `pulled_at_mtime_ms` value the resolve script writes when
/// flipping a row into "force-push" state after a user-resolved
/// conflict. Any real local mtime exceeds it, so the engine's
/// `localChanged = mtime > pulled_at_mtime_ms` test is guaranteed to
/// fire. Mirrored in `scripts/openit-plugin/sync-resolve-conflict.mjs`
/// — keep the two values in sync.
export const FORCE_PUSH_MTIME_SENTINEL = 1;

// ---------------------------------------------------------------------------
// Shared shadow-filename helpers. Single source of truth for the
// `<base>.server.<ext>` convention used by every text/binary entity.
// Datastore uses a fixed `.json` extension so it doesn't call these
// directly — but it uses the same classifyAsShadow check.
// ---------------------------------------------------------------------------

const SHADOW_MARKER = ".server.";

/// `runbook.md` → `runbook.server.md`. Returned filename keeps the
/// extension so downstream tooling (mime detection, viewers, etc.) still
/// recognises the format.
export function shadowFilename(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot === filename.length - 1) return `${filename}.server`;
  return `${filename.slice(0, dot)}.server.${filename.slice(dot + 1)}`;
}

/// `runbook.server.md` → `runbook.md`. Inverse of shadowFilename.
export function canonicalFromShadow(filename: string): string {
  const i = filename.indexOf(SHADOW_MARKER);
  if (i < 0) return filename;
  return `${filename.slice(0, i)}.${filename.slice(i + SHADOW_MARKER.length)}`;
}

/// Necessary-but-not-sufficient: filename literally contains the shadow
/// marker. Use `classifyAsShadow` for the authoritative check that also
/// verifies a canonical sibling exists.
export function looksLikeShadow(filename: string): boolean {
  return filename.includes(SHADOW_MARKER);
}

/// Authoritative shadow classification. A file is a shadow IFF its
/// filename matches the `<base>.server.<ext>` pattern AND its canonical
/// sibling (`<base>.<ext>`) is also present in `siblingNames`.
///
/// `siblingNames` should contain the FULL set of local filenames in the
/// scope being checked — do NOT pre-filter shadow-shaped names out.
/// A legitimate `a.server.conf` (no `a.conf` sibling) returns false; a
/// `b.server.conf` with a `b.conf` sibling returns true. Pre-filtering
/// would cause a follow-on conflict shadow `a.server.server.conf` to
/// go undetected because its canonical-form (`a.server.conf`) was
/// excluded from the sibling set.
export function classifyAsShadow(
  filename: string,
  siblingNames: Set<string>,
): boolean {
  if (!looksLikeShadow(filename)) return false;
  return siblingNames.has(canonicalFromShadow(filename));
}

/// Sort-key recursive serializer. Two semantically-equal JSON values
/// produce the same string regardless of key order in the source.
/// Falls through arrays/primitives unchanged; only object key ordering
/// is normalized.
function canonicalJsonString(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJsonString).join(",")}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys.map((k) => {
    const v = (value as Record<string, unknown>)[k];
    return `${JSON.stringify(k)}:${canonicalJsonString(v)}`;
  });
  return `{${parts.join(",")}}`;
}

/// Equivalence check for the bootstrap-adoption content compare.
/// A naive byte compare false-positives on harmless drift: trailing
/// newline from an editor save, CRLF vs LF on Windows, key order
/// differences from a different stringify path. We try a JSON-aware
/// canonical compare first (handles all three for datastore rows,
/// which are the only adapters using inlineContent today). If either
/// side isn't valid JSON, we fall back to a whitespace-trimmed string
/// compare, which still neutralises the trailing-newline + CRLF cases.
export function contentsEquivalent(a: string, b: string): boolean {
  if (a === b) return true;
  try {
    const aJ = JSON.parse(a);
    const bJ = JSON.parse(b);
    return canonicalJsonString(aJ) === canonicalJsonString(bJ);
  } catch {
    return a.replace(/\r\n/g, "\n").trimEnd() === b.replace(/\r\n/g, "\n").trimEnd();
  }
}

export type Conflict = {
  manifestKey: string;
  /// Repo-relative path the user can open. Filled in by the engine
  /// from the matching RemoteItem.workingTreePath.
  workingTreePath: string;
  reason: "local-and-remote-changed";
};

// ---------------------------------------------------------------------------
// Per-repo+entity serializer. Pull, push, and bootstrap-write all serialize
// on this lock so manifest mutations can never race. KB historically used a
// module-level Promise queue; we mirror that semantics per (repo, prefix)
// since two different entities (e.g. KB pull + datastore pull) don't need
// to wait for each other, but two operations on the same entity must.
// ---------------------------------------------------------------------------

const repoLocks = new Map<string, Promise<unknown>>();

function lockKey(repo: string, prefix: string): string {
  return `${prefix}:${repo}`;
}

export function withRepoLock<T>(
  repo: string,
  prefix: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = lockKey(repo, prefix);
  const previous = repoLocks.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(fn);
  repoLocks.set(key, next.catch(() => undefined));
  return next;
}

// ---------------------------------------------------------------------------
// Conflict aggregate. Every successful pull call replaces this adapter's
// contribution to the aggregate; subscribers see the union across all
// entities.
// ---------------------------------------------------------------------------

export type AggregatedConflict = {
  prefix: string;
  manifestKey: string;
  workingTreePath: string;
  reason: "local-and-remote-changed";
};

const conflictsByPrefix = new Map<string, AggregatedConflict[]>();
const conflictSubscribers = new Set<(c: AggregatedConflict[]) => void>();

function snapshotConflicts(): AggregatedConflict[] {
  const out: AggregatedConflict[] = [];
  for (const list of conflictsByPrefix.values()) out.push(...list);
  return out;
}

function emitConflicts() {
  const snapshot = snapshotConflicts();
  for (const fn of conflictSubscribers) {
    try {
      fn(snapshot);
    } catch (e) {
      console.error("[syncEngine] conflict subscriber threw:", e);
    }
  }
}

export function subscribeConflicts(
  fn: (c: AggregatedConflict[]) => void,
): () => void {
  conflictSubscribers.add(fn);
  // Emit current state immediately so the UI doesn't have to wait for
  // the next pull tick to render the existing banner.
  fn(snapshotConflicts());
  return () => {
    conflictSubscribers.delete(fn);
  };
}

/// Drop a single entity's conflict contribution. Wrappers call this from
/// their stop functions so a stale entry can't outlive its sync.
export function clearConflictsForPrefix(prefix: string): void {
  if (conflictsByPrefix.delete(prefix)) emitConflicts();
}

/// True if at least one aggregated conflict exists for this prefix.
export function hasConflictsForPrefix(prefix: string): boolean {
  const list = conflictsByPrefix.get(prefix);
  return list != null && list.length > 0;
}

/// Snapshot of conflicts for a single prefix. Same prefix-granularity
/// rules as `hasConflictsForPrefix`.
export function getConflictsForPrefix(prefix: string): AggregatedConflict[] {
  const list = conflictsByPrefix.get(prefix);
  return list != null ? [...list] : [];
}

/// Compute the on-disk shadow path for a conflict's canonical
/// workingTreePath. e.g. `databases/openit-people-XXX/p123.json`
/// → `databases/openit-people-XXX/p123.server.json`. Used by the
/// "Resolve in Claude" prompt builder so it can point Claude at both
/// sides of every conflict.
export function shadowPath(workingTreePath: string): string {
  const slash = workingTreePath.lastIndexOf("/");
  const dir = slash >= 0 ? workingTreePath.slice(0, slash + 1) : "";
  const filename = slash >= 0 ? workingTreePath.slice(slash + 1) : workingTreePath;
  return `${dir}${shadowFilename(filename)}`;
}

/// Compose a Claude-ready prompt that walks an LLM through every active
/// conflict and instructs it to merge each, delete shadows, and push
/// back. Generic across all entities — per-entity hints embedded in the
/// prompt body so Claude knows to preserve schema for datastore rows,
/// leave workflow `releaseVersion` alone, etc.
///
/// Returns null when there are no conflicts (caller should hide the
/// "Resolve in Claude" button).
export function buildConflictPrompt(
  conflicts: AggregatedConflict[],
): string | null {
  if (conflicts.length === 0) return null;

  const lines: string[] = [];
  lines.push(
    `There ${conflicts.length === 1 ? "is" : "are"} ${conflicts.length} sync conflict${conflicts.length === 1 ? "" : "s"} between local edits and remote changes. For each, both sides changed since the last sync, so the engine wrote a \`.server.\` shadow file (containing the remote's version) next to my local canonical.`,
  );
  lines.push("");
  lines.push(
    "**For each conflict below, perform ALL FOUR actions as one atomic unit.** Skipping the final script call leaves the banner stuck — the engine doesn't know the merge happened until the script runs. Do not stop after deleting the shadow.",
  );
  lines.push("");
  lines.push("### Conflicts to resolve");

  for (const c of conflicts) {
    const sh = shadowPath(c.workingTreePath);
    lines.push("");
    lines.push(`#### \`${c.workingTreePath}\``);
    lines.push("");
    lines.push(
      `1. Read \`${c.workingTreePath}\` (mine) and \`${sh}\` (the remote's) and merge them. Preserve both sides' changes wherever they touch different keys/lines.`,
    );
    lines.push(
      `2. Write the merged result to \`${c.workingTreePath}\`.`,
    );
    lines.push(
      `3. Delete \`${sh}\` (e.g. \`rm "${sh}"\`).`,
    );
    lines.push(
      "4. **Run the resolve-script — REQUIRED, banner won't clear without it:**",
    );
    lines.push("");
    lines.push("   ```bash");
    lines.push(
      `   node .claude/scripts/sync-resolve-conflict.mjs --prefix ${c.prefix} --key '${c.manifestKey}'`,
    );
    lines.push("   ```");
  }

  lines.push("");
  lines.push("### Merge guidance");
  lines.push(
    "**Default to auto-merging — do not interrogate me field-by-field.** Make the smart call yourself and proceed. The bar for stopping to ask is high (see below).",
  );
  lines.push("");
  lines.push(
    "- **JSON (datastore rows, agents, workflows):** walk the keys and decide silently.",
  );
  lines.push(
    "  - Key only on one side, or both sides match → trivial, take the value.",
  );
  lines.push(
    "  - Both sides changed the same key to different values → infer intent from context: edits I just made in this session win on those keys; the other side wins on keys it touched. Recency cues and obvious-correction heuristics (typo fix, more-complete data) are fair game.",
  );
  lines.push(
    "  - Only stop and ask if a specific key is genuinely ambiguous (no contextual cue, both values equally plausible). Even then, ask about *that one key*, not the whole row.",
  );
  lines.push(
    "- **Text/markdown (KB):** keep meaningful additions from both sides.",
  );
  lines.push(
    "- **Binary (PDFs/images in filestore):** can't merge bytes — ask me which version to keep before doing anything.",
  );
  lines.push(
    "- **Datastore `_schema.json` is read-only** — never touch it.",
  );
  lines.push(
    "- **Workflows:** only merge draft fields. Never modify `releaseVersion` or anything release-related.",
  );
  lines.push("");
  lines.push("### What to say back to me");
  lines.push(
    "**Do not surface raw field values** in your reply — they may be sensitive (PII, emails, phone numbers, secrets). After merging, summarise at the row/file level only:",
  );
  lines.push(
    "- ✅ Good: \"Merged `databases/openit-people-.../row-123.json` — kept your local change to one field, took the remote change to two others.\"",
  );
  lines.push(
    "- ❌ Avoid: tables or sentences that quote the actual before/after values.",
  );
  lines.push(
    "If a field is truly ambiguous and you must ask, refer to the **field name only** (e.g. \"`f_2` differs on both sides — which should win?\") — never paste the values.",
  );
  lines.push("");
  lines.push("### After all conflicts are resolved — confirm and sync");
  lines.push(
    "Once the merge + shadow delete + resolve-script have run for every conflict above, ask me one question:",
  );
  lines.push("");
  lines.push("> Sync these changes now? (yes/no)");
  lines.push("");
  lines.push(
    "If I say yes, run the push script. The banner clears the moment the script writes its request marker, and OpenIT runs the actual push:",
  );
  lines.push("");
  lines.push("```bash");
  lines.push("node .claude/scripts/sync-push.mjs");
  lines.push("```");
  lines.push("");
  lines.push(
    "If I say no, leave it for me to push manually via the Sync tab.",
  );

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Auto-commit helper. Centralises the gitignore-safe pathspec rule: the
// engine NEVER passes `*.server.*` paths to git_commit_paths because git
// rejects gitignored paths and would drop the whole batch. Adapters add
// only canonical paths to `touched`; engine just commits.
// ---------------------------------------------------------------------------

export async function commitTouched(
  repo: string,
  touched: string[],
  message: string,
): Promise<void> {
  if (touched.length === 0) return;
  // Serialize commits across all entity prefixes through a dedicated
  // `(repo, "git")` queue. Per-prefix locks already prevent two ops
  // on the same entity from racing, but they don't prevent kb-push and
  // filestore-pull from hitting `gitCommitPaths` concurrently — which
  // races on `.git/index.lock`.
  await withRepoLock(repo, "git", async () => {
    try {
      await gitCommitPaths(repo, touched, message);
    } catch (e) {
      console.warn(`[syncEngine] commit failed (${message}):`, e);
    }
  });
}
