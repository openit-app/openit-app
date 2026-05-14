import { fsRead, fsList } from "../../../lib/api";
import type { ViewerSource } from "../../viewerTypes";

/**
 * `filestores/attachments/<ticketId>/` -- entity-folder of the
 * actual files in that ticket's attachments folder.
 */
export async function resolveAttachmentsTicket(
  path: string,
  rel: string,
): Promise<ViewerSource> {
  try {
    const nodes = await fsList(path);
    const files: {
      name: string;
      displayName: string;
      description: string;
      path: string;
    }[] = [];
    const childPrefix = `${path}/`;
    for (const n of nodes) {
      if (n.is_dir) continue;
      const remainder = n.path.startsWith(childPrefix)
        ? n.path.slice(childPrefix.length)
        : "";
      if (!remainder || remainder.includes("/")) continue;
      if (n.name.includes(".server.")) continue;
      files.push({ name: n.name, displayName: n.name, description: "", path: n.path });
    }
    files.sort((a, b) => a.name.localeCompare(b.name));
    return {
      kind: "entity-folder",
      entity: "attachments-ticket",
      path: rel,
      files,
    };
  } catch {
    return {
      kind: "entity-folder",
      entity: "attachments-ticket",
      path: rel,
      files: [],
    };
  }
}

/**
 * Top-level entity folders. The conversations folder already has its
 * own dedicated list view; the rest share a single generic
 * entity-folder kind so the viewer can show a friendly empty-state
 * notice when nothing is inside yet.
 */
