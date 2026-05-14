import type { DataCollection, MemoryItem, Agent, Workflow } from "../lib/localTypes";

/// Mirrors `agent_trace::TraceEvent` on the Rust side. Persisted at
/// `traces/<ticketId>/<startedAt>.json` per turn; the
/// agent-activity banner click-through opens the latest one in the
/// viewer.
export type TraceEvent = {
  ts: string;
  kind: string;
  tool?: string;
  verb?: string;
  raw?: unknown;
  text?: string;
};

export type TraceDoc = {
  ticket_id: string;
  turn_id: string;
  started_at: string;
  completed_at: string;
  model: string;
  outcome: string;
  events: TraceEvent[];
};

/// One conversation turn — sender, role, body, timestamp. The thread
/// view orders these by timestamp and renders them as chat bubbles.
export type ConversationTurn = {
  id: string;
  ticketId: string;
  role: "asker" | "agent" | "admin" | "system" | string;
  sender: string;
  timestamp: string;
  body: string;
  /// Repo-relative paths to attachments associated with this turn —
  /// e.g. `filestores/attachments/<ticketId>/<filename>`. Asker
  /// uploads land here via `/chat/upload`; admin replies sent from
  /// the desktop composer write attachments through `entityWriteFile`
  /// to the same path. Empty / missing when the turn has no
  /// attachments.
  attachments?: string[];
};

/// Summary of a single conversation thread, shown as a clickable card
/// in the conversations-list view (one row per thread). Clicking opens
/// the chat-thread view for that ticketId.
export type PersonSummary = {
  /// File-stem key (e.g. the email-as-id used for the person row).
  key: string;
  name: string;
  email: string;
  role: string;
  department: string;
  channels: string[];
};

export type AccessSummary = {
  key: string;
  action: string;    // "onboard" or "offboard"
  employee: string;
  email: string;
  role: string;
  date: string;
};

export type AssetSummary = {
  key: string;
  name: string;
  type: string;       // "laptop", "monitor", etc.
  serialNumber: string;
  assignedTo: string;
  status: string;     // "assigned", "available", etc.
};

export type ConversationThreadSummary = {
  ticketId: string;
  // Subject pulled from the ticket file; falls back to the first
  // message body if the ticket isn't readable yet.
  subject: string;
  // Asker label from the ticket; empty when the ticket file is missing.
  asker: string;
  // Status from the ticket — drives a status pill on the card.
  status: string;
  // ticket.createdAt or fallback to the thread folder's first turn.
  createdAt: string;
  // Newest turn's timestamp — used for sort + "last activity" label.
  lastTurnAt: string;
  // Number of msg-*.json files under the thread folder.
  turnCount: number;
  // Free-form labels from the ticket. Includes `auto-escalated` when
  // the stale-open scan flipped this ticket — the only signal on the
  // card that "escalated" means "timed out" vs "agent gave up".
  tags: string[];
};

