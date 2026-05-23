import { fsRead, fsList } from "../../../lib/api";
import type { ViewerSource } from "../../viewerTypes";
import { isDirectChild } from "../../../lib/paths";

/**
 * Top-level entity folders. Knowledge / library / reports / agents /
 * workflows / skills / scripts all share a single generic entity-folder
 * kind so the viewer can show a friendly empty-state notice when
 * nothing is inside yet.
 */
export async function resolveEntityFolder(
  path: string,
  rel: string,
  repo: string,
  entityType:
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
    for (const n of nodes) {
      if (n.is_dir) continue;
      // fs_list walks recursively (depth 6); keep only direct
      // children of the entity dir so nested files (e.g. anything a
      // future sync engine drops into a sub-folder) don't pollute
      // this list with descendants.
      if (!isDirectChild(path, n.path)) continue;
      // Skip conflict-shadow files written by the sync engine -- they
      // would duplicate every entry under "<name>.server.json" /
      // "<name>.server.md" and aren't meant for direct viewing.
      if (n.name.includes(".server.")) continue;
      const displayName = n.name.replace(/\.(json|md)$/, "");
      let description = "";
      if (entityType === "knowledge-base" || entityType === "reports") {
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
    // fsTick. Wrap in try/catch so an unsupported subdir keeps
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
    library: {
      description:
        "Curated reference docs admins keep handy -- runbooks, scripts, recurring PDFs. Drag files in to add.",
      itemNoun: "file",
    },
    // Commands + scripts are admin-curated artifacts. Both are built-in
    // like library. Keyed by the on-disk folder name (`commands`) so
    // the pre-seeded card and the disk-walked card collapse to one
    // entry instead of rendering twice.
    commands: {
      description:
        "Commands you run via /name in the chat. Click a command to view or edit its definition.",
      itemNoun: "command",
    },
    scripts: {
      description:
        "Runnable scripts -- deterministic CLI sequences Claude or you can invoke. Mirrored to .claude/scripts/ for direct execution.",
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
    for (const sd of subdirs) {
      if (!sd.is_dir) continue;
      if (!isDirectChild(path, sd.path)) continue;
      const collName = sd.name;
      const builtin = builtinDescriptions[collName];
      let itemCount = 0;
      try {
        const inner = await fsList(sd.path);
        for (const n of inner) {
          if (!isDirectChild(sd.path, n.path)) continue;
          if (n.is_dir) continue;
          if (n.name.includes(".server.")) continue;
          itemCount += 1;
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
