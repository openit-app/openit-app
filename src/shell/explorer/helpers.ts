import type { FileNode } from "../../lib/api";
import type { DataCollection, MemoryItem } from "../../lib/localTypes";

export function relPath(repo: string, absPath: string): string {
  const prefix = `${repo}/`;
  return absPath.startsWith(prefix) ? absPath.slice(prefix.length) : absPath;
}

/**
 * Display-only name transform. The actual on-disk folder name is the
 * collection's full cloud name (e.g. `openit-people-653713545258`),
 * but in the tree we strip the `openit-` prefix and the trailing
 * `-<orgId>` so users see just `people` / `tickets`. Only applies to
 * top-level `databases/openit-*` directories — leaves filenames inside
 * them untouched.
 */
/// Pick the field whose value is the human-meaningful label for a row.
/// Priority: case-number-like → email → name/title/subject → first string
/// field. Returns the field id (e.g. "f_2") or null if no string fields.
function pickDisplayFieldId(
  schema: { fields?: Array<{ id?: string; label?: string; type?: string }> } | undefined,
): string | null {
  const fields = schema?.fields;
  if (!fields || fields.length === 0) return null;
  const matchers: RegExp[] = [
    /case\s*number|ticket\s*id|^id$|^number$/i,
    /email/i,
    /^name$|title|subject/i,
  ];
  for (const re of matchers) {
    const m = fields.find(
      (f) =>
        typeof f.label === "string" &&
        re.test(f.label) &&
        (f.type === "string" || f.type === undefined) &&
        f.id,
    );
    if (m?.id) return m.id;
  }
  // Fall back to first string field with an id.
  const first = fields.find((f) => f.id && (f.type === "string" || f.type === undefined));
  return first?.id ?? null;
}

const ROW_LABEL_MAX = 40;

function truncate(s: string): string {
  if (s.length <= ROW_LABEL_MAX) return s;
  return s.slice(0, ROW_LABEL_MAX - 1) + "\u2026";
}

/// Display name for a tree node. Defaults to the filename, but rewrites:
///   - collection dirs `databases/openit-foo-12345/` → `foo`
///   - row files inside those `<key>.json` → label from a schema-picked
///     field (email for people, case number for tickets, etc.). Falls
///     back to the filename when content / schema isn't available.
export function prettyName(
  name: string,
  rel: string,
  datastores: DataCollection[] = [],
  datastoreItems: Record<string, { items: MemoryItem[]; hasMore: boolean }> = {},
): string {
  if (rel.match(/^databases\/openit-[^/]+$/)) {
    const stripped = name.replace(/^openit-/, "").replace(/-\d+$/, "");
    if (stripped) return stripped;
  }
  // Agent + workflow files: `agents/<name>.json` → just `<name>`. The
  // .json extension is implementation noise; the user thinks of these
  // as named entities, not files.
  if (rel.match(/^(agents|workflows)\/[^/]+\.json$/)) {
    return name.replace(/\.json$/, "");
  }
  // Row file: databases/<col>/<key>.json. Try a schema-picked display
  // field first (email for people, case number for tickets, etc.); if
  // anything in that lookup fails, fall through to the bare row key
  // (filename without `.json`) — never the raw filename, since `.json`
  // is implementation noise the user doesn't think of as part of the id.
  const rowMatch = rel.match(/^databases\/([^/]+)\/([^/]+)\.json$/);
  if (rowMatch && rowMatch[2] !== "_schema" && !name.includes(".server.")) {
    const colName = rowMatch[1];
    const rowKey = rowMatch[2];
    const col = datastores.find((d) => d.name === colName);
    if (col) {
      const fieldId = pickDisplayFieldId(col.schema as { fields?: Array<{ id?: string; label?: string; type?: string }> } | undefined);
      if (fieldId) {
        const item = datastoreItems[col.id]?.items.find(
          (i) => (i.key || i.id) === rowKey,
        );
        const content = item?.content;
        if (content && typeof content === "object") {
          const value = (content as Record<string, unknown>)[fieldId];
          if (typeof value === "string" && value.trim()) {
            return truncate(value.trim());
          }
        }
      }
    }
    return rowKey;
  }
  // Conversation message: databases/conversations/<ticketId>/msg-*.json.
  // The filename is `msg-<unix-ms>-<rand>.json`; the user thinks of these
  // as messages, not files, so drop the .json. (We keep the msg- prefix
  // and timestamp because they sort the explorer list usefully.)
  if (rel.match(/^databases\/conversations\/[^/]+\/.+\.json$/) && !name.includes(".server.")) {
    return name.replace(/\.json$/, "");
  }
  // Knowledge-base markdown articles — same logic as agents/workflows:
  // the .md is implementation noise; users think of them by title.
  if (rel.match(/^knowledge-bases\/[^/]+\.(md|markdown)$/)) {
    return name.replace(/\.(md|markdown)$/, "");
  }
  return name;
}

/// Recover a friendlier filename for a dropped file. Most drops from
/// Finder give us the real filename in `File.name`. Drops from a web
/// app (Slack, Google Drive, etc.) often hand the browser an opaque
/// CDN id instead — `T06KC1QJMSP-U07KXMWSZR7-1a3826e7787f-…` is the
/// pattern Slack uses. When the file's own name looks like one of
/// those opaque ids AND the drag includes a `text/uri-list` (the
/// public link), prefer the URL's basename — that's almost always
/// the real filename. Fall back to the original `File.name` if we
/// can't do better.
export function friendlyDroppedFilename(fileName: string, urlHint?: string): string {
  // Detect the Slack-style id (workspace + user + hash) and the
  // generic "long string of hex/uppercase/dashes with no extension"
  // pattern. If the name has a normal extension and isn't pathological,
  // keep it.
  const looksLikeSlackId = /^T[A-Z0-9]+-U[A-Z0-9]+/.test(fileName);
  const hasExtension = /\.[A-Za-z0-9]{1,8}$/.test(fileName);
  const looksOpaque = looksLikeSlackId || (!hasExtension && fileName.length > 32 && /^[A-Za-z0-9_-]+$/.test(fileName));
  if (!looksOpaque) return fileName;

  if (urlHint) {
    try {
      const url = new URL(urlHint);
      const segments = url.pathname.split("/").filter(Boolean);
      const last = segments[segments.length - 1];
      if (last) {
        const decoded = decodeURIComponent(last);
        // Sanity-check: the URL basename should look like a real
        // filename (have an extension, not be itself opaque).
        if (/\.[A-Za-z0-9]{1,8}$/.test(decoded)) return decoded;
      }
    } catch {
      /* not a parsable URL — fall through */
    }
  }
  return fileName;
}

export function fileColorClass(
  n: FileNode,
  repo: string,
  conflictPaths: Set<string>,
): string {
  if (n.is_dir) return "";
  const rel = relPath(repo, n.path);
  if (conflictPaths.has(rel)) return "file-color-conflict";
  return "";
}

export function fileStatusBadge(
  n: FileNode,
  repo: string,
  conflictPaths: Set<string>,
): string | null {
  if (n.is_dir) return null;
  const rel = relPath(repo, n.path);
  if (conflictPaths.has(rel)) return "\u26A0";
  return null;
}

export const KB_SUPPORTED_EXTENSIONS = new Set([
  "pdf", "txt", "md", "markdown", "json", "csv",
  "docx", "xlsx", "pptx",
  "jpg", "jpeg", "png", "gif", "webp",
]);

export function isKbSupported(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return KB_SUPPORTED_EXTENSIONS.has(ext);
}