export async function resolveEntityFolder(
  path: string,
  rel: string,
  repo: string,
  entityType:
    | "agents"
    | "workflows"
    | "knowledge"
    | "knowledge-base"
    | "library"
    | "reports"
    | "skills"
    | "scripts",
): Promise<ViewerSource> {
  try {
    const nodes = await fsList(path);
    const files: {
      name: string;
      displayName: string;
      description: string;
      path: string;
      size: number | null;
    }[] = [];
    const childPrefix = `${path}/`;
    // V3 agents: each agent is a single .md file in agents/.
    // Display name = filename without extension. Description =
    // first non-empty, non-heading line from the markdown.
    if (rel === "agents") {
      for (const n of nodes) {
        if (n.is_dir) continue;
        const remainder = n.path.startsWith(childPrefix)
          ? n.path.slice(childPrefix.length)
          : "";
        if (!remainder || remainder.includes("/")) continue;
        if (!n.name.endsWith(".md")) continue;
        if (n.name.includes(".server.")) continue;
        const displayName = n.name.replace(/\.md$/, "");
        let description = "";
        try {
          const raw = await fsRead(n.path);
          // First non-empty line that isn't a heading
          for (const line of raw.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) continue;
            description = trimmed.slice(0, 120);
            break;
          }
        } catch { /* unreadable */ }
        files.push({
          name: n.name,
          displayName,
          description,
          path: n.path,
          size: null,
        });
      }
      return { kind: "entity-folder", entity: entityType, files, path };
    }
    for (const n of nodes) {
      if (n.is_dir) continue;
      // fs_list walks recursively (depth 6); keep only direct
      // children of the entity dir so nested files (e.g. anything a
      // future sync engine drops into a sub-folder) don't pollute
      // this list with descendants.
      const remainder = n.path.startsWith(childPrefix) ? n.path.slice(childPrefix.length) : "";
      if (!remainder || remainder.includes("/")) continue;
      // Skip conflict-shadow files written by the sync engine -- they
      // would duplicate every entry under "<name>.server.json" /
      // "<name>.server.md" and aren't meant for direct viewing.
      if (n.name.includes(".server.")) continue;
      let displayName = n.name.replace(/\.(json|md)$/, "");
      let description = "";
      if (rel === "agents" || rel === "workflows") {
        if (n.name.endsWith(".json")) {
          try {
            const raw = await fsRead(n.path);
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === "object") {
              if (typeof parsed.name === "string" && parsed.name.trim()) {
                displayName = parsed.name.trim();
              }
              if (typeof parsed.description === "string") {
                description = parsed.description.trim();
              }
            }
          } catch {
            /* unparseable -- keep filename-derived display name */
          }
        }
      } else if (entityType === "knowledge-base" || entityType === "reports") {
        // Pull the first heading or first non-empty line as a
        // description preview. Markdown files are the common case;
        // for non-markdown files we fall back to just the name.
        if (n.name.endsWith(".md")) {
          try {
            const raw = await fsRead(n.path);
            // Prefer an explicit `# Heading`; otherwise take the
            // first non-empty, non-frontmatter line.
            const lines = raw.split("\n");
            let inFrontmatter = false;
            for (let i = 0; i < lines.length; i += 1) {
              const line = lines[i];
              if (i === 0 && line.trim() === "---") {
                inFrontmatter = true;
                continue;
              }
              if (inFrontmatter) {
                if (line.trim() === "---") inFrontmatter = false;
                continue;
              }
              if (!line.trim()) continue;
              const heading = line.match(/^#\s+(.+)$/);
              if (heading) {
                description = heading[1].trim();
                break;
              }
              description = line.trim().slice(0, 140);
              break;
            }
          } catch {
            /* unreadable -- leave description empty */
          }
        }
      }
      files.push({ name: n.name, displayName, description, path: n.path, size: null });
    }
    // jump around when files are renamed in place. Reports are the
    // exception -- filenames carry a leading `YYYY-MM-DD-HHmm`
    // timestamp, so reverse-alphabetical on `name` puts the newest
    // run on top, which is what the admin wants when scanning
    // recent helpdesk activity.
    if (entityType === "reports") {
      files.sort((a, b) => b.name.localeCompare(a.name));
    } else {
      files.sort((a, b) => a.displayName.localeCompare(b.displayName));
    }
    // Pull file sizes from the entity-local listing. fs_list doesn't
    // surface size and walking the disk twice is fine: this resolver
    // only fires when the user clicks the folder, not on every
    // fsTick. Wrap in try/catch so an unsupported subdir (or a
    // future entity that isn't backed by entity_list_local) keeps
    // rendering without sizes instead of crashing the whole view.
    try {
      const { entityListLocal } = await import("../../../lib/api");
      const sizes = await entityListLocal(repo, rel);
      const byName = new Map(sizes.map((s) => [s.filename, s.size]));
      for (const f of files) {
        const s = byName.get(f.name);
        if (typeof s === "number") f.size = s;
      }
    } catch {
      /* size lookup unsupported -- leave sizes null */
    }
    return {
      kind: "entity-folder",
      entity: entityType,
      path: rel,
      files,
    };
  } catch {
    return {
      kind: "entity-folder",
      entity: entityType,
      path: rel,
      files: [],
    };
  }
}

/**
 * `filestores/` parent -- at-a-glance overview of every filestore
 * collection in the project.
 */
