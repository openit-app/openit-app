import { fsRead, fsList } from "../../../lib/api";
import type { ViewerSource } from "../../viewerTypes";
import type { TraceDoc } from "../../viewerTypes";

/**
 * .openit/agent-traces/ parent -- list all ticket trace folders
 */
export async function resolveTracesList(
  path: string,
  repo: string,
): Promise<ViewerSource | null> {
  const folders: { name: string; subject: string; path: string; traceCount: number }[] = [];
  try {
    const nodes = await fsList(path);
    const prefix = `${path}/`;
    for (const n of nodes) {
      if (!n.is_dir) continue;
      const tail = n.path.startsWith(prefix) ? n.path.slice(prefix.length) : "";
      if (!tail || tail.includes("/")) continue;
      let traceCount = 0;
      try {
        const inner = await fsList(n.path);
        const innerPrefix = `${n.path}/`;
        for (const f of inner) {
          if (f.is_dir) continue;
          const innerTail = f.path.startsWith(innerPrefix) ? f.path.slice(innerPrefix.length) : "";
          if (!innerTail || innerTail.includes("/")) continue;
          if (f.name.endsWith(".json")) traceCount += 1;
        }
      } catch { /* */ }
      // Read ticket subject for a human-readable card title
      let subject = n.name;
      try {
        const ticketRaw = await fsRead(`${repo}/databases/tickets/${n.name}.json`);
        const ticket = JSON.parse(ticketRaw);
        if (ticket && typeof ticket.subject === "string" && ticket.subject) {
          subject = ticket.subject;
        }
      } catch { /* missing ticket — keep ticketId fallback */ }
      folders.push({ name: n.name, subject, path: n.path, traceCount });
    }
  } catch { /* dir doesn't exist yet */ }
  folders.sort((a, b) => b.name.localeCompare(a.name)); // newest first
  return { kind: "traces-list" as const, folders };
}

/**
 * .openit/agent-traces/<ticketId>/ (folder) -- agent-trace-list:
 * every per-turn trace for this ticket, oldest-first, stacked
 * with separators in the viewer.
 */
export async function resolveTraceFolder(
  path: string,
  repo: string,
  ticketId: string,
): Promise<ViewerSource> {
  let subject = ticketId;
  try {
    const ticketRaw = await fsRead(`${repo}/databases/tickets/${ticketId}.json`);
    const ticket = JSON.parse(ticketRaw);
    if (ticket && typeof ticket.subject === "string" && ticket.subject) {
      subject = ticket.subject;
    }
  } catch { /* missing ticket file -- keep ticketId fallback */ }
  let docs: { name: string; doc: TraceDoc | null }[] = [];
  try {
    const nodes = await fsList(path);
    const prefix = `${path}/`;
    const direct = nodes
      .filter((n) => {
        if (n.is_dir) return false;
        const tail = n.path.startsWith(prefix) ? n.path.slice(prefix.length) : "";
        if (!tail || tail.includes("/")) return false;
        return n.name.endsWith(".json");
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    docs = await Promise.all(
      direct.map(async (n) => {
        try {
          const raw = await fsRead(n.path);
          return { name: n.name, doc: JSON.parse(raw) as TraceDoc };
        } catch {
          return { name: n.name, doc: null };
        }
      }),
    );
  } catch { /* folder vanished -- empty list */ }
  return { kind: "agent-trace-list", ticketId, subject, docs };
}

/**
 * .openit/agent-traces/<ticketId>/<isoStamp>.json -- agent-trace
 * Lets admins click a per-turn trace file in the file explorer
 * and land on the same timeline visualization the activity-banner
 * click-through uses. Subject is best-effort: read the ticket
 * file for its `subject`, fall back to ticketId.
 */
export async function resolveTraceFile(
  path: string,
  repo: string,
  ticketId: string,
): Promise<ViewerSource> {
  let doc: TraceDoc | null = null;
  try {
    const raw = await fsRead(path);
    doc = JSON.parse(raw) as TraceDoc;
  } catch {
    /* unparseable -- viewer renders the placeholder */
  }
  let subject = ticketId;
  try {
    const ticketRaw = await fsRead(`${repo}/databases/tickets/${ticketId}.json`);
    const ticket = JSON.parse(ticketRaw);
    if (ticket && typeof ticket.subject === "string" && ticket.subject) {
      subject = ticket.subject;
    }
  } catch { /* missing ticket file -- keep ticketId fallback */ }
  return { kind: "agent-trace", ticketId, subject, doc };
}
