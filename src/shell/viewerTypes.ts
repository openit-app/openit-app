import type { DataCollection, MemoryItem } from "../lib/localTypes";
import type { TaskSummary } from "../lib/tasks";

/// Mirrors `agent_trace::TraceEvent` on the Rust side. Persisted at
/// `traces/<ticketId>/<startedAt>.json` per turn; the
/// agent-trace viewer reads the latest one. The on-disk layout still
/// uses `ticketId` as the folder name (intake-server lineage); the new
/// task UI never produces traces, so this only surfaces traces that
/// the chat intake server has already written.
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
  // Tasks — the new Inbox. Linear-style flat list with three statuses
  // (todo / in-progress / complete). Replaces the bespoke ticket model.
  // Resolved when the user opens `tasks/` (workstation tile or file
  // explorer click on the top-level `tasks/` folder).
  | { kind: "tasks-list"; tasks: TaskSummary[] }
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
  // running this chat turn). Resolved when the user opens a
  // `traces/<ticketId>/<isoStamp>.json` file. `doc` may be null on the
  // very first click before any turn has finished — the viewer shows
  // a "composing first reply" placeholder, and the fs-watcher tick
  // re-resolves the source once the file lands.
  | {
      kind: "agent-trace";
      ticketId: string;
      subject: string;
      doc: TraceDoc | null;
    }
  // All traces for a single ticket folder, oldest-first. Surfaced when
  // the admin clicks `traces/<ticketId>/` in the file explorer — the
  // viewer renders each turn's trace stacked with a separator.
  | {
      kind: "agent-trace-list";
      ticketId: string;
      subject: string;
      docs: { name: string; doc: TraceDoc | null }[];
    }
  // Top-level entity folder (knowledge-base/, filestore/).
  // Carries the files inside so the viewer can either show a list or a
  // friendly empty-state notice.
  | {
      kind: "entity-folder";
      // Top-level entity folders that render a card list. `library`
      // is the curated filestore collection (`filestores/library/`);
      // `knowledge` / `knowledge-base` covers the flat
      // `knowledge/` directory; `reports` carries on-demand generated
      // markdown reports — sorted newest-first by filename instead of
      // alphabetically.
      entity:
        | "knowledge"
        | "knowledge-base"
        | "library"
        | "reports"
        | "skills"
        | "scripts";
      // Repo-relative path the resolver matched.
      path: string;
      // displayName drops the file extension and falls back to the
      // filename; description is the entity's `description` field, or
      // the first markdown heading for knowledge-base, or empty for
      // library.
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
  // with item counts and routes clicks to the per-collection viewer.
  | { kind: "databases-list"; collections: { name: string; path: string; itemCount: number; hasSchema: boolean }[] }
  // Top-level `filestores/` directory — mirrors `databases-list`.
  | { kind: "filestores-list"; collections: { name: string; displayName: string; path: string; itemCount: number; itemNoun: string; description: string; isBuiltin: boolean }[] }
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