export async function resolveFilestoresList(
  path: string,
): Promise<ViewerSource> {
  type Card = {
    name: string;
    displayName: string;
    path: string;
    itemCount: number;
    itemNoun: string;
    description: string;
    isBuiltin: boolean;
  };
  const builtinDescriptions: Record<string, { description: string; itemNoun: string; displayName?: string }> = {
    attachments: {
      description:
        "Per-ticket files uploaded from the chat intake or attached to admin replies. One subfolder per ticketId -- files surface inline in the conversation thread.",
      itemNoun: "ticket",
    },
    library: {
      description:
        "Curated reference docs admins keep handy -- runbooks, scripts, recurring PDFs. Drag files in to add. Cloud-synced when connected.",
      itemNoun: "file",
    },
    // Commands + scripts are admin-curated artifacts captured by
    // /conversation-to-automation. Both are built-in like attachments
    // + library; they sync as their own cloud filestore collections.
    // Keyed by the on-disk folder name (`commands`, not the legacy
    // `skills`) so the pre-seeded card and the disk-walked card
    // collapse to one entry instead of rendering twice.
    commands: {
      description:
        "Commands you run via /name in the chat. Click a command to view or edit its definition.",
      itemNoun: "command",
    },
    scripts: {
      description:
        "Runnable scripts captured from resolved tickets -- deterministic CLI sequences Claude or you can invoke. Mirrored to .claude/scripts/ for direct execution.",
      itemNoun: "script",
    },
  };

  // Pre-seed both built-ins so the cards render even before the
  // dirs are created on disk (fresh project, or pre-bootstrap
  // state).
  const cardsByName = new Map<string, Card>();
  for (const [name, meta] of Object.entries(builtinDescriptions)) {
    cardsByName.set(name, {
      name,
      displayName: meta.displayName ?? name,
      path: `${path}/${name}`,
      itemCount: 0,
      itemNoun: meta.itemNoun,
      description: meta.description,
      isBuiltin: true,
    });
  }

  // Walk the filestores dir and override / extend with what's
  // actually on disk.
  try {
    const subdirs = await fsList(path);
    const childPrefix = `${path}/`;
    for (const sd of subdirs) {
      if (!sd.is_dir) continue;
      const tail = sd.path.startsWith(childPrefix) ? sd.path.slice(childPrefix.length) : "";
      if (!tail || tail.includes("/")) continue;
      const collName = sd.name;
      const isAttachments = collName === "attachments";
      const builtin = builtinDescriptions[collName];
      // Count semantics differ: attachments is folder-of-folders
      // (one subfolder per ticket), everything else counts direct
      // files (skipping conflict shadows).
      let itemCount = 0;
      try {
        const inner = await fsList(sd.path);
        const innerPrefix = `${sd.path}/`;
        for (const n of inner) {
          const innerTail = n.path.startsWith(innerPrefix) ? n.path.slice(innerPrefix.length) : "";
          if (!innerTail || innerTail.includes("/")) continue;
          if (isAttachments) {
            if (n.is_dir) itemCount += 1;
          } else {
            if (n.is_dir) continue;
            if (n.name.includes(".server.")) continue;
            itemCount += 1;
          }
        }
      } catch {
        /* unreadable subdir -- leave count at 0 */
      }
      cardsByName.set(collName, {
        name: collName,
        displayName: builtin?.displayName ?? collName,
        path: sd.path,
        itemCount,
        itemNoun: builtin?.itemNoun ?? "file",
        description:
          builtin?.description ??
          "User-created filestore.",
        isBuiltin: !!builtin,
      });
    }
  } catch {
    /* filestores/ doesn't exist yet -- built-ins still render */
  }

  // Built-ins first (alphabetical), user-created next (alphabetical).
  const cards = Array.from(cardsByName.values()).sort((a, b) => {
    if (a.isBuiltin !== b.isBuiltin) return a.isBuiltin ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return { kind: "filestores-list", collections: cards };
}

/**
 * `filestores/attachments/` -- list of per-ticket subfolders with
 * file counts, prefixed by an explanatory header.
 */
export async function resolveAttachmentsFolder(
  path: string,
): Promise<ViewerSource> {
  try {
    const subdirs = await fsList(path);
    const tickets: { ticketId: string; path: string; fileCount: number }[] = [];
    const childPrefix = `${path}/`;
    for (const sd of subdirs) {
      if (!sd.is_dir) continue;
      const tail = sd.path.startsWith(childPrefix) ? sd.path.slice(childPrefix.length) : "";
      if (!tail || tail.includes("/")) continue;
      let fileCount = 0;
      try {
        const inner = await fsList(sd.path);
        const innerPrefix = `${sd.path}/`;
        for (const f of inner) {
          if (f.is_dir) continue;
          const innerTail = f.path.startsWith(innerPrefix) ? f.path.slice(innerPrefix.length) : "";
          if (!innerTail || innerTail.includes("/")) continue;
          fileCount += 1;
        }
      } catch {
        /* unreadable subdir -- leave count at 0 */
      }
      tickets.push({ ticketId: sd.name, path: sd.path, fileCount });
    }
    // Newest-first using the ticketId's leading ISO timestamp.
    tickets.sort((a, b) => b.ticketId.localeCompare(a.ticketId));
    return { kind: "attachments-folder", tickets };
  } catch {
    return { kind: "attachments-folder", tickets: [] };
  }
}
