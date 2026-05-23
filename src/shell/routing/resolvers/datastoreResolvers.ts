import { fsRead, fsList } from "../../../lib/api";
import { isDirectChild } from "../../../lib/paths";
import type {
  AccessSummary,
  AssetSummary,
  PersonSummary,
  ViewerSource,
} from "../../viewerTypes";
import type { DataCollection } from "../../../lib/localTypes";

/**
 * databases/<collection>/_schema.json -- datastore-schema
 */
export async function resolveDatastoreSchema(
  path: string,
  collectionName: string,
): Promise<ViewerSource | null> {
  try {
    const raw = await fsRead(path);
    const schema = JSON.parse(raw);
    return {
      kind: "datastore-schema",
      collection: { id: "", name: collectionName, type: "datastore", numItems: 0, schema },
    };
  } catch {
    return { kind: "file", path };
  }
}

/**
 * databases/<collection>/<row>.json -- datastore-row
 */
export async function resolveDatastoreRow(
  path: string,
  repo: string,
  collectionName: string,
  rowName: string,
): Promise<ViewerSource> {
  try {
    const raw = await fsRead(path);
    const content = JSON.parse(raw);
    // Read schema from the same collection directory
    let schema;
    try {
      const schemaPath = `${repo}/databases/${collectionName}/_schema.json`;
      const schemaRaw = await fsRead(schemaPath);
      schema = JSON.parse(schemaRaw);
    } catch { /* no schema file */ }
    return {
      kind: "datastore-row",
      collection: { id: "", name: collectionName, type: "datastore", numItems: 0, schema },
      item: { id: rowName, key: rowName, content, createdAt: "", updatedAt: "" },
    };
  } catch {
    return { kind: "file", path };
  }
}

/**
 * databases/<collection>/ directory -- datastore-table (read schema + all row files)
 * Also handles people-list, access-list, and assets-list as special cases.
 */
