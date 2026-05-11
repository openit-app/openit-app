import { fsRead, fsList, entityWriteFile } from "../../../lib/api";
import { loadOpenitConfig } from "../../../lib/openitConfig";
import type {
  AccessSummary,
  AssetSummary,
  ConversationThreadSummary,
  ConversationTurn,
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
 * databases/tickets/ -- conversations-list (one card per ticket
 * with subject/status/last-activity from the ticket file + message
 * count from the corresponding conversations subfolder). The user
 * mental model is "tickets" -- one entry -- so we route the click
 * there and hide the underlying `conversations` folder elsewhere.
 * Older code paths may still hit `databases/conversations`; we
 * alias both paths through the same resolver.
 */
export async function resolveConversationsList(
  repo: string,
): Promise<ViewerSource> {
  try {
    const ticketsDir = `${repo}/databases/tickets`;
    const conversationsDir = `${repo}/databases/conversations`;
    const ticketNodes = await fsList(ticketsDir);
    const threads: ConversationThreadSummary[] = [];
    const ticketsPrefix = `${ticketsDir}/`;
    for (const node of ticketNodes) {
      if (node.is_dir) continue;
      // Depth-1 filter -- fs_list is recursive.
      const tail = node.path.startsWith(ticketsPrefix) ? node.path.slice(ticketsPrefix.length) : "";
      if (!tail || tail.includes("/")) continue;
      if (!node.name.endsWith(".json")) continue;
      if (node.name === "_schema.json") continue;
      if (node.name.includes(".server.")) continue;

      const ticketId = node.name.replace(/\.json$/, "");
      let subject = "";
      let asker = "";
      let status = "";
      let createdAt = "";
      let tags: string[] = [];
      try {
        const raw = await fsRead(node.path);
        const ticket = JSON.parse(raw);
        if (ticket && typeof ticket === "object") {
          subject = typeof ticket.subject === "string" ? ticket.subject : "";
          asker = typeof ticket.asker === "string" ? ticket.asker : "";
          status = typeof ticket.status === "string" ? ticket.status : "";
          createdAt = typeof ticket.createdAt === "string" ? ticket.createdAt : "";
          tags = Array.isArray(ticket.tags)
            ? ticket.tags.filter((v: unknown): v is string => typeof v === "string")
            : [];
        }
      } catch {
        /* unparseable -- keep defaults; fall back to ticketId in subject */
      }

      // Look up the conversation folder for message count + last
      // activity. Missing folder = brand-new ticket with no turns
      // yet (the chat-intake server creates it on first turn).
      const threadDir = `${conversationsDir}/${ticketId}`;
      let turnCount = 0;
      let lastTurnAt = "";
      let firstBody = "";
      try {
        const msgs = await fsList(threadDir);
        msgs.sort((a, b) => a.name.localeCompare(b.name));
        const threadPrefix = `${threadDir}/`;
        for (const m of msgs) {
          if (m.is_dir) continue;
          const mTail = m.path.startsWith(threadPrefix) ? m.path.slice(threadPrefix.length) : "";
          if (!mTail || mTail.includes("/")) continue;
          if (!m.name.endsWith(".json")) continue;
          if (m.name.includes(".server.")) continue;
          turnCount += 1;
          try {
            const raw = await fsRead(m.path);
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === "object") {
              const ts = typeof parsed.timestamp === "string" ? parsed.timestamp : "";
              if (ts > lastTurnAt) lastTurnAt = ts;
              if (!firstBody && parsed.role === "asker" && typeof parsed.body === "string") {
                firstBody = parsed.body;
              }
            }
          } catch {
            /* skip unparseable */
          }
        }
      } catch {
        /* no thread folder yet */
      }

      threads.push({
        ticketId,
        subject: subject || firstBody.split("\n")[0].slice(0, 80) || ticketId,
        asker,
        status,
        createdAt: createdAt || lastTurnAt,
        lastTurnAt,
        turnCount,
        tags,
      });
    }
    // Lifecycle walkers: auto-escalate stale `open` tickets and
    // auto-close stale `resolved` tickets. Both run passive-on-view --
    // rewriting the JSON here means the on-disk truth changes the
    // next time the list renders, which keeps the rule consistent
    // across reloads without a separate cron. Hour thresholds and
    // both transitions are admin-tunable via `.openit/config.json`;
    // setting either threshold to `0` disables that walker.
    const cfg = await loadOpenitConfig(repo);
    const staleOpenMs = cfg.ticketLifecycle.autoEscalateOpenAfterHours * 60 * 60 * 1000;
    const autoCloseMs = cfg.ticketLifecycle.autoCloseResolvedAfterHours * 60 * 60 * 1000;
    const nowMs = Date.now();
    await Promise.all(
      threads.map(async (t) => {
        // -- auto-escalate `open` past stale window --
        if (staleOpenMs > 0 && t.status === "open" && t.lastTurnAt) {
          const lastMs = Date.parse(t.lastTurnAt);
          if (!Number.isNaN(lastMs) && nowMs - lastMs >= staleOpenMs) {
            try {
              const ticketPath = `${ticketsDir}/${t.ticketId}.json`;
              const raw = await fsRead(ticketPath);
              const parsed = JSON.parse(raw) as Record<string, unknown>;
              // Re-check on disk to avoid racing a concurrent write
              // (e.g. an admin reply that just escalated this ticket).
              if (parsed.status === "open") {
                parsed.status = "escalated";
                parsed.updatedAt = new Date(nowMs).toISOString().replace(/\.\d+Z$/, "Z");
                const existingTags = Array.isArray(parsed.tags)
                  ? parsed.tags.filter((v: unknown): v is string => typeof v === "string")
                  : [];
                if (!existingTags.includes("auto-escalated")) {
                  existingTags.push("auto-escalated");
                }
                parsed.tags = existingTags;
                // Stamp the internal notes field so an admin opening the
                // ticket sees the *reason* for the escalation. Append-only:
                // preserve any existing notes the admin or agent has already
                // written.
                const hours = cfg.ticketLifecycle.autoEscalateOpenAfterHours;
                const noteLine = `Escalated for time (no asker reply in ${hours}h).`;
                const existingNotes =
                  typeof parsed.notes === "string" ? parsed.notes : "";
                if (!existingNotes.includes(noteLine)) {
                  parsed.notes = existingNotes
                    ? `${existingNotes.replace(/\s+$/, "")}\n${noteLine}`
                    : noteLine;
                }
                await entityWriteFile(
                  repo,
                  "databases/tickets",
                  `${t.ticketId}.json`,
                  JSON.stringify(parsed, null, 2),
                );
                t.status = "escalated";
                t.tags = existingTags;
                return;
              }
            } catch {
              /* unparseable / missing -- leave status as-is */
            }
          }
        }
        // -- auto-close `resolved` past close window --
        // The resolve-time anchor is the ticket's `updatedAt` --
        // `mark_status` (intake.rs) stamps it on every status flip,
        // and an asker follow-up that re-opens a resolved ticket
        // flips it to `agent-responding` (so we won't false-trigger
        // here). Walker only writes when the on-disk status is still
        // `resolved` to avoid racing concurrent writes.
        if (autoCloseMs > 0 && t.status === "resolved") {
          try {
            const ticketPath = `${ticketsDir}/${t.ticketId}.json`;
            const raw = await fsRead(ticketPath);
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            if (parsed.status !== "resolved") return;
            const updatedAt = typeof parsed.updatedAt === "string" ? parsed.updatedAt : "";
            const resolvedAtMs = Date.parse(updatedAt);
            if (Number.isNaN(resolvedAtMs)) return;
            if (nowMs - resolvedAtMs < autoCloseMs) return;
            parsed.status = "closed";
            parsed.updatedAt = new Date(nowMs).toISOString().replace(/\.\d+Z$/, "Z");
            const existingTags = Array.isArray(parsed.tags)
              ? parsed.tags.filter((v: unknown): v is string => typeof v === "string")
              : [];
            if (!existingTags.includes("auto-closed")) {
              existingTags.push("auto-closed");
            }
            parsed.tags = existingTags;
            await entityWriteFile(
              repo,
              "databases/tickets",
              `${t.ticketId}.json`,
              JSON.stringify(parsed, null, 2),
            );
            t.status = "closed";
            t.tags = existingTags;
          } catch {
            /* unparseable / missing -- leave status as-is */
          }
        }
      }),
    );
    threads.sort((a, b) => b.lastTurnAt.localeCompare(a.lastTurnAt));

    // Load the tickets schema so the conversations-list header can
    // offer a "+ New" button that drafts a new ticket via RowEditForm.
    let ticketsCollection: DataCollection | undefined;
    try {
      const schemaRaw = await fsRead(`${repo}/databases/tickets/_schema.json`);
      const schema = JSON.parse(schemaRaw);
      ticketsCollection = { id: "", name: "tickets", type: "datastore", numItems: threads.length, schema };
    } catch { /* no schema — + New button won't render */ }

    return { kind: "conversations-list", threads, collection: ticketsCollection };
  } catch {
    return { kind: "file", path: `${repo}/databases/tickets` };
  }
}

