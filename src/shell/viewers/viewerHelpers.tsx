/// Shared helper functions and constants used across all sub-viewers.
/// Extracted from the original Viewer.tsx during the open-source-ready
/// refactoring; no logic changes — purely structural.

import { ask } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { entityWriteFileBytes, entityDeleteFile, entityListLocal } from "../../lib/api";
import { writeToActiveSession } from "../activeSession";
import { relUnderRepo } from "../../lib/paths";

/// Pasting a slash command into the active Claude PTY uses bracketed-
/// paste sequences so the terminal treats it as a single atomic input,
/// not as the user typing key-by-key.
export const BRACKETED_PASTE_OPEN = "\x1b[200~";
export const BRACKETED_PASTE_CLOSE = "\x1b[201~";

/// Title labels for the entity-folder view. Capital case for the title
/// bar; the explorer rows use the lowercase folder names directly.
export const ENTITY_FOLDER_LABELS: Record<
  | "knowledge"
  | "knowledge-base"
  | "library"
  | "reports"
  | "skills"
  | "scripts",
  string
> = {
  knowledge: "Knowledge",
  "knowledge-base": "Knowledge",
  library: "Library",
  reports: "Reports",
  skills: "Skills",
  scripts: "Scripts",
};

/// Friendly empty-state copy per top-level entity folder. Each message
/// says what lives here, why it is empty, and the natural way to
/// populate it.
export const ENTITY_FOLDER_EMPTY_COPY: Record<
  | "knowledge"
  | "knowledge-base"
  | "library"
  | "reports"
  | "skills"
  | "scripts",
  string
> = {
  knowledge:
    "No articles yet. This is your knowledge base. Drop in markdown files, or ask Claude to write one.",
  "knowledge-base":
    "No articles yet. This is your knowledge base. Drop in markdown files, or ask Claude to write one.",
  library:
    "No library files yet. Drop runbook PDFs, scripts, or any reference doc you reach for repeatedly — Claude can pull from these.",
  reports:
    "No reports yet. Click \"generate overview\" above for an instant snapshot, or click \"ask for custom report\" to describe one.",
  skills:
    "No skills yet. Skills capture admin workflows — markdown prompts Claude (or you) read and follow. Ask Claude to draft one directly.",
  scripts:
    "No scripts yet. Scripts capture deterministic admin workflows — runnable code (Node / shell / Python) that always does the same thing for the same inputs. Ask Claude to draft one directly.",
};

/// Hello-world starter content for the "New" button on the scripts /
/// skills folder views. The .mjs template exports a default async
/// function (the shape every plugin-script entry point uses); the .md
/// template seeds a frontmatter-less skill stub the user can fill in.
export const NEW_FILE_TEMPLATES: Record<"mjs" | "md", string> = {
  // Default-export AND top-level invocation so the same file works
  // both ways — `import helloWorld from './untitled.mjs'` for reuse
  // elsewhere, AND `node untitled.mjs` (the in-app Run button) prints
  // "Hello, world!" without the user having to add a call site.
  mjs:
    `export default async function helloWorld() {\n` +
    `  console.log("Hello, world!");\n` +
    `}\n` +
    `\n` +
    `await helloWorld();\n`,
  md: `When you invoke this skill, say "Hello World"\n`,
};

export type ViewMode = "rendered" | "raw" | "table" | "edit";

export function isMarkdown(path: string): boolean {
  return /\.(md|mdx|markdown)$/i.test(path);
}

/// Plain JSON files reaching this viewer (i.e. routed as
/// `source.kind === "file"`, not as a `datastore-row` / `agent` /
/// `workflow` / etc.). Datastore rows, agents, workflows, and
/// `_schema.json` files all have dedicated structured editors and route
/// by `source.kind` upstream — they don't hit the file branch.
/// What's left here is config (`.openit/config.json`), traces, and
/// any standalone `.json` an admin drops in. All editable as raw text.
export function isJsonFile(path: string): boolean {
  return /\.json$/i.test(path);
}

/// JavaScript module scripts. `.claude/scripts/*.mjs` is the plugin
/// surface; `filestores/scripts/*.mjs` is the admin's own scripts
/// folder. Both should be editable for ad-hoc tweaks. (Plugin scripts
/// get overwritten by the next plugin sync — that's expected and
/// orthogonal to whether they're editable in the moment.)
export function isMjsScript(path: string): boolean {
  return /\.mjs$/i.test(path);
}

/// Files the in-app "Run" button can execute (`node` for JS family,
/// `python3` for `.py`). Used to gate the run affordance and the
/// always-edit mode — runnable scripts skip the View/Edit toggle
/// since "view" doesn't add value when the file is plain text the
/// user came here to edit + run.
export function isRunnableScript(path: string): boolean {
  return /\.(mjs|js|cjs|py)$/i.test(path);
}

/// Files that should expose View / Edit tabs and a textarea-backed
/// edit mode. Markdown, JSON, and `.mjs` scripts.
export function hasEditableTextMode(path: string): boolean {
  return isMarkdown(path) || isJsonFile(path) || isMjsScript(path);
}