export async function resolveDatastoreTable(
  path: string,
  colName: string,
): Promise<ViewerSource> {
  try {
    let schema;
    try {
      const schemaRaw = await fsRead(`${path}/_schema.json`);
      schema = JSON.parse(schemaRaw);
    } catch { /* no schema file */ }

    const col: DataCollection = { id: "", name: colName, type: "datastore", numItems: 0, schema };

    // Read all row files
    const nodes = await fsList(path);
    const items = [];
    for (const node of nodes) {
      if (node.is_dir || node.name === "_schema.json") continue;
      // Depth-1 filter -- fs_list walks recursively, so without this
      // a collection like `conversations` would slurp every msg file
      // out of every thread folder as if it were a top-level row.
      if (!isDirectChild(path, node.path)) continue;
      try {
        const raw = await fsRead(node.path);
        const content = JSON.parse(raw);
        const key = node.name.replace(/\.json$/, "");
        items.push({ id: key, key, content, createdAt: "", updatedAt: "" });
      } catch { /* skip unparseable */ }
    }

    // People gets a friendlier card-list view by default with a
    // Cards / Table toggle in the viewer header. Re-uses the same
    // collection + items, so the table mode renders identically to
    // the generic datastore-table view.
    if (colName === "people") {
      const people: PersonSummary[] = items
        .map((it): PersonSummary | null => {
          const c = it.content as Record<string, unknown> | null;
          if (!c || typeof c !== "object") return null;
          const channelsRaw = (c as { channels?: unknown }).channels;
          const channels = Array.isArray(channelsRaw)
            ? channelsRaw.filter((v): v is string => typeof v === "string")
            : [];
          return {
            key: typeof it.key === "string" ? it.key : it.id,
            name:
              typeof (c as { displayName?: unknown }).displayName === "string"
                ? ((c as { displayName: string }).displayName)
                : "",
            email:
              typeof (c as { email?: unknown }).email === "string"
                ? ((c as { email: string }).email)
                : "",
            role:
              typeof (c as { role?: unknown }).role === "string"
                ? ((c as { role: string }).role)
                : "",
            department:
              typeof (c as { department?: unknown }).department === "string"
                ? ((c as { department: string }).department)
                : "",
            channels,
          };
        })
        .filter((p): p is PersonSummary => p !== null)
        .sort((a, b) =>
          (a.name || a.email || a.key).localeCompare(b.name || b.email || b.key),
        );
      return {
        kind: "people-list",
        view: "cards",
        people,
        collection: col,
        items,
      };
    }

    // Access log gets a card-list view identical to people.
    if (colName === "access") {
      const records: AccessSummary[] = items
        .map((it): AccessSummary | null => {
          const c = it.content as Record<string, unknown> | null;
          if (!c || typeof c !== "object") return null;
          return {
            key: typeof it.key === "string" ? it.key : it.id,
            action:
              typeof (c as { action?: unknown }).action === "string"
                ? ((c as { action: string }).action)
                : "",
            employee:
              typeof (c as { employee?: unknown }).employee === "string"
                ? ((c as { employee: string }).employee)
                : "",
            email:
              typeof (c as { email?: unknown }).email === "string"
                ? ((c as { email: string }).email)
                : "",
            role:
              typeof (c as { role?: unknown }).role === "string"
                ? ((c as { role: string }).role)
                : "",
            date:
              typeof (c as { date?: unknown }).date === "string"
                ? ((c as { date: string }).date)
                : "",
          };
        })
        .filter((r): r is AccessSummary => r !== null)
        .sort((a, b) =>
          (a.employee || a.email || a.key).localeCompare(b.employee || b.email || b.key),
        );
      return {
        kind: "access-list",
        view: "cards",
        records,
        collection: col,
        items,
      };
    }

    // Asset inventory gets a card-list view identical to people.
    if (colName === "assets") {
      const records: AssetSummary[] = items
        .map((it): AssetSummary | null => {
          const c = it.content as Record<string, unknown> | null;
          if (!c || typeof c !== "object") return null;
          return {
            key: typeof it.key === "string" ? it.key : it.id,
            name:
              typeof (c as { name?: unknown }).name === "string"
                ? ((c as { name: string }).name)
                : "",
            type:
              typeof (c as { type?: unknown }).type === "string"
                ? ((c as { type: string }).type)
                : "",
            serialNumber:
              typeof (c as { serialNumber?: unknown }).serialNumber === "string"
                ? ((c as { serialNumber: string }).serialNumber)
                : "",
            assignedTo:
              typeof (c as { assignedTo?: unknown }).assignedTo === "string"
                ? ((c as { assignedTo: string }).assignedTo)
                : "",
            status:
              typeof (c as { status?: unknown }).status === "string"
                ? ((c as { status: string }).status)
                : "",
          };
        })
        .filter((r): r is AssetSummary => r !== null)
        .sort((a, b) =>
          (a.name || a.key).localeCompare(b.name || b.key),
        );
      return {
        kind: "assets-list",
        view: "cards",
        records,
        collection: col,
        items,
      };
    }

    return { kind: "datastore-table", collection: col, items };
  } catch {
    return { kind: "file", path };
  }
}

/**
 * Top-level `databases/` parent folder -- databases-list. Lists each
 * child collection (databases/<col>/) as a card with name, item
 * count, and a hint of whether the schema is in place.
 */
export async function resolveDatabasesList(
  path: string,
): Promise<ViewerSource> {
  try {
    const subdirs = await fsList(path);
    const collections: {
      name: string;
      path: string;
      itemCount: number;
      hasSchema: boolean;
    }[] = [];
    for (const sd of subdirs) {
      if (!sd.is_dir) continue;
      // fs_list walks recursively, so the raw subdir list contains
      // every nested folder (e.g. each conversation thread under
      // `conversations/`). Keep only direct children of `databases/`
      // -- those are the actual collections.
      if (!isDirectChild(path, sd.path)) continue;
      let itemCount = 0;
      let hasSchema = false;
      try {
        const inner = await fsList(sd.path);
        for (const node of inner) {
          if (!isDirectChild(sd.path, node.path)) continue;
          if (node.name === "_schema.json") {
            hasSchema = true;
            continue;
          }
          if (node.is_dir) continue;
          if (!node.name.endsWith(".json")) continue;
          if (node.name.includes(".server.")) continue;
          itemCount += 1;
        }
      } catch {
        /* unreadable subdir -- keep itemCount=0, hasSchema=false */
      }
      collections.push({ name: sd.name, path: sd.path, itemCount, hasSchema });
    }
    // Sort alphabetically so the order is deterministic.
    collections.sort((a, b) => a.name.localeCompare(b.name));
    return { kind: "databases-list", collections };
  } catch {
    return { kind: "databases-list", collections: [] };
  }
}