export type ViewerSource =
  | { kind: "file"; path: string }
  | { kind: "sync"; lines: string[] }
  | { kind: "diff"; text: string }
  | {
      kind: "script-output";
      /** Absolute path of the .mjs that was executed. */
      script: string;
      stdout: string;
      stderr: string;
      exitCode: number;
      durationMs: number;
    }
  | {
      /** In-memory file stub created by the "New" button — no bytes
       *  on disk yet. The Viewer renders an edit textarea seeded with
       *  `initialContent`; Save writes the file and routes to a real
       *  `kind: "file"` source. Cancel discards without ever creating
       *  the file. Lets the user audit / paste / edit the template
       *  before committing — no phantom file if they back out. */
      kind: "draft-file";
      /** Absolute path the file will land at on Save. */
      path: string;
      /** Repo-relative subdir for `entity_write_file`. Pre-computed
       *  by the New-button handler so the draft view doesn't have to
       *  parse the path back apart on Save. */
      subdir: string;
      /** Filename portion (e.g. `untitled.mjs`). Same rationale. */
      filename: string;
      /** Pre-filled textarea content. */
      initialContent: string;
      /** When the draft is a new datastore row, carry the collection so
       *  we can render a structured RowEditForm instead of a raw textarea. */
      collection?: DataCollection;
    }
  | { kind: "datastore-table"; collection: DataCollection; items?: MemoryItem[]; hasMore?: boolean; onLoadMore?: () => void }
  | { kind: "datastore-row"; collection: DataCollection; item: MemoryItem }
  | { kind: "datastore-schema"; collection: DataCollection }
  // path is the on-disk JSON file (`agents/<name>.json` /
  // `workflows/<name>.json`) the resolver matched. Carried through so
  // the file explorer can highlight the matching row when the agent /
  // workflow card is open on the canvas — without it, sourceToTreePath
  // has no way to derive the path from AgentRow/WorkflowRow alone.
  | { kind: "agent"; agent: Agent; path: string }
  | { kind: "workflow"; workflow: Workflow; path: string }
  | { kind: "conversation-thread"; ticketId: string; turns: ConversationTurn[] }
  | { kind: "conversations-list"; threads: ConversationThreadSummary[]; collection?: DataCollection }
  // People directory — one row per contact. Default view is cards
  // (name + email + role/department); the header has a Cards / Table
  // toggle so admins can flip into the raw datastore-table when they
  // need to see every column. The `collection` mirrors what the
  // datastore-table source carries so the table view can render
  // without re-resolving.
  | {
      kind: "people-list";
      view: "cards" | "table";
      people: PersonSummary[];
      collection: DataCollection;
      items: MemoryItem[];
    }
  // Access log — one row per onboard/offboard action. Same
  // Cards / Table toggle as people-list.
  | {
      kind: "access-list";
      view: "cards" | "table";
      records: AccessSummary[];
      collection: DataCollection;
      items: MemoryItem[];
    }
  // Asset inventory — one row per device / piece of equipment. Same
  // Cards / Table toggle as people-list.
  | {
      kind: "assets-list";
      view: "cards" | "table";
      records: AssetSummary[];
      collection: DataCollection;
      items: MemoryItem[];
    }
  // Per-turn agent trace (the verbs + timestamps the agent emitted
  // running this chat turn). Opened by clicking the agent-activity
  // banner; resolves to the most recent trace file under
  // `traces/<ticketId>/`. `doc` may be null on the
  // very first click before any turn has finished — the viewer shows
  // a "composing first reply" placeholder, and the fs-watcher tick
  // re-resolves the source once the file lands.
  | {
      kind: "agent-trace";
      ticketId: string;
      subject: string;
      doc: TraceDoc | null;
    }
  // All traces for a single ticket, oldest-first. Surfaced when the
  // admin clicks `traces/<ticketId>/` in the file
  // explorer — the viewer renders each turn's trace stacked with a
  // separator. Each entry carries the source filename so the header
  // can show "turn 3 (2026-04-28T20:09:43Z)".
  | {
      kind: "agent-trace-list";
      ticketId: string;
      subject: string;
      docs: { name: string; doc: TraceDoc | null }[];
    }
  // Top-level entity folder (agents/, workflows/, knowledge-base/, filestore/).
  // Carries the files inside so the viewer can either show a list or a
  // friendly empty-state notice — the same affordance the conversations-
  // list provides for the databases/conversations folder.
  | {
      kind: "entity-folder";
      // Top-level entity folders that render a card list. `library`
      // is the curated filestore collection (`filestores/library/`);
      // `knowledge` / `knowledge-base` covers the flat
      // `knowledge/` directory; the operational
      // `filestores/attachments/` collection has its own ticketid-
      // grouped renderer and isn't part of this set. `reports`
      // carries on-demand generated markdown reports — sorted
      // newest-first by filename instead of alphabetically.
      entity:
        | "agents"
        | "workflows"
        | "knowledge"
        | "knowledge-base"
        | "library"
        | "reports"
        | "skills"
        | "scripts"
        | "attachments-ticket";
      // Repo-relative path the resolver matched.
      path: string;
      // displayName drops the file extension and falls back to the
      // entity's own `name` field when readable (agents/workflows JSON);
      // description is the entity's `description` field, or the first
      // markdown heading for knowledge-base, or empty for library.
      files: {
        name: string;
        displayName: string;
        description: string;
        path: string;
        /** Bytes on disk; null when the platform call hasn't returned
         *  a stat (legacy fallback path or unreadable file). The
         *  viewer hides the size suffix when null. */
        size?: number | null;
      }[];
    }
  // Top-level `databases/` directory. Each collection is its own
  // subfolder (databases/<col>/) — the parent view shows them as cards
  // with item counts and routes clicks to the per-collection viewer
  // (datastore-table or conversations-list, whichever the child
  // resolver picks up).
  | { kind: "databases-list"; collections: { name: string; path: string; itemCount: number; hasSchema: boolean }[] }
  // Top-level `filestores/` directory — mirrors `databases-list`.
  // `attachments` and `library` ship as built-ins (special-cased for
  // copy + counting semantics); the resolver also enumerates any
  // user-created collection (`mkdir filestores/foo`) so the UI
  // gracefully surfaces them with a generic description.
  | { kind: "filestores-list"; collections: { name: string; displayName: string; path: string; itemCount: number; itemNoun: string; description: string; isBuiltin: boolean }[] }
  // `filestores/attachments/` view: introductory copy explaining the
  // collection's purpose plus a list of per-ticket subfolders (each
  // is a clickable card that jumps to the matching conversation
  // thread). This is what surfaces when the admin clicks the
  // attachments folder in the explorer.
  | { kind: "attachments-folder"; tickets: { ticketId: string; path: string; fileCount: number }[] }
  // Legacy type kept for compat — no longer produced by the resolver.
  | { kind: "knowledge-list"; collections: { name: string; path: string; itemCount: number; description: string; isBuiltin: boolean }[] }
  // Tools — the tools catalog. Backed by `which` detection rather
  // than a real on-disk directory; the resolver matches the synthetic
  // path `<repo>/tools` and routes here. The viewer renders <ToolsPanel>
  // which lists installed tools with brew install/uninstall affordances.
  // Reachable via the Workbench station only — there's no `tools/` dir in
  // the file explorer.
  | { kind: "tools" }
  | { kind: "skills-station" }
  | { kind: "commands-station" }
  | { kind: "scripts-station" }
  | { kind: "traces-list"; folders: { name: string; subject: string; path: string; traceCount: number }[] }
  | null;
