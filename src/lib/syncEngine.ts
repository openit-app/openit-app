// Sync engine utilities: conflict tracking and prompt builder.
//
// In local-only mode the conflict infrastructure is inert (nothing populates
// conflictsByPrefix). It's retained because the cloud sync pipeline — which
// does populate it — will be re-enabled when users connect to Pinkfish.
// ConflictBanner and subscribeConflicts safely no-op when the map is empty.

export type Conflict = {
  manifestKey: string;
  /// Repo-relative path the user can open. Filled in by the engine
  /// from the matching RemoteItem.workingTreePath.
  workingTreePath: string;
  reason: "local-and-remote-changed";
};

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

// ---------------------------------------------------------------------------
// Shadow-filename helper (used only by buildConflictPrompt)
// ---------------------------------------------------------------------------

function shadowFilename(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot === filename.length - 1) return `${filename}.server`;
  return `${filename.slice(0, dot)}.server.${filename.slice(dot + 1)}`;
}

function shadowPath(workingTreePath: string): string {
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