export function isImage(path: string): boolean {
  return /\.(jpg|jpeg|png|gif|webp)$/i.test(path);
}

export function isPdf(path: string): boolean {
  return /\.pdf$/i.test(path);
}

export function isSpreadsheet(path: string): boolean {
  return /\.(xlsx|csv)$/i.test(path);
}

export function isOfficeDoc(path: string): boolean {
  return /\.(docx|pptx)$/i.test(path);
}

export function mimeForPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
  };
  return map[ext] ?? "application/octet-stream";
}

/// Some sources (filestores-list, knowledge-list) carry the
/// collection's absolute on-disk path because that's what `fsList`
/// returns. The Rust write commands require a repo-relative subdir
/// (the `validate_subdir` guard rejects absolute paths to prevent
/// writes outside the repo). Strip the repo prefix when present;
/// otherwise return the path as-is and let the validator complain
/// with a useful message.
export function toRepoRelative(repo: string, path: string): string {
  // Delegate separator-handling to the shared helper so Windows paths
  // with backslashes don't slip through as absolute (and trip the
  // Rust-side validate_subdir guard).
  const rel = relUnderRepo(repo, path);
  return rel ?? path;
}

/// Filenames that survive Finder (narrow no-break space, colons,
/// stray Unicode whitespace) routinely break the sync push and other
/// downstream tools that assume POSIX-safe names. Normalize before
/// the write so what lands on disk matches what later consumers will
/// accept. Rules: collapse any Unicode whitespace run to a single
/// ASCII space, strip characters that are unsafe on at least one
/// major filesystem (`/ \ : * ? " < > |`), and trim. Always preserves
/// the extension.
export function sanitizeUploadFilename(name: string): string {
  const cleaned = name
    .replace(/\s+/g, " ")
    .replace(/[\\/:*?"<>|]/g, "-")
    .trim();
  return cleaned.length > 0 ? cleaned : "upload";
}

/// Land each dropped file into `<repo>/<subdir>/<filename>`. Used by
/// every drag-from-desktop affordance on entity-folder views and on
/// the filestores/knowledge collection cards. On any failure
/// the error string is set via `setError` so the call site can render
/// it; successes are silent because the fs watcher refreshes the
/// folder listing on its own.
export async function uploadFilesToSubdir(
  repo: string,
  subdir: string,
  files: File[],
  setError: (msg: string | null) => void,
  onToast?: (msg: string) => void,
): Promise<void> {
  const relSubdir = toRepoRelative(repo, subdir);
  setError(null);
  // Pre-flight: discover any same-named files already on disk so we
  // can ask once for the whole drop instead of one prompt per file.
  let existing = new Set<string>();
  try {
    const listed = await entityListLocal(repo, relSubdir);
    existing = new Set(listed.map((f) => f.filename));
  } catch {
    /* fresh dir — nothing to clobber */
  }
  // Sanitize once per file. A second pass de-duplicates within the
  // batch itself: if two dropped files sanitize to the same name
  // (e.g. `file:1.txt` and `file/1.txt` both become `file-1.txt`,
  // or two files with identical names from different source dirs),
  // we suffix collisions with `-2`, `-3`, … so neither write
  // silently overwrites the other.
  const usedInBatch = new Set<string>();
  const intended = files.map((f) => {
    const base = sanitizeUploadFilename(f.name || "upload");
    let filename = base;
    if (usedInBatch.has(filename)) {
      const dot = base.lastIndexOf(".");
      const stem = dot > 0 ? base.slice(0, dot) : base;
      const ext = dot > 0 ? base.slice(dot) : "";
      let i = 2;
      while (usedInBatch.has(`${stem}-${i}${ext}`)) i += 1;
      filename = `${stem}-${i}${ext}`;
    }
    usedInBatch.add(filename);
    return { file: f, filename };
  });
  const collisions = intended.filter((i) => existing.has(i.filename));
  if (collisions.length > 0) {
    const list =
      collisions.length === 1
        ? `"${collisions[0].filename}"`
        : `${collisions.length} files (${collisions
            .map((c) => c.filename)
            .slice(0, 3)
            .join(", ")}${collisions.length > 3 ? "…" : ""})`;
    const ok = await ask(
      `${list} already exist${collisions.length === 1 ? "s" : ""} in this folder.\n\nReplace?`,
      { title: "Replace files?", kind: "warning" },
    );
    if (!ok) return;
  }
  const failed: { name: string; reason: string }[] = [];
  let succeeded = 0;
  for (const { file: f, filename } of intended) {
    try {
      const buf = await f.arrayBuffer();
      await entityWriteFileBytes(repo, relSubdir, filename, buf);
      succeeded += 1;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`[folder-upload] failed for ${filename}:`, err);
      failed.push({ name: filename, reason });
    }
  }
  if (failed.length > 0) {
    setError(
      `Failed to upload: ${failed
        .map((f) => `${f.name} (${f.reason})`)
        .join(", ")}`,
    );
  }
  if (succeeded > 0 && onToast) {
    onToast(
      succeeded === 1
        ? `Uploaded ${intended.find((i) => !failed.some((f) => f.name === i.filename))?.filename ?? "file"}`
        : `Uploaded ${succeeded} files`,
    );
  }
}

/// Tauri's native confirm dialog. `window.confirm` from inside the
/// WebView is unreliable on macOS — on some builds it returns `false`
/// immediately without rendering any UI, which silently swallows every
/// delete click. The `ask()` plugin renders a real NSAlert, blocks
/// until the user picks, and resolves the boolean. Any unexpected
/// throw is treated as cancel — better silent no-op than accidental
/// destruction.
export async function confirmDelete(message: string, title: string): Promise<boolean> {
  try {
    return await ask(message, { title, kind: "warning" });
  } catch (err) {
    console.error("[confirmDelete] dialog failed:", err);
    return false;
  }
}

/// Confirm + delete a single file in an entity folder. Used by the
/// trash button on library/KB/reports cards. The
/// fs watcher refreshes the listing on its own — we just surface
/// errors so the user knows when a delete didn't take.
///
/// Returns `true` only when the file was actually removed. `false`
/// covers both "user cancelled the confirm" and "delete API threw".
/// Callers that hold side-state contingent on the delete (e.g. an
/// optimistic-hide set in EntityFolderViewer) must use the return
/// value to decide whether to commit that state — without it, a
/// cancel leaves the card hidden even though nothing was deleted.
export async function deleteFileInSubdir(
  repo: string,
  subdir: string,
  filename: string,
  setError: (msg: string | null) => void,
  onToast?: (msg: string) => void,
  onRefresh?: () => void,
): Promise<boolean> {
  const ok = await confirmDelete(
    `Delete "${filename}"?\n\nThis cannot be undone.`,
    "Delete file?",
  );
  if (!ok) return false;
  onToast?.(`Deleting ${filename}…`);
  setError(null);
  try {
    const rel = toRepoRelative(repo, subdir);
    await entityDeleteFile(repo, rel, filename);
    onToast?.(`Deleted ${filename}`);
    onRefresh?.();
    return true;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[folder-delete] failed for ${filename}:`, err);
    onToast?.(`Failed to delete ${filename}: ${reason}`);
    setError(`Failed to delete ${filename}: ${reason}`);
    return false;
  }
}

/// Anchor tag override for ReactMarkdown rendering. Three URL shapes
/// are routed:
///
/// - `openit://skill/<name>` -> pastes `/<name>` into the active Claude
///   PTY, kicking off that skill conversationally. Used by the welcome
///   doc's "Connect to Cloud" CTA. Future: support args via query
///   string.
/// - `http(s)://...` -> opens in the user's default browser via Tauri's
///   `openUrl` plugin so the in-app webview isn't replaced by the
///   linked page.
/// - Anything else -> renders as a normal `<a>` (in-page anchors,
///   `mailto:`, etc.).
export function ExternalAnchor({
  href,
  children,
  ...rest
}: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  // openit://cloud-cta — opens the cloud CTA page in the center pane.
  // Cloud CTA links removed — local-first mode has no cloud connection.
  // Legacy `connect-to-cloud.md` files in existing vaults may still
  // contain these links; render them as inert text so they don't crash.
  if (
    href === "openit://cloud-cta" ||
    href === "openit://skill/connect-to-cloud" ||
    href === "openit://connect-cloud"
  ) {
    return <span {...rest}>{children}</span>;
  }
  // openit://create-samples — populates the workspace with bundled
  // sample tickets / people / conversations / KB articles. App.tsx
  // listens and calls into seedIfEmpty (per-target local-empty gate,
  // so re-clicks after content exists are no-ops).
  if (href === "openit://create-samples") {
    return (
      <a
        href="#"
        data-openit-cta="create-samples"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          window.dispatchEvent(new CustomEvent("openit:create-samples"));
        }}
        {...rest}
      >
        {children}
      </a>
    );
  }
  if (href && href.startsWith("openit://skill/")) {
    const skillName = href.slice("openit://skill/".length).split("?")[0];
    // Use href="#" rather than the openit:// URL — the Tauri webview
    // tries to navigate the whole shell when it sees a real custom
    // scheme, which reloads the app. Stash the skill name on a
    // data attribute so the CSS selector can still target this kind
    // of link for the secondary-button styling.
    return (
      <a
        href="#"
        data-openit-skill={skillName}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const cmd = `/${skillName}`;
          const wrapped = `${BRACKETED_PASTE_OPEN}${cmd}${BRACKETED_PASTE_CLOSE}`;
          writeToActiveSession(wrapped)
            .then((ok) => {
              if (!ok) {
                alert(
                  "Couldn't reach Claude — make sure Claude is running in the right-hand pane, then click again.",
                );
              }
            })
            .catch((err) => console.warn("[viewer] paste-to-Claude failed:", err));
        }}
        {...rest}
      >
        {children}
      </a>
    );
  }
  const isExternal = !!href && /^https?:\/\//i.test(href);
  if (!isExternal) {
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  }
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        openUrl(href).catch((err) => console.warn("[viewer] openUrl failed:", err));
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