/**
 * databases/conversations/<ticketId>/ directory -- conversation-thread
 * (read every msg-*.json under the subfolder, sort by timestamp).
 * Match before the generic datastore-table rule so conversation
 * subfolders don't get rendered as tables.
 */
export async function resolveConversationThread(
  path: string,
  ticketId: string,
): Promise<ViewerSource> {
  // Try to read conversation turns from the thread folder.
  let hasTurns = false;
  try {
    const nodes = await fsList(path);
    const turns: ConversationTurn[] = [];
    const tPrefix = `${path}/`;
    for (const node of nodes) {
      if (node.is_dir) continue;
      // Depth-1 filter -- fs_list is recursive.
      const tail = node.path.startsWith(tPrefix) ? node.path.slice(tPrefix.length) : "";
      if (!tail || tail.includes("/")) continue;
      if (!node.name.endsWith(".json")) continue;
      if (node.name.includes(".server.")) continue;
      try {
        const raw = await fsRead(node.path);
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          const attachments = Array.isArray((parsed as { attachments?: unknown }).attachments)
            ? ((parsed as { attachments?: unknown[] }).attachments ?? []).filter(
                (v): v is string => typeof v === "string",
              )
            : undefined;
          turns.push({
            id: typeof parsed.id === "string" ? parsed.id : node.name,
            ticketId: typeof parsed.ticketId === "string" ? parsed.ticketId : ticketId,
            role: typeof parsed.role === "string" ? parsed.role : "asker",
            sender: typeof parsed.sender === "string" ? parsed.sender : "",
            timestamp: typeof parsed.timestamp === "string" ? parsed.timestamp : "",
            body: typeof parsed.body === "string" ? parsed.body : "",
            ...(attachments && attachments.length > 0 ? { attachments } : {}),
          });
        }
      } catch {
        /* skip unparseable */
      }
    }
    if (turns.length > 0) {
      hasTurns = true;
      turns.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      return { kind: "conversation-thread", ticketId, turns };
    }
  } catch {
    /* no conversation folder — fall through to ticket detail */
  }

  // No conversation turns (manually created ticket or empty thread).
  // Fall back to the ticket JSON as a datastore-row detail card.
  if (!hasTurns) {
    // Derive repo from the conversation path:
    // path = <repo>/databases/conversations/<ticketId>
    const convIdx = path.indexOf("/databases/conversations/");
    if (convIdx >= 0) {
      const repo = path.slice(0, convIdx);
      const ticketPath = `${repo}/databases/tickets/${ticketId}.json`;
      try {
        const raw = await fsRead(ticketPath);
        const content = JSON.parse(raw);
        let schema;
        try {
          const schemaRaw = await fsRead(`${repo}/databases/tickets/_schema.json`);
          schema = JSON.parse(schemaRaw);
        } catch { /* no schema */ }
        return {
          kind: "datastore-row",
          collection: { id: "", name: "tickets", type: "datastore", numItems: 0, schema },
          item: { id: ticketId, key: ticketId, content, createdAt: "", updatedAt: "" },
        };
      } catch {
        /* ticket JSON also missing — fall through to file */
      }
    }
  }

  return { kind: "file", path };
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
    const colPrefix = `${path}/`;
    for (const node of nodes) {
      if (node.is_dir || node.name === "_schema.json") continue;
      // Depth-1 filter -- fs_list walks recursively, so without this
      // a collection like `conversations` would slurp every msg file
      // out of every thread folder as if it were a top-level row.
      const tail = node.path.startsWith(colPrefix) ? node.path.slice(colPrefix.length) : "";
      if (!tail || tail.includes("/")) continue;
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
    const dbChildPrefix = `${path}/`;
    for (const sd of subdirs) {
      if (!sd.is_dir) continue;
      // fs_list walks recursively, so the raw subdir list contains
      // every nested folder (e.g. each conversation thread under
      // `conversations/`). Keep only direct children of `databases/`
      // -- those are the actual collections.
      const tail = sd.path.startsWith(dbChildPrefix) ? sd.path.slice(dbChildPrefix.length) : "";
      if (!tail || tail.includes("/")) continue;
      // Hide the `conversations` collection from the databases
      // overview. Conversations are folder-of-msg-*.json data tied
      // to a specific ticket; the ticket-list view (which we route
      // `databases/tickets` to below) shows them aggregated as
      // chat-thread cards. Showing both was repetitive.
      if (sd.name === "conversations") continue;
      let itemCount = 0;
      let hasSchema = false;
      try {
        const inner = await fsList(sd.path);
        const innerPrefix = `${sd.path}/`;
        for (const node of inner) {
          // Same depth-1 filter as above -- counting `inner`
          // recursively would over-count (every msg-*.json inside
          // every thread for `conversations`, etc.).
          const innerTail = node.path.startsWith(innerPrefix) ? node.path.slice(innerPrefix.length) : "";
          if (!innerTail || innerTail.includes("/")) continue;
          if (node.name === "_schema.json") {
            hasSchema = true;
            continue;
          }
          // Conversations is a folder-of-folders (one dir per
          // ticketId, msg-*.json files inside) so use dir count
          // there. For everything else count row files.
          if (sd.name === "conversations") {
            if (node.is_dir) itemCount += 1;
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
    // Sort alphabetically so the order is deterministic -- built-ins
    // (conversations / people / tickets) end up adjacent and any
    // user-created collections fall in their natural place.
    collections.sort((a, b) => a.name.localeCompare(b.name));
    return { kind: "databases-list", collections };
  } catch {
    return { kind: "databases-list", collections: [] };
  }
}
