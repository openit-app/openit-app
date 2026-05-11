import { useEffect, useRef, useState, type ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { fsRead, fsReadBytes, fsList, fsReveal, reportOverviewRun, entityDeleteFile, entityRemoveDir } from "../lib/api";
import type { MemoryItem, Agent } from "../lib/localTypes";
import { EntityCardGrid } from "./EntityCardGrid";
import { EntityBadge, type EntityKind } from "./entityIcons";
import { ToolsPanel } from "./ToolsPanel";
import { CommandsStation, SkillsStation } from "./SkillsStation";
import { ScriptsStation } from "./ScriptsStation";
import { useToast } from "../Toast";
import { Button, TabStrip, Tab } from "../ui";
import { RowEditForm } from "./RowEditForm";
import {
  ImageViewer,
  PdfViewer,
  SpreadsheetViewer,
  OfficeViewer,
  AgentRenderedView,
  AgentEditForm,
  AgentRawView,
  loadAgentEditState,
  saveAgentEditDraft,
  BRACKETED_PASTE_OPEN,
  BRACKETED_PASTE_CLOSE,
  ENTITY_FOLDER_LABELS,
  NEW_FILE_TEMPLATES,
  ExternalAnchor,
  isMarkdown,
  isJsonFile,
  isRunnableScript,
  hasEditableTextMode,
  isImage,
  isPdf,
  isSpreadsheet,
  isOfficeDoc,
  mimeForPath,
  toRepoRelative,
  confirmDelete,
  uploadFilesToSubdir,
  ConversationsListBody,
  ConversationThreadBody,
  DatastoreTableBody,
  DatastoreRowBody,
  DatastoreSchemaBody,
  PeopleListBody,
  AccessListBody,
  AssetsListBody,
  AgentTraceBody,
  AgentTraceListBody,
  EntityFolderBody,
} from "./viewers";
import type { ViewMode } from "./viewers";
import { DiffViewer } from "./DiffViewer";
import { writeToActiveSession } from "./activeSession";
import { injectIntoChat } from "../lib/skillState";
import { PaneBody } from "../ui";
import { BreadcrumbAncestors } from "./Breadcrumbs";
import type { ViewerSource } from "./viewerTypes";

export type { ViewerSource };

export function Viewer({
  source,
  repo,
  fsTick,
  intakeUrl,
  welcomeFlashKey,
  onOpenPath,
  onShowSource,
  onGoBack,
  onGoForward,
  canGoBack,
  canGoForward,
  onFsChange,
}: {
  source: ViewerSource;
  repo: string;
  fsTick?: number;
  /** Local intake server URL for `{{INTAKE_URL}}` substitution. */
  intakeUrl?: string | null;
  /** Bumped by the parent when the user clicks "Getting Started" while the
   *  welcome doc is already the active source. Triggers a one-shot flash
   *  animation so the click doesn't look like a no-op. */
  welcomeFlashKey?: number;
  /** Open another path in the viewer (used by the conversations-list
   *  cards to drill into a specific thread). Optional — falls back to
   *  no-op if the parent didn't wire it. */
  onOpenPath?: (path: string) => void | Promise<void>;
  /** Programmatically route the viewer to a non-path source (e.g.
   *  the captured stdout/stderr of a script run). The parent owns
   *  the source state, so a card-level handler can't call setSource
   *  directly — this prop is the escape hatch. */
  onShowSource?: (source: ViewerSource) => void;
  /** Browser-style back/forward across the center-pane view history.
   *  Wired by Shell so every page gets the same pair of arrows in
   *  the viewer header instead of relying on per-page back buttons. */
  onGoBack?: () => void;
  onGoForward?: () => void;
  canGoBack?: boolean;
  canGoForward?: boolean;
  /** Bump the parent fs-tick so listings re-scan after a delete. */
  onFsChange?: () => void;
}) {
  const [content, setContent] = useState<string>("");
  const [binaryData, setBinaryData] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewMode>("rendered");

  // Self-loaded table data for datastore-table
  const [tableItems, setTableItems] = useState<MemoryItem[]>([]);
  const [tableHasMore, setTableHasMore] = useState(false);
  const [tableLoading, _setTableLoading] = useState(false);

  // Live override of the row content for datastore-row sources. Source
  // captures the row at click time; this gets populated when the
  // on-disk file changes (fsTick) so the table/raw view updates
  // without re-clicking.
  const [rowOverride, setRowOverride] = useState<MemoryItem | null>(null);
  // Filter for the conversations-list view. `all` shows every thread;
  // the others narrow by ticket status. Persists across click+reopen
  // of the conversations folder within the same session, but resets
  // when the project (repo) changes — the filter is per-project, not
  // global.
  const [conversationsFilter, setConversationsFilter] =
    useState<"all" | "open" | "resolved" | "escalated">("all");
  useEffect(() => {
    setConversationsFilter("all");
  }, [repo]);

  // People view-mode toggle (Cards / Table). Default cards; sticks
  // for the lifetime of this Viewer instance so flipping into a
  // ticket and back doesn't reset the admin's preferred mode.
  const [peopleView, setPeopleView] = useState<"cards" | "table">("cards");
  const [accessView, setAccessView] = useState<"cards" | "table">("cards");
  const [assetsView, setAssetsView] = useState<"cards" | "table">("cards");

  // Edit-mode state for the markdown viewer. `editDraft` is the
  // textarea value (decoupled from `content` so unsaved edits don't
  // race with disk re-reads). `editSaving` shows a brief saving
  // indicator on the Save button. Both reset whenever the source
  // changes — opening a different file mid-edit discards the draft
  // (matches what most code editors do without an explicit prompt).
  const [editDraft, setEditDraft] = useState<string>("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  // Inline rename state for the file-title in the viewer-header.
  // `renamingPath` is the source path the user is currently editing
  // (null when not renaming). `renameDraft` is the textbox value.
  // Both reset whenever the source changes — opening a different file
  // mid-rename discards the draft.
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState<string>("");
  const [renameError, setRenameError] = useState<string | null>(null);
  useEffect(() => {
    setRenamingPath(null);
    setRenameDraft("");
    setRenameError(null);
  }, [source]);

  // Parallel state for row-edit mode — keyed by field id, mirrors the
  // row content. Stored as `unknown` per field so `string[]`,
  // booleans, etc. round-trip without coercion until save.
  const [rowEditDraft, setRowEditDraft] = useState<Record<string, unknown>>({});

  // Agent-edit draft + post-save override. Mirrors the rowEditDraft /
  // rowOverride pattern but for the agent panel: draft holds the
  // in-flight form values, override flips the rendered/raw view to the
  // saved content without waiting for the FS watcher to re-read disk.
  //
  // V2 fans the draft across structured fields plus the three .md
  // instruction blocks (common / cloud / local). The full triage.json
  // payload is captured in `loadedJson` so `unknown array entries`
  // (extra MCP servers, extra resources added on web) round-trip
  // unchanged through Save.
  const [agentEditDraft, setAgentEditDraft] = useState<{
    description: string;
    common: string;
    cloud: string;
    local: string;
    selectedModel: string;
    isShared: boolean;
    promptExamples: string;
    introMessage: string;
    knowledgeBases: { name: string; canRead: boolean; canWrite: boolean; canDelete: boolean }[];
    datastores: { name: string; canRead: boolean; canWrite: boolean; canDelete: boolean }[];
    filestores: { name: string; canRead: boolean; canWrite: boolean; canDelete: boolean }[];
    servers: { name: string; allTools: boolean }[];
  }>({
    description: "",
    common: "",
    cloud: "",
    local: "",
    selectedModel: "",
    isShared: false,
    promptExamples: "",
    introMessage: "",
    knowledgeBases: [],
    datastores: [],
    filestores: [],
    servers: [],
  });
  // Snapshot of the original disk state at Edit-tab open. Save uses it
  // to diff form fields against loaded values and write only changed
  // files. Holds the full parsed JSON + each .md verbatim.
  const [agentEditLoaded, setAgentEditLoaded] = useState<{
    json: Record<string, unknown>;
    common: string;
    cloud: string;
    local: string;
  } | null>(null);
  // Lists of cloud collections for the resource pickers — fetched on
  // Edit-tab open. Empty until loaded.
  const [agentEditKbs, setAgentEditKbs] = useState<string[] | null>(null);
  const [agentEditDss, setAgentEditDss] = useState<string[] | null>(null);
  const [agentEditFss, setAgentEditFss] = useState<string[] | null>(null);
  const [agentOverride, setAgentOverride] = useState<Agent | null>(null);

  // Admin email for the conversation thread sub-viewer.
  const [adminEmail, setAdminEmail] = useState<string | null>(null);
  const [folderUploadError, setFolderUploadError] = useState<string | null>(null);
  // v5: the in-viewer ToastView was removed. The global ToastProvider
  // (mounted in main.tsx via src/Toast.tsx) renders all toasts at the
  // window's bottom-right via the unified <Toast> primitive.
  const { show: showToast } = useToast();
  // "Generate overview" button state on the reports/ entity-folder
  // view. Run kicks off the local script via the Tauri command and,
  // on success, jumps the viewer to the freshly-written file. fsTick
  // wakes the explorer so the new file appears in the tree.
  const [reportRunning, setReportRunning] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  // Inline "+ New" for filestores and databases lists.
  const [newCollectionKind, setNewCollectionKind] = useState<null | "filestore" | "database">(null);
  const [newCollectionName, setNewCollectionName] = useState("");
  // Auto-scroll the sync log to the bottom whenever new lines arrive
  // — without this, watching a multi-class push from the top of the
  // pane means the latest lines fall below the fold and the user has
  // to scroll manually for every click. Only fires when the sync
  // source is active; other raw renders (diff, schema) keep default
  // scroll behaviour. The <pre> itself doesn't scroll — PaneBody is
  // the scroll container per `.viewer-content` styling — so we walk
  // up to the closest overflow-scroll ancestor and pin it to the
  // bottom.
  //
  // Depend on `content`, not `source`. The content-loading effect
  // below also depends on `[source]`, runs in declaration order
  // AFTER this one, and is what calls `setContent(...)` for sync
  // sources. If we depend on `[source]` here, our scroll runs while
  // the DOM still shows the previous content — `scrollHeight`
  // reads the old height and the bottom-pin lags by a render. Keying
  // on `content` re-runs after the setContent re-render so the DOM
  // is up to date by the time we measure. (BugBot iter 4.)
  const syncPreRef = useRef<HTMLPreElement | null>(null);
  useEffect(() => {
    if (source?.kind !== "sync") return;
    const el = syncPreRef.current;
    if (!el) return;
    let p: HTMLElement | null = el.parentElement;
    while (p) {
      const overflowY = window.getComputedStyle(p).overflowY;
      if (overflowY === "auto" || overflowY === "scroll") {
        p.scrollTop = p.scrollHeight;
        return;
      }
      p = p.parentElement;
    }
  }, [source, content]);
  useEffect(() => {
    setFolderUploadError(null);
    // Reset the Generate-overview button alongside the other view-
    // specific state so a stale failure message doesn't follow the
    // user when they navigate away from reports/ and back.
    setReportRunning(false);
    setReportError(null);
    setNewCollectionKind(null);
    setNewCollectionName("");
  }, [source]);
  useEffect(() => {
    // Fetch the admin's email once and cache it so the composer
    // doesn't re-invoke for every thread open. Falls back to "admin"
    // if user.email isn't set globally.
    let cancelled = false;
    (async () => {
      try {
        const { globalUserEmail } = await import("../lib/api");
        const email = await globalUserEmail();
        if (!cancelled) setAdminEmail(email);
      } catch {
        /* leave as null — composer falls back to "admin" */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    setEditDraft("");
    setRowEditDraft({});
    setEditSaving(false);
    setEditError(null);
  }, [source]);
  // Reset on source change so a new click clears the previous override.
  useEffect(() => setRowOverride(null), [source]);
  useEffect(() => setAgentOverride(null), [source]);

  useEffect(() => {
    setError(null);
    setBinaryData(null);
    if (!source) {
      setContent("");
      return;
    }
    if (source.kind === "file") {
      let cancelled = false;
      const path = source.path;

      if (isImage(path) || isPdf(path) || isSpreadsheet(path)) {
        setMode("rendered");
        fsReadBytes(path)
          .then((bytes) => !cancelled && setBinaryData(bytes))
          .catch((e) => !cancelled && setError(String(e)));
        return () => { cancelled = true; };
      }
      if (isOfficeDoc(path)) {
        setMode("rendered");
        setContent("");
        return;
      }
      // Runnable scripts default into edit mode and stay there —
      // there's no "View" worth toggling for plain code, and the
      // admin came here to edit + run. The textarea draft is
      // seeded from disk in the .then below so Cancel still has
      // something to revert to.
      const runnable = isRunnableScript(path);
      const isWelcomeHtml = path.endsWith("/getting-started.html");
      setMode(runnable ? "edit" : (isMarkdown(path) || isWelcomeHtml) ? "rendered" : "raw");
      fsRead(path)
        .then((c) => {
          if (cancelled) return;
          setContent(c);
          if (runnable) setEditDraft(c);
        })
        .catch((e) => !cancelled && setError(String(e)));
      return () => { cancelled = true; };
    }
    if (source.kind === "sync") {
      setMode("raw");
      setContent(source.lines.join("\n"));
      return;
    }
    if (source.kind === "diff") {
      setMode("raw");
      setContent(source.text);
      return;
    }
    if (source.kind === "script-output") {
      setMode("rendered");
      setContent("");
      return;
    }
    // Draft files: no disk read. Pre-seed the textarea with the
    // template content so the user can audit/edit before Save.
    // `content` stays empty so `isDirty = editDraft !== content` is
    // true on first paint — Save lights up immediately, no need for
    // the user to wiggle the cursor before they can commit.
    if (source.kind === "draft-file") {
      setMode("edit");
      setContent("");
      setEditDraft(source.initialContent);
      // When the draft carries a collection (datastore +New), seed
      // the structured form draft so RowEditForm renders pre-filled.
      if (source.collection) {
        try {
          setRowEditDraft(JSON.parse(source.initialContent));
        } catch {
          setRowEditDraft({});
        }
      }
      return;
    }
    if (source.kind === "datastore-table") {
      setMode("table");
      setContent("");
      setTableItems(source.items ?? []);
      setTableHasMore(false);
      return;
    }
    if (source.kind === "datastore-row") {
      // Default to the table-style key/value view — easier to read at a
      // glance than raw JSON. Users who want raw JSON can click the
      // Raw tab.
      setMode("table");
      const raw = source.item.content;
      if (raw == null) {
        setContent("{}");
      } else if (typeof raw === "object") {
        setContent(JSON.stringify(raw, null, 2));
      } else {
        try {
          setContent(JSON.stringify(JSON.parse(raw as string), null, 2));
        } catch {
          setContent(String(raw));
        }
      }
      return;
    }
    if (source.kind === "datastore-schema") {
      setMode("raw");
      setContent(JSON.stringify(source.collection.schema, null, 2));
      return;
    }
    if (source.kind === "agent") {
      setMode("rendered");
      setContent("");
      return;
    }
    if (source.kind === "workflow") {
      setMode("rendered");
      setContent("");
      return;
    }
    if (source.kind === "conversation-thread") {
      setMode("rendered");
      setContent("");
      return;
    }
    if (source.kind === "conversations-list") {
      setMode("rendered");
      setContent("");
      return;
    }
    if (source.kind === "entity-folder") {
      setMode("rendered");
      setContent("");
      return;
    }
    if (source.kind === "databases-list") {
      setMode("rendered");
      setContent("");
      return;
    }
    if (source.kind === "filestores-list") {
      setMode("rendered");
      setContent("");
      return;
    }
    if (source.kind === "attachments-folder") {
      setMode("rendered");
      setContent("");
      return;
    }
    if (source.kind === "knowledge-bases-list") {
      setMode("rendered");
      setContent("");
      return;
    }
    if (source.kind === "agent-trace") {
      setMode("rendered");
      setContent("");
      return;
    }
    if (source.kind === "people-list") {
      setMode("rendered");
      setContent("");
      return;
    }
    if (source.kind === "access-list") {
      setMode("rendered");
      setContent("");
      return;
    }
    if (source.kind === "assets-list") {
      setMode("rendered");
      setContent("");
      return;
    }
    if (source.kind === "tools") {
      setMode("rendered");
      setContent("");
      return;
    }
    if (source.kind === "skills-station") {
      setMode("rendered");
      setContent("");
      return;
    }
    if (source.kind === "commands-station") {
      setMode("rendered");
      setContent("");
      return;
    }
    if (source.kind === "scripts-station") {
      setMode("rendered");
      setContent("");
      return;
    }
    if (source.kind === "traces-list") {
      setMode("rendered");
      setContent("");
      return;
    }
  }, [source]);

  // Re-read the single-row file from disk when fsTick fires. Lets edits
  // by Claude (or any process touching the .json file) reflect in the
  // viewer without the user having to re-click the row.
  useEffect(() => {
    if (!source || source.kind !== "datastore-row" || !repo) return;
    if (fsTick === 0) return;
    const filePath = `${repo}/databases/${source.collection.name}/${source.item.key || source.item.id}.json`;
    let cancelled = false;
    (async () => {
      try {
        const raw = await fsRead(filePath);
        const parsed = JSON.parse(raw);
        if (cancelled) return;
        const merged: MemoryItem = {
          ...source.item,
          content: parsed,
        };
        setRowOverride(merged);
        // Also update raw-mode content so the Raw tab stays current.
        setContent(JSON.stringify(parsed, null, 2));
      } catch (e) {
        // File might have been deleted (server-delete propagated) —
        // leave the existing view rather than error.
        console.warn("[Viewer] row reload failed:", e);
      }
    })();
    return () => { cancelled = true; };
  }, [fsTick, source, repo]);

  // Re-read disk-based datastore tables when filesystem changes (fsTick from native watcher)
  useEffect(() => {
    if (!source || source.kind !== "datastore-table" || source.collection.id || !repo) return;
    // Skip the initial render (fsTick === 0 is handled by the source-loading effect above)
    if (fsTick === 0) return;
    const dirPath = `${repo}/databases/${source.collection.name}`;
    let cancelled = false;

    (async () => {
      try {
        const nodes = await fsList(dirPath);
        const items: MemoryItem[] = [];
        for (const node of nodes) {
          if (node.is_dir || node.name === "_schema.json") continue;
          // Skip conflict shadow files — they're a local-only artifact
          // (`<key>.server.json` written when both sides edit the same
          // row) and showing them as separate table rows misleads the
          // user into thinking the remote has two rows.
          if (node.name.includes(".server.")) continue;
          try {
            const raw = await fsRead(node.path);
            const content = JSON.parse(raw);
            const key = node.name.replace(/\.json$/, "");
            items.push({ id: key, key, content, createdAt: "", updatedAt: "" });
          } catch { /* skip unparseable */ }
        }
        if (!cancelled) setTableItems(items);
      } catch (e) {
        console.warn("[Viewer] fs change reload failed:", e);
      }
    })();

    return () => { cancelled = true; };
  }, [fsTick, source, repo]);

  if (!source) {
    return <div className="viewer empty">Select a file from the explorer</div>;
  }
  if (error) {
    const isNotFound = error.includes("os error 2") || error.includes("No such file") || error.includes("not found");
    return (
      <div className="viewer error">
        {isNotFound
          ? "This file no longer exists. It may have been renamed or deleted."
          : error}
      </div>
    );
  }

  // --- Title ---
  const getTitle = (): string => {
    switch (source.kind) {
      case "file": {
        // Skill files → show "skill-name" instead of "SKILL.md"
        const sm = source.path.match(/\.claude\/skills\/([^/]+)\/SKILL\.md$/);
        if (sm) return sm[1];
        return source.path.split("/").pop() ?? source.path;
      }
      case "sync": return "Sync output";
      case "diff": return "Git diff";
      case "script-output":
        return `Run: ${source.script.split("/").pop() ?? source.script}`;
      case "draft-file": return source.filename;
      case "datastore-table": {
        const n = source.collection?.name ?? "Datastore";
        return n.charAt(0).toUpperCase() + n.slice(1);
      }
      case "datastore-schema":
        return "Schema";
      case "datastore-row": return `${source.item?.key || source.item?.id || "Row"}.json`;
      case "agent": return source.agent?.name ?? "Agent";
      case "workflow": return source.workflow?.name ?? "Workflow";
      case "conversation-thread": return source.ticketId;
      case "conversations-list": return "Inbox";
      case "entity-folder": {
        if (source.entity === "knowledge" || source.entity === "knowledge-base") {
          return "Knowledge";
        }
        return ENTITY_FOLDER_LABELS[source.entity];
      }
      case "databases-list":     return "Databases";
      case "filestores-list":    return "Filestores";
      case "attachments-folder": return "Attachments";
      case "knowledge-bases-list": return "Knowledge";
      case "agent-trace":
        return source.subject || source.ticketId;
      case "agent-trace-list":
        return `${source.subject || source.ticketId} (${source.docs.length} turn${source.docs.length === 1 ? "" : "s"})`;
      case "people-list":        return "People";
      case "access-list":        return "Access";
      case "assets-list":        return "Assets";
      case "tools": return "Tools";
      case "skills-station": return "Skills";
      case "commands-station": return "Commands";
      case "scripts-station": return "Scripts";
      case "traces-list": return "Traces";
      default: return "";
    }
  };
  const title = getTitle();

  // --- Tabs ---
  // Runnable scripts skip the View/Edit toggle (they always render
  // edit mode) — the tab strip would be a single live tab, which is
  // worse than no tabs.
  const showFileTabs =
    (source.kind === "file" &&
      hasEditableTextMode(source.path) &&
      !isRunnableScript(source.path)) ||
    source.kind === "datastore-schema";
  // Is this a command/skill file that can be deleted?
  const isCommandFile =
    source.kind === "file" &&
    (source.path.includes("/filestores/skills/") ||
      source.path.includes("/.claude/skills/"));
  const showRowTabs = source.kind === "datastore-row";
  const showAgentTabs = source.kind === "agent";
  const showPeopleTabs = source.kind === "people-list";
  const showAccessTabs = source.kind === "access-list";
  const showAssetsTabs = source.kind === "assets-list";
  const showConversationsFilter = source.kind === "conversations-list";

  // Path used by the "add to chat →" header link. Any source that maps
  // to a real on-disk file or folder Claude can reference goes through
  // this — keeps the link offer consistent across viewers without
  // per-source render branches in the header.
  const chatAddPath: string | null = (() => {
    if (!source) return null;
    if (source.kind === "file") {
      // Welcome page has no "add to chat" affordance.
      if (source.path.endsWith("/getting-started.html")) return null;
      // Skill files → send as slash command instead of file path
      const skillMatch = source.path.match(/\.claude\/skills\/([^/]+)\/SKILL\.md$/);
      if (skillMatch) return `/${skillMatch[1]}`;
      return source.path;
    }
    if (source.kind === "conversation-thread")
      return `${repo}/databases/conversations/${source.ticketId}`;
    if (source.kind === "datastore-row")
      return `${repo}/databases/${source.collection.name}/${source.item.key || source.item.id}.json`;
    if (source.kind === "datastore-table")
      return `${repo}/databases/${source.collection.name}`;
    if (source.kind === "datastore-schema")
      return `${repo}/databases/${source.collection.name}/_schema.json`;
    if (source.kind === "entity-folder") {
      // Reports and agents don't need "add to chat" on the list view.
      // Reports has its own header actions; agents' "add to chat"
      // belongs on the individual agent file view, not the list.
      if (source.entity === "reports" || source.entity === "agents") return null;
      return `${repo}/${source.path}`;
    }
    if (source.kind === "people-list") return null;
    // Access and assets list views: cards are clickable to edit
    // individual records — "add to chat" on the list is confusing.
    if (source.kind === "access-list") return null;
    if (source.kind === "assets-list") return null;
    if (source.kind === "databases-list")
      return `${repo}/databases`;
    if (source.kind === "filestores-list")
      return `${repo}/filestores`;
    if (source.kind === "conversations-list")
      return `${repo}/databases/conversations`;
    if (source.kind === "agent")
      return source.path;
    if (source.kind === "workflow")
      return `${repo}/workflows/${source.workflow.id || source.workflow.name}.json`;
    return null;
  })();

  // Ticket id for the "Conversation" header link on attachments
  // subfolders (filestores/attachments/<ticketId>/). Lets admins jump
  // from the file list back to the related thread without re-walking
  // the file tree.
  const attachmentsTicketId: string | null =
    source && source.kind === "entity-folder" && source.entity === "attachments-ticket"
      ? source.path.replace(/^filestores\/attachments\//, "")
      : null;

  // "run" affordance in the viewer-subheader for runnable script
  // files (.mjs / .js / .cjs / .py living anywhere — gates on
  // extension, not just the scripts folder, so an admin viewing a
  // script in a sub-folder still gets the same affordance). Same
  // backend as the run-icon on the folder card; routes the viewer
  // to a `script-output` source so the captured streams show up
  // inline.
  const runFileAffordance: { onRun: () => Promise<void> } | null =
    source && source.kind === "file" && repo &&
    /\.(mjs|js|cjs|py)$/i.test(source.path) &&
    onShowSource
      ? (() => {
          const filePath = source.path;
          return {
            onRun: async () => {
              try {
                const { scriptRun } = await import("../lib/api");
                const out = await scriptRun(repo, filePath);
                onShowSource({
                  kind: "script-output",
                  script: filePath,
                  stdout: out.stdout,
                  stderr: out.stderr,
                  exitCode: out.exitCode,
                  durationMs: out.durationMs,
                });
              } catch (err) {
                const reason = err instanceof Error ? err.message : String(err);
                console.error(`[script-run] header run failed:`, err);
                showToast(`Run failed: ${reason}`);
              }
            },
          };
        })()
      : null;

  // "new +" affordance in the viewer-subheader for the scripts /
  // skills folder views. Mirrors the placement of the "add to chat"
  // link so the create action lives at the top-right of the pane,
  // not inside the dropzone where it competed with the drag target.
  // Routes to a `draft-file` source — no file lands on disk until
  // the user clicks Save (so a Cancel on the edit screen leaves
  // nothing behind).
  const newFileAffordance: { onCreate: () => void; title: string } | null =
    source && source.kind === "entity-folder" && repo &&
    (source.entity === "scripts" || source.entity === "skills" || source.entity === "agents" || source.entity === "knowledge" || source.entity === "knowledge-base" || source.entity === "library")
      ? (() => {
          const ext: "mjs" | "md" = source.entity === "scripts" ? "mjs" : "md";
          const subdirAbs = source.path;
          const existing = source.files.map((f) => f.name);
          return {
            title:
              source.entity === "scripts"
                ? "Draft a new script"
                : source.entity === "agents"
                  ? "Draft a new agent"
                  : source.entity === "knowledge" || source.entity === "knowledge-base"
                    ? "Draft a new article"
                    : source.entity === "library"
                      ? "Draft a new file"
                      : "Draft a new skill",
            onCreate: () => {
              if (!onShowSource) return;
              // Pick the first free `untitled[-N].<ext>` against the
              // current listing. The draft is in-memory only — Save
              // will write the file and route to it; if the user
              // Cancels, no file ever lands on disk.
              const relSubdir = toRepoRelative(repo, subdirAbs);
              const taken = new Set(existing);
              let filename = `untitled.${ext}`;
              let i = 2;
              while (taken.has(filename)) {
                filename = `untitled-${i}.${ext}`;
                i += 1;
              }
              const fullPath = relSubdir
                ? `${repo}/${relSubdir}/${filename}`
                : `${repo}/${filename}`;
              onShowSource({
                kind: "draft-file",
                path: fullPath,
                subdir: relSubdir,
                filename,
                initialContent: NEW_FILE_TEMPLATES[ext],
              });
            },
          };
        })()
      : source && source.kind === "datastore-table" && repo && onShowSource
        ? (() => {
            const colName = source.collection.name;
            const subdir = `databases/${colName}`;
            const fields = (source.collection.schema as { fields?: Array<Record<string, unknown>> })?.fields ?? [];
            const template: Record<string, unknown> = {};
            for (const f of fields) {
              const id = f.id as string;
              if (id === "createdAt" || id === "updatedAt") {
                template[id] = new Date().toISOString();
              } else {
                template[id] = "";
              }
            }
            return {
              title: `New ${colName} record`,
              onCreate: () => {
                const items = source.items ?? [];
                const taken = new Set(items.map((i) => `${i.key}.json`));
                let filename = "new-record.json";
                let i = 2;
                while (taken.has(filename)) {
                  filename = `new-record-${i}.json`;
                  i += 1;
                }
                onShowSource({
                  kind: "draft-file",
                  path: `${repo}/${subdir}/${filename}`,
                  subdir,
                  filename,
                  initialContent: JSON.stringify(template, null, 2),
                  collection: source.collection,
                });
              },
            };
          })()
        : null;

  // Pre-compute conversation status counts so the header pills can
  // display them without re-walking on each render frame. Memoising
  // would be overkill — the array is small and reads from the same
  /// Validate + commit an inline rename from the viewer-header. Reads
  /// `renamingPath` / `renameDraft`, calls `entity_rename_file` on
  /// disk, then re-routes the viewer to the new path so the next
  /// fsTick refresh doesn't bounce the user back to a stale source.
  /// Bails (no-op) when the draft is empty, contains a path
  /// separator, or matches the original — keeping a click-then-blur
  /// without changes from triggering a needless write.
  async function commitRename(): Promise<void> {
    if (!renamingPath || !source || (source.kind !== "file" && source.kind !== "datastore-row")) return;

    // For command files (.claude/skills/<name>/SKILL.md), renaming
    // means renaming the parent folder, not the SKILL.md file.
    const skillFolderMatch = renamingPath.match(/^(.+)\/\.claude\/skills\/([^/]+)\/SKILL\.md$/);
    if (skillFolderMatch) {
      const repoRoot = skillFolderMatch[1];
      const oldFolderName = skillFolderMatch[2];
      const next = renameDraft.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
      if (!next || next === oldFolderName) {
        setRenamingPath(null);
        setRenameDraft("");
        setRenameError(null);
        return;
      }
      try {
        const { entityRenameFile } = await import("../lib/api");
        await entityRenameFile(repo, ".claude/skills", oldFolderName, next);
        setRenamingPath(null);
        setRenameDraft("");
        setRenameError(null);
        if (onOpenPath) await onOpenPath(`${repoRoot}/.claude/skills/${next}/SKILL.md`);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.error(`[rename] command folder ${oldFolderName} → ${next}:`, err);
        setRenameError(`Rename failed: ${reason}`);
      }
      return;
    }

    const original = renamingPath.split("/").pop() ?? renamingPath;
    const next = renameDraft.trim();
    if (!next || next === original) {
      setRenamingPath(null);
      setRenameDraft("");
      setRenameError(null);
      return;
    }
    if (next.includes("/") || next.includes("\\")) {
      setRenameError("Filename can't contain slashes");
      return;
    }
    const dirAbs = renamingPath.slice(0, renamingPath.length - original.length - 1);
    const relSubdir = toRepoRelative(repo, dirAbs);
    try {
      const { entityRenameFile } = await import("../lib/api");
      await entityRenameFile(repo, relSubdir, original, next);
      const newPath = `${dirAbs}/${next}`;
      setRenamingPath(null);
      setRenameDraft("");
      setRenameError(null);
      if (onOpenPath) await onOpenPath(newPath);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`[rename] failed for ${original} → ${next}:`, err);
      setRenameError(`Rename failed: ${reason}`);
    }
  }

  // reference until fsTick triggers a new resolver run.
  const conversationCounts: Record<
    "all" | "open" | "resolved" | "escalated",
    number
  > = { all: 0, open: 0, resolved: 0, escalated: 0 };
  if (source.kind === "conversations-list") {
    conversationCounts.all = source.threads.length;
    for (const t of source.threads) {
      if (t.status === "open" || t.status === "agent-responding") {
        conversationCounts.open += 1;
      } else if (t.status === "resolved" || t.status === "closed") {
        conversationCounts.resolved += 1;
      } else if (t.status === "escalated") {
        conversationCounts.escalated += 1;
      }
    }
  }
  // The sync stream and the diff view are the two cases where the
  // user's natural next step is "paste this into Claude". The
  // "add to chat" affordance pastes the contents into the active Claude
  // session (bracketed-paste so the terminal treats it as one atomic
  // input) and falls back to clipboard if Claude isn't running in the
  // right pane.
  const showAddToChat = source.kind === "sync" || source.kind === "diff";
  const addableText =
    source.kind === "sync"
      ? source.lines.join("\n")
      : source.kind === "diff"
      ? source.text
      : "";
  const handleAddToChat = async () => {
    if (!addableText) return;
    const wrapped = `${BRACKETED_PASTE_OPEN}${addableText}${BRACKETED_PASTE_CLOSE}`;
    try {
      const ok = await writeToActiveSession(wrapped);
      if (!ok) {
        await navigator.clipboard.writeText(addableText);
      }
    } catch (e) {
      console.error("[viewer] add-to-chat failed:", e);
    }
  };

  // Media file viewers (image, pdf, spreadsheet, office) want the pane
  // body to be full-bleed — they manage their own internal padding /
  // toolbars / canvas sizing. The conversation thread also goes flush
  // so the pane has a single scroll container (the messages list) with
  // the reply composer pinned as a non-scrolling flex sibling at the
  // bottom — without this, PaneBody became a second scroll container
  // and the composer drifted upward past later turns. Markdown EDIT
  // mode and datastore-row EDIT mode go flush for the same reason —
  // the editable area scrolls and the Cancel/Save footer pins to the
  // bottom of the pane (otherwise the buttons floated mid-pane below
  // the content). Everything else uses the canonical pane padding so
  // content's left edge sits in the same place across pages.
  const flushBody =
    source.kind === "conversation-thread" ||
    (source.kind === "datastore-row" && mode === "edit") ||
    (source.kind === "datastore-schema" && mode === "edit") ||
    (source.kind === "file" &&
      (isImage(source.path) ||
        isPdf(source.path) ||
        isSpreadsheet(source.path) ||
        isOfficeDoc(source.path) ||
        (mode === "edit" && hasEditableTextMode(source.path))));

  // Shared edit-mode renderer: textarea + Cancel / Save footer. Used by
  // both the `kind: file` editable-text path (markdown / JSON / .mjs)
  // and the `kind: datastore-schema` editor (which writes back to
  // `databases/<col>/_schema.json`).
  const renderEditTextarea = (args: {
    filePath: string;
    /// Mode to return to on Cancel and after a successful Save. Markdown
    /// has a rendered preview ("rendered"); JSON / .mjs / schema only
    /// have raw text ("raw"); runnable scripts stay in "edit" because
    /// the View/Edit toggle is suppressed for them.
    afterMode: "raw" | "rendered" | "edit";
    /// Run `JSON.parse(draft)` before writing. Surfaces typos on Save
    /// instead of letting them silently fall through to defaults at
    /// load time.
    validateAsJson: boolean;
  }): ReactNode => {
    const { filePath, afterMode, validateAsJson } = args;
    const onSave = async () => {
      if (!repo || !filePath.startsWith(`${repo}/`)) {
        setEditError("Cannot save: file is outside the project folder.");
        return;
      }
      if (validateAsJson) {
        try {
          JSON.parse(editDraft);
        } catch (e) {
          setEditError(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
          return;
        }
      }
      const rel = filePath.slice(repo.length + 1);
      const lastSlash = rel.lastIndexOf("/");
      const subdir = lastSlash >= 0 ? rel.slice(0, lastSlash) : "";
      const filename = lastSlash >= 0 ? rel.slice(lastSlash + 1) : rel;
      setEditSaving(true);
      setEditError(null);
      try {
        const { entityWriteFile } = await import("../lib/api");
        await entityWriteFile(repo, subdir, filename, editDraft);
        setContent(editDraft);
        setMode(afterMode);
      } catch (err) {
        setEditError(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setEditSaving(false);
      }
    };
    const onCancel = () => {
      setEditDraft(content);
      setEditError(null);
      setMode(afterMode);
    };
    const isDirty = editDraft !== content;
    return (
      <div className="viewer-edit">
        <textarea
          className="viewer-edit-textarea"
          value={editDraft}
          onChange={(e) => setEditDraft(e.target.value)}
          spellCheck={false}
          autoFocus
        />
        <div className="viewer-edit-footer">
          {editError && <span className="viewer-edit-error">{editError}</span>}
          <Button
            variant="secondary"
            size="sm"
            onClick={onCancel}
            disabled={editSaving}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={onSave}
            disabled={editSaving || !isDirty}
            loading={editSaving}
          >
            {editSaving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    );
  };

  // --- Render body ---
  const renderBody = () => {
    // File viewers
    if (source.kind === "file") {
      if (isImage(source.path) && binaryData) {
        return <ImageViewer data={binaryData} mimeType={mimeForPath(source.path)} />;
      }
      if (isPdf(source.path) && binaryData) {
        return <PdfViewer data={binaryData} />;
      }
      if (isSpreadsheet(source.path) && binaryData) {
        return <SpreadsheetViewer data={binaryData} filename={source.path} />;
      }
      if (isOfficeDoc(source.path)) {
        return <OfficeViewer filename={source.path} />;
      }
      if (mode === "edit" && hasEditableTextMode(source.path)) {
        return renderEditTextarea({
          filePath: source.path,
          afterMode: isRunnableScript(source.path)
            ? "edit"
            : isMarkdown(source.path)
              ? "rendered"
              : "raw",
          validateAsJson: isJsonFile(source.path),
        });
      }
      if (mode === "rendered" && source.path.endsWith("/getting-started.html")) {
        const flashClass =
          welcomeFlashKey && welcomeFlashKey > 0 ? "viewer-md-flash" : "";
        const handleWelcomeClick = (e: React.MouseEvent<HTMLDivElement>) => {
          const target = e.target as HTMLElement;
          const btn = target.closest("[data-action='start-tour']");
          if (!btn) return;
          e.preventDefault();
          injectIntoChat("/getting-started");
        };
        return (
          <div
            className={`welcome-page ${flashClass}`}
            key={`welcome-${welcomeFlashKey ?? 0}`}
            onClick={handleWelcomeClick}
            dangerouslySetInnerHTML={{ __html: content }}
          />
        );
      }
      if (mode === "rendered" && isMarkdown(source.path)) {
        // Substitute live template tokens before rendering. {{INTAKE_URL}}
        // is the only one for now — used by the welcome doc to link to
        // the dynamic intake URL that changes per app launch. If the
        // server isn't running yet (intakeUrl is null), strip the link
        // gracefully so we don't render a broken `[text](null)`.
        const ctaUrl = intakeUrl;
        const rendered = ctaUrl
          ? content.split("{{INTAKE_URL}}").join(ctaUrl)
          : content.replace(/\[([^\]]+)\]\(\{\{INTAKE_URL\}\}\)/g, "$1");
        // Re-mount the markdown subtree on flashKey change so the CSS
        // animation re-fires. Combining with a class is enough — no
        // imperative DOM poking.
        const flashClass =
          welcomeFlashKey && welcomeFlashKey > 0 ? "viewer-md-flash" : "";
        return (
          <div className={`viewer-md ${flashClass}`} key={`md-${welcomeFlashKey ?? 0}`}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{ a: ExternalAnchor }}
              urlTransform={(url) =>
                url.startsWith("openit://") ? url : defaultUrlTransform(url)
              }
            >
              {rendered}
            </ReactMarkdown>
          </div>
        );
      }
      return <pre className="viewer-content">{content}</pre>;
    }

    // In-memory draft from the "New" button — no file on disk yet.
    // Same edit chrome as the existing file editor, but Save commits
    // a fresh write and routes the viewer to the now-real file.
    // Cancel uses the parent's back-stack (the entity-folder is the
    // last-known nav target). Save is naturally enabled because the
    // baseline `content` is empty so any draft text reads as dirty.
    if (source.kind === "draft-file") {
      const draftSource = source;
      const onCancelDraft = () => {
        if (onGoBack && canGoBack) onGoBack();
      };

      // Structured form for datastore +New (has collection/schema).
      if (draftSource.collection) {
        const onSaveDraft = async () => {
          if (!repo) return;
          setEditSaving(true);
          setEditError(null);
          try {
            const { entityWriteFile } = await import("../lib/api");
            const json = JSON.stringify(rowEditDraft, null, 2);
            await entityWriteFile(
              repo,
              draftSource.subdir,
              draftSource.filename,
              json,
            );
            showToast(`Created ${draftSource.filename}`);
            if (onOpenPath) {
              const folderAbs = `${repo}/${draftSource.subdir}`;
              await onOpenPath(folderAbs);
              await onOpenPath(draftSource.path);
            }
          } catch (err) {
            setEditError(
              `Save failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          } finally {
            setEditSaving(false);
          }
        };
        return (
          <RowEditForm
            collection={draftSource.collection}
            draft={rowEditDraft}
            onChange={setRowEditDraft}
            onSave={onSaveDraft}
            onCancel={onCancelDraft}
            saving={editSaving}
            error={editError}
          />
        );
      }

      // Plain-text draft (non-datastore files like scripts, KB articles).
      const onSaveDraft = async () => {
        if (!repo) return;
        setEditSaving(true);
        setEditError(null);
        try {
          const { entityWriteFile } = await import("../lib/api");
          await entityWriteFile(
            repo,
            draftSource.subdir,
            draftSource.filename,
            editDraft,
          );
          showToast(`Created ${draftSource.filename}`);
          if (onOpenPath) {
            const folderAbs = `${repo}/${draftSource.subdir}`;
            await onOpenPath(folderAbs);
            await onOpenPath(draftSource.path);
          }
        } catch (err) {
          setEditError(
            `Save failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        } finally {
          setEditSaving(false);
        }
      };
      return (
        <div className="viewer-edit">
          <textarea
            className="viewer-edit-textarea"
            value={editDraft}
            onChange={(e) => setEditDraft(e.target.value)}
            spellCheck={false}
            autoFocus
          />
          <div className="viewer-edit-footer">
            {editError && <span className="viewer-edit-error">{editError}</span>}
            <Button
              variant="secondary"
              size="sm"
              onClick={onCancelDraft}
              disabled={editSaving}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={onSaveDraft}
              disabled={editSaving || editDraft.length === 0}
              loading={editSaving}
            >
              {editSaving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      );
    }

    // Captured stdout / stderr from a Run-button invocation. Two
    // monospaced blocks (stdout green-tinted, stderr red-tinted)
    // bracketed by a one-line summary so the admin can see exit
    // status + duration at a glance. Empty streams are suppressed
    // so a successful silent run doesn't leave dangling labels.
    if (source.kind === "script-output") {
      const ok = source.exitCode === 0;
      const filename = source.script.split("/").pop() ?? source.script;
      return (
        <div className="viewer-summary script-output">
          <div className="script-output-summary">
            <span
              className={`script-output-status ${ok ? "ok" : "fail"}`}
              aria-label={ok ? "Exited 0" : `Exited ${source.exitCode}`}
            >
              {ok ? "✓" : "✗"} exit {source.exitCode}
            </span>
            <span className="script-output-duration">
              {source.durationMs}ms
            </span>
            <code className="script-output-script">{filename}</code>
          </div>
          {source.stdout && (
            <>
              <h3 className="script-output-label">stdout</h3>
              <pre className="viewer-content script-output-stream">
                {source.stdout}
              </pre>
            </>
          )}
          {source.stderr && (
            <>
              <h3 className="script-output-label script-output-label-err">
                stderr
              </h3>
              <pre className="viewer-content script-output-stream script-output-stream-err">
                {source.stderr}
              </pre>
            </>
          )}
          {!source.stdout && !source.stderr && (
            <p className="summary-desc">
              The script ran to completion without printing anything.
            </p>
          )}
        </div>
      );
    }

    // Datastore schema viewer.
    if (source.kind === "datastore-schema") {
      return (
        <DatastoreSchemaBody
          collection={source.collection}
          mode={mode}
          content={content}
          renderEditTextarea={renderEditTextarea}
          repo={repo}
        />
      );
    }

    // Datastore table view.
    if (source.kind === "datastore-table") {
      return (
        <DatastoreTableBody
          collection={source.collection}
          tableItems={tableItems}
          tableLoading={tableLoading}
          tableHasMore={tableHasMore}
          repo={repo}
          onOpenPath={onOpenPath}
          setFolderUploadError={setFolderUploadError}
          showToast={showToast}
          onFsChange={onFsChange}
        />
      );
    }

    // Datastore row view.
    if (source.kind === "datastore-row") {
      return (
        <DatastoreRowBody
          collection={source.collection}
          liveItem={rowOverride ?? source.item}
          mode={mode}
          content={content}
          rowEditDraft={rowEditDraft}
          setRowEditDraft={setRowEditDraft}
          editSaving={editSaving}
          editError={editError}
          setEditSaving={setEditSaving}
          setEditError={setEditError}
          setContent={setContent}
          setRowOverride={setRowOverride}
          setMode={setMode}
          repo={repo}
        />
      );
    }


    // Agent viewer — raw JSON / edit form / rendered read-only view.
    if (source.kind === "agent") {
      const a: Agent = agentOverride ?? source.agent;

      if (mode === "raw") {
        return <AgentRawView agent={a} />;
      }

      if (mode === "edit") {
        const onSave = async () => {
          if (!repo) {
            setEditError("Cannot save: no repo open.");
            return;
          }
          setEditSaving(true);
          setEditError(null);
          try {
            await saveAgentEditDraft({
              repo,
              draft: agentEditDraft,
              loaded: agentEditLoaded,
              agent: a,
            });
            setAgentOverride({
              ...a,
              description: agentEditDraft.description,
              selectedModel: agentEditDraft.selectedModel || undefined,
              isShared: agentEditDraft.isShared,
              promptExamples: agentEditDraft.promptExamples
                .split("\n")
                .map((s) => s.trim())
                .filter((s) => s.length > 0),
              introMessage: agentEditDraft.introMessage || undefined,
            });
            setMode("rendered");
          } catch (err) {
            setEditError(
              `Save failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          } finally {
            setEditSaving(false);
          }
        };
        const onCancel = () => {
          setEditError(null);
          setMode("rendered");
        };
        return (
          <AgentEditForm
            draft={agentEditDraft}
            onChange={setAgentEditDraft}
            onSave={onSave}
            onCancel={onCancel}
            editSaving={editSaving}
            editError={editError}
            agentEditKbs={agentEditKbs}
            agentEditDss={agentEditDss}
            agentEditFss={agentEditFss}
          />
        );
      }

      // Default: rendered (read-only beautiful view).
      return <AgentRenderedView agent={a} repo={repo} />;
    }

    // Workflow summary
    if (source.kind === "workflow") {
      const w = source.workflow;
      return (
        <div className="viewer-summary">
          <h2>{w.name}</h2>
          {w.description && <p className="summary-desc">{w.description}</p>}
          {(() => {
            const inputs = w.inputs as Array<{ name: string; type: string; required?: boolean }> | undefined;
            return inputs && inputs.length > 0 ? (
            <div className="summary-section">
              <h3>Inputs</h3>
              <table className="summary-table">
                <thead>
                  <tr><th>Name</th><th>Type</th><th>Required</th></tr>
                </thead>
                <tbody>
                  {inputs.map((inp: { name: string; type: string; required?: boolean }, i: number) => (
                    <tr key={i}>
                      <td>{inp.name}</td>
                      <td><code>{inp.type}</code></td>
                      <td>{inp.required ? "Yes" : "No"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            ) : null;
          })()}
          {(() => {
            const triggers = w.triggers as Array<{ name: string; url?: string }> | undefined;
            return triggers && triggers.length > 0 ? (
            <div className="summary-section">
              <h3>Triggers</h3>
              <ul>
                {triggers.map((t: { name: string; url?: string }, i: number) => (
                  <li key={i}>
                    {t.name}
                    {t.url && <code className="trigger-url">{t.url}</code>}
                  </li>
                ))}
              </ul>
            </div>
            ) : null;
          })()}
          <div className="summary-section">
            <h3>Details</h3>
            <table className="summary-table">
              <tbody>
                <tr><td>ID</td><td><code>{w.id}</code></td></tr>
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    // Conversations list — one clickable card per thread, sorted by
    // most-recent activity.
    if (source.kind === "conversations-list") {
      return (
        <ConversationsListBody
          threads={source.threads}
          intakeUrl={intakeUrl}
          conversationsFilter={conversationsFilter}
          repo={repo}
          onOpenPath={onOpenPath}
          setFolderUploadError={setFolderUploadError}
          showToast={showToast}
        />
      );
    }

    // People directory — card or table view.
    if (source.kind === "people-list") {
      return (
        <PeopleListBody
          view={peopleView}
          people={source.people}
          collection={source.collection}
          items={source.items}
          repo={repo}
          onOpenPath={onOpenPath}
          folderUploadError={folderUploadError}
          setFolderUploadError={setFolderUploadError}
          showToast={showToast}
          onFsChange={onFsChange}
        />
      );
    }

    // Access log — card or table view.
    if (source.kind === "access-list") {
      return (
        <AccessListBody
          view={accessView}
          records={source.records}
          collection={source.collection}
          items={source.items}
          repo={repo}
          onOpenPath={onOpenPath}
          folderUploadError={folderUploadError}
          setFolderUploadError={setFolderUploadError}
          showToast={showToast}
          onFsChange={onFsChange}
        />
      );
    }

    // Asset inventory — card or table view.
    if (source.kind === "assets-list") {
      return (
        <AssetsListBody
          view={assetsView}
          records={source.records}
          collection={source.collection}
          items={source.items}
          repo={repo}
          onOpenPath={onOpenPath}
          folderUploadError={folderUploadError}
          setFolderUploadError={setFolderUploadError}
          showToast={showToast}
          onFsChange={onFsChange}
        />
      );
    }

    // Top-level `filestores/` parent. Two cards (attachments,
    // library) — same layout as databases-list. Click attachments →
    // attachments-folder welcome stub. Click library → entity-folder
    // file view.
    if (source.kind === "knowledge-bases-list") {
      return (
        <div className="viewer-summary">
          {folderUploadError && (
            <p className="viewer-edit-error">{folderUploadError}</p>
          )}
          <EntityCardGrid
            kind="knowledge-bases"
            cards={source.collections.map((c) => ({
              key: c.path,
              title: c.name,
              description: c.description,
              meta: `${c.itemCount} article${c.itemCount === 1 ? "" : "s"}`,
              badge: c.isBuiltin
                ? undefined
                : { label: "custom", tone: "info" },
              onClick: () => onOpenPath && void onOpenPath(c.path),
              onFilesDropped: repo
                ? (files) => uploadFilesToSubdir(repo, c.path, files, setFolderUploadError, showToast)
                : undefined,
              onReveal: () => void fsReveal(c.path).catch(console.error),
            }))}
          />
        </div>
      );
    }

    if (source.kind === "filestores-list") {
      return (
        <div className="viewer-summary">
          {folderUploadError && (
            <p className="viewer-edit-error">{folderUploadError}</p>
          )}
          {newCollectionKind === "filestore" && (
            <div className="inline-new-collection">
              <input
                autoFocus
                className="inline-new-input"
                placeholder="Collection name…"
                value={newCollectionName}
                onChange={(e) => setNewCollectionName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") { setNewCollectionKind(null); setNewCollectionName(""); }
                  if (e.key === "Enter") {
                    (document.querySelector(".inline-new-create") as HTMLButtonElement | null)?.click();
                  }
                }}
              />
              <Button
                variant="primary"
                size="sm"
                className="inline-new-create"
                disabled={!newCollectionName.trim()}
                onClick={async () => {
                  if (!repo || !newCollectionName.trim()) return;
                  const slug = newCollectionName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
                  if (!slug) return;
                  if (source.collections.some((c) => c.name === slug)) {
                    setFolderUploadError(`Filestore "${slug}" already exists.`);
                    return;
                  }
                  try {
                    const { entityWriteFile } = await import("../lib/api");
                    await entityWriteFile(repo, `filestores/${slug}`, "README.md", `# ${slug}\n`);
                    setNewCollectionKind(null);
                    setNewCollectionName("");
                    onFsChange?.();
                    if (onOpenPath) void onOpenPath(`${repo}/filestores/${slug}`);
                  } catch (err) {
                    setFolderUploadError(`Failed to create: ${err instanceof Error ? err.message : String(err)}`);
                  }
                }}
              >
                Create
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setNewCollectionKind(null); setNewCollectionName(""); }}>
                Cancel
              </Button>
            </div>
          )}
          <EntityCardGrid
            kind="filestores"
            cards={source.collections.map((c) => ({
              key: c.path,
              title: c.displayName,
              description: c.description,
              meta: `${c.itemCount} ${c.itemNoun}${c.itemCount === 1 ? "" : "s"}`,
              badge: c.isBuiltin
                ? undefined
                : { label: "custom", tone: "info" },
              onClick: () => onOpenPath && void onOpenPath(c.path),
              // Attachments collection is per-ticket — dropping into the
              // generic folder would have nowhere meaningful to land. The
              // remaining built-in (`library`) and any user-created
              // filestore accept drops to their on-disk subdir.
              onFilesDropped:
                repo && c.name !== "attachments"
                  ? (files) =>
                      uploadFilesToSubdir(repo, c.path, files, setFolderUploadError, showToast)
                  : undefined,
              onReveal: () => void fsReveal(c.path).catch(console.error),
              onDelete: repo ? async () => {
                const ok = await confirmDelete(
                  `Delete filestore "${c.displayName}" and all its files?\n\nThis cannot be undone.`,
                  "Delete filestore?",
                );
                if (!ok) return;
                try {
                  await entityRemoveDir(repo, `filestores/${c.name}`);
                  showToast(`Deleted filestore ${c.displayName}`);
                  onFsChange?.();
                } catch (err) {
                  console.error("[filestore-delete] failed:", err);
                }
              } : undefined,
            }))}
          />
        </div>
      );
    }

    // Tools — the tools catalog. Synthetic entity (no on-disk
    // contents); the panel detects installed binaries via `which` and
    // shells out to `brew install/uninstall` for mutations.
    if (source.kind === "tools") {
      return <ToolsPanel projectRoot={repo} />;
    }

    if (source.kind === "skills-station") {
      return <SkillsStation repo={repo} onOpen={(p) => onOpenPath && void onOpenPath(p)} />;
    }

    if (source.kind === "commands-station") {
      return <CommandsStation repo={repo} fsTick={fsTick} onOpen={(p) => onOpenPath && void onOpenPath(p)} />;
    }

    if (source.kind === "traces-list") {
      if (source.folders.length === 0) {
        return (
          <div className="viewer-summary">
            <p className="summary-desc">No agent traces yet. Traces appear here when the AI agent handles tickets.</p>
          </div>
        );
      }
      return (
        <div className="viewer-summary">
          <div className="viewer-thread-list">
            {source.folders.map((f) => (
              <div key={f.path} className="thread-card-wrapper">
                <button
                  type="button"
                  className="thread-card"
                  onClick={() => onOpenPath && void onOpenPath(f.path)}
                  title={`View ${f.traceCount} turn${f.traceCount === 1 ? "" : "s"}`}
                >
                  <div className="thread-card-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingRight: 0 }}>
                    <div style={{ minWidth: 0 }}>
                      <span className="thread-card-subject">{f.subject}</span>
                      <div className="thread-card-meta">
                        <span className="thread-card-count">{f.traceCount} turn{f.traceCount === 1 ? "" : "s"}</span>
                      </div>
                    </div>
                    <Button
                      variant="link"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onOpenPath) void onOpenPath(`${repo}/databases/tickets/${f.name}.json`);
                      }}
                      title="Open ticket"
                      style={{ flexShrink: 0 }}
                    >
                      ticket →
                    </Button>
                  </div>
                </button>
              </div>
            ))}
          </div>
        </div>
      );
    }

    if (source.kind === "scripts-station") {
      return <ScriptsStation repo={repo} fsTick={fsTick} onOpen={(p) => onOpenPath && void onOpenPath(p)} onShowSource={onShowSource} />;
    }

    // `filestores/attachments/` welcome stub + per-ticket roll-up.
    // The lead paragraph explains what lives in this folder so an
    // admin clicking it for the first time understands the split
    // from `library/`. Below, one card per ticket subfolder routes
    // back to the conversation thread — that's where attachments
    // belong contextually, alongside the messages they came in
    // with.
    if (source.kind === "attachments-folder") {
      return (
        <div className="viewer-summary">
          <EntityCardGrid
            kind="attachments"
            empty={
              <p className="summary-desc">
                No attachments yet. Files dropped into a chat or admin reply land here, grouped by ticket.
              </p>
            }
            cards={source.tickets.map((t) => ({
              key: t.ticketId,
              title: t.ticketId,
              meta: `${t.fileCount} file${t.fileCount === 1 ? "" : "s"}`,
              onClick: () => {
                // Open the actual attachments folder for this ticket.
                // The viewer adds a "Conversation" link in the header
                // so admins can still jump to the related thread
                // when they need context.
                if (onOpenPath) {
                  void onOpenPath(t.path);
                }
              },
              onReveal: () => void fsReveal(t.path).catch(console.error),
            }))}
          />
        </div>
      );
    }

    // Top-level `databases/` parent. Each subfolder is a collection
    // with its own row format (datastore-table for tickets/people,
    // conversations-list for conversations). The parent view here
    // surfaces an at-a-glance overview — name, item count, schema
    // status — so the user sees the shape of their data without
    // expanding every folder. Click a card → onOpenPath routes into
    // the per-collection viewer.
    if (source.kind === "databases-list") {
      return (
        <div className="viewer-summary">
          {newCollectionKind === "database" && (
            <div className="inline-new-collection">
              <input
                autoFocus
                className="inline-new-input"
                placeholder="Collection name…"
                value={newCollectionName}
                onChange={(e) => setNewCollectionName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") { setNewCollectionKind(null); setNewCollectionName(""); }
                  if (e.key === "Enter") {
                    (document.querySelector(".inline-new-create") as HTMLButtonElement | null)?.click();
                  }
                }}
              />
              <Button
                variant="primary"
                size="sm"
                className="inline-new-create"
                disabled={!newCollectionName.trim()}
                onClick={async () => {
                  if (!repo || !newCollectionName.trim()) return;
                  const slug = newCollectionName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
                  if (!slug) return;
                  if (source.collections.some((c) => c.name === slug)) {
                    setFolderUploadError(`Database "${slug}" already exists.`);
                    return;
                  }
                  try {
                    const { entityWriteFile } = await import("../lib/api");
                    await entityWriteFile(repo, `databases/${slug}`, "README.md", `# ${slug}\n`);
                    setNewCollectionKind(null);
                    setNewCollectionName("");
                    onFsChange?.();
                    if (onOpenPath) void onOpenPath(`${repo}/databases/${slug}`);
                  } catch (err) {
                    setFolderUploadError(`Failed to create: ${err instanceof Error ? err.message : String(err)}`);
                  }
                }}
              >
                Create
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setNewCollectionKind(null); setNewCollectionName(""); }}>
                Cancel
              </Button>
            </div>
          )}
          <EntityCardGrid
            kind="databases"
            empty={
              <p className="summary-desc">
                No collections yet. Collections are JSON-backed tables that
                hold tickets, people, conversations, and any custom entities
                you create. Ask Claude —{" "}
                <em>"create a collection for inventory items"</em> — and it
                will scaffold one under <code>databases/</code> with a
                starter schema.
              </p>
            }
            cards={source.collections.map((c) => ({
              key: c.path,
              title: c.name,
              meta: `${c.itemCount} ${
                c.name === "conversations" ? "thread" : "row"
              }${c.itemCount === 1 ? "" : "s"}`,
              onClick: () => onOpenPath && void onOpenPath(c.path),
              onReveal: () => void fsReveal(c.path).catch(console.error),
              onDelete: repo ? async () => {
                const ok = await confirmDelete(
                  `Delete database "${c.name}" and all its records?\n\nThis cannot be undone.`,
                  "Delete database?",
                );
                if (!ok) return;
                try {
                  await entityRemoveDir(repo, `databases/${c.name}`);
                  showToast(`Deleted database ${c.name}`);
                  onFsChange?.();
                } catch (err) {
                  console.error("[db-delete] failed:", err);
                }
              } : undefined,
            }))}
          />
        </div>
      );
    }

    // Generic top-level entity folder (agents/, workflows/, knowledge-
    // base/, filestore/). Rendering delegated to EntityFolderBody.
    if (source.kind === "entity-folder") {
      return (
        <EntityFolderBody
          source={source}
          repo={repo}
          onOpenPath={onOpenPath}
          onShowSource={onShowSource}
          showToast={showToast}
          reportError={reportError}
          onFsChange={onFsChange}
        />
      );
    }

    // Conversation thread — chat-style bubbles + admin reply composer.
    // State (replyText, replySending, etc.) now lives inside
    // ConversationThreadBody.
    if (source.kind === "conversation-thread") {
      return (
        <ConversationThreadBody
          turns={source.turns}
          ticketId={source.ticketId}
          repo={repo}
          adminEmail={adminEmail}
          onOpenPath={onOpenPath}
        />
      );
    }

    // Agent-trace timeline — single turn.
    if (source.kind === "agent-trace") {
      return <AgentTraceBody doc={source.doc} subject={source.subject} />;
    }

    // Agent-trace-list — all turns for one ticket.
    if (source.kind === "agent-trace-list") {
      return <AgentTraceListBody subject={source.subject} docs={source.docs} />;
    }

    // Sync output gets a ref so the auto-scroll useEffect above can
    // pin the view to the latest line.
    if (source?.kind === "sync") {
      return (
        <pre ref={syncPreRef} className="viewer-content">
          {content}
        </pre>
      );
    }

    // Diff: VSCode-style per-file unified-diff renderer. Click on a
    // file header opens the file in the viewer (synced with
    // FileExplorer via the `onOpenPath` round-trip).
    if (source?.kind === "diff") {
      return (
        <div className="viewer-content diff-content">
          <DiffViewer
            text={content}
            onOpenFile={
              repo && onOpenPath
                ? (rel) => {
                    void onOpenPath(`${repo}/${rel}`);
                  }
                : undefined
            }
          />
        </div>
      );
    }

    return <pre className="viewer-content">{content}</pre>;
  };

  // Map the active source.kind onto the entity meta key so the header
  // can render the matching tinted icon next to the title — closes the
  // loop with the Workbench station / EntityCardGrid card icons.
  let headerKind: EntityKind | null = null;
  if (source) {
    switch (source.kind) {
      case "entity-folder":
        // Map the per-ticket attachments folder to the generic
        // "attachments" icon kind — it doesn't have its own ENTITY_META
        // entry. All other entity-folder values match an EntityKind
        // 1:1.
        headerKind =
          source.entity === "attachments-ticket"
            ? "attachments"
            : (source.entity as EntityKind);
        break;
      case "knowledge-bases-list":
        headerKind = "knowledge-bases";
        break;
      case "filestores-list":
        headerKind = "filestores";
        break;
      case "attachments-folder":
        headerKind = "attachments";
        break;
      case "datastore-table":
        // Map specific collection names to their entity icons
        if (source.collection.name === "access") headerKind = "access";
        else if (source.collection.name === "assets") headerKind = "assets";
        else if (source.collection.name === "people") headerKind = "people";
        else if (source.collection.name === "tickets") headerKind = "inbox";
        else headerKind = "databases";
        break;
      case "databases-list":
        headerKind = "databases";
        break;
      case "conversations-list":
        headerKind = "inbox";
        break;
      case "people-list":
        headerKind = "people";
        break;
      case "access-list":
        headerKind = "access";
        break;
      case "assets-list":
        headerKind = "assets";
        break;
      case "tools":
        headerKind = "tools";
        break;
      case "skills-station":
        headerKind = "skills";
        break;
      case "commands-station":
        headerKind = "commands";
        break;
      case "traces-list":
        headerKind = "traces";
        break;
      case "scripts-station":
        headerKind = "scripts";
        break;
    }
  }

  // Shared header fragment for the three record-list views (people,
  // access, assets). Each gets a "+ New" button that drafts a new
  // record seeded from the collection schema, plus a Cards / Table
  // tab toggle.
  const renderRecordListHeader = (args: {
    dbName: string;
    collection: import("../lib/localTypes").DataCollection | undefined;
    existingKeys: string[];
    newTitle: string;
    view: "cards" | "table";
    setView: (v: "cards" | "table") => void;
  }): ReactNode => {
    const { dbName, collection, existingKeys, newTitle, view, setView } = args;
    return (
      <>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (!onShowSource || !repo || !collection) return;
            const fields = (collection.schema as { fields?: Array<Record<string, unknown>> })?.fields ?? [];
            const template: Record<string, unknown> = {};
            for (const f of fields) {
              const id = f.id as string;
              if (id === "createdAt" || id === "updatedAt") {
                template[id] = new Date().toISOString();
              } else {
                template[id] = "";
              }
            }
            const taken = new Set(existingKeys);
            let filename = "new-record.json";
            let i = 2;
            while (taken.has(filename.replace(".json", ""))) {
              filename = `new-record-${i}.json`;
              i += 1;
            }
            onShowSource({
              kind: "draft-file",
              path: `${repo}/databases/${dbName}/${filename}`,
              subdir: `databases/${dbName}`,
              filename,
              initialContent: JSON.stringify(template, null, 2),
              collection,
            });
          }}
          title={newTitle}
        >
          + New
        </Button>
        <TabStrip variant="segmented">
          <Tab active={view === "cards"} onClick={() => setView("cards")}>Cards</Tab>
          <Tab active={view === "table"} onClick={() => setView("table")}>Table</Tab>
        </TabStrip>
      </>
    );
  };

  return (
    <div className="viewer">
      <div className="viewer-header">
        {/* Permanent back/forward pair — every viewer page gets the
            same navigation affordance instead of relying on per-kind
            back buttons that only existed for a few views. Disabled
            when the corresponding history stack is empty. */}
        <div className="viewer-nav" role="group" aria-label="Viewer navigation">
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            onClick={() => onGoBack?.()}
            disabled={!canGoBack}
            title="Back"
            aria-label="Back"
          >
            ←
          </Button>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            onClick={() => onGoForward?.()}
            disabled={!canGoForward}
            title="Forward"
            aria-label="Forward"
          >
            →
          </Button>
        </div>
        {headerKind && <EntityBadge kind={headerKind} showLabel={false} />}
        <BreadcrumbAncestors
          source={source}
          repo={repo}
          onNavigate={(relPath) => {
            window.dispatchEvent(
              new CustomEvent("openit:navigate", { detail: { path: `${repo}/${relPath}` } }),
            );
          }}
        />
        {source && (source.kind === "file" || source.kind === "datastore-row") ? (
          renamingPath ? (
            <input
              type="text"
              className="viewer-title viewer-title-rename"
              value={renameDraft}
              autoFocus
              onChange={(e) => {
                setRenameDraft(e.target.value);
                setRenameError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void commitRename();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setRenamingPath(null);
                  setRenameDraft("");
                  setRenameError(null);
                }
              }}
              onBlur={() => void commitRename()}
            />
          ) : (
            <button
              type="button"
              className="viewer-title viewer-title-editable"
              onClick={() => {
                if (source.kind === "datastore-row") {
                  const key = source.item.key || source.item.id || "";
                  const filePath = `${repo}/databases/${source.collection.name}/${key}.json`;
                  setRenamingPath(filePath);
                  setRenameDraft(`${key}.json`);
                } else {
                  // For command files (.claude/skills/<name>/SKILL.md),
                  // seed the rename with the folder name, not "SKILL.md".
                  const skillFolderMatch = source.path.match(/\.claude\/skills\/([^/]+)\/SKILL\.md$/);
                  const draft = skillFolderMatch
                    ? skillFolderMatch[1]
                    : source.path.split("/").pop() ?? source.path;
                  setRenamingPath(source.path);
                  setRenameDraft(draft);
                }
                setRenameError(null);
              }}
              title="Click to rename"
            >
              {title}
            </button>
          )
        ) : source && source.kind === "draft-file" && onShowSource ? (
          <input
            type="text"
            className="viewer-title viewer-title-rename"
            value={title}
            onChange={(e) => {
              const newFilename = e.target.value;
              onShowSource({
                ...source,
                filename: newFilename,
                path: `${repo}/${source.subdir}/${newFilename}`,
              });
            }}
            title="Edit filename before saving"
          />
        ) : (
          <span className="viewer-title">{title}</span>
        )}
        {renameError && (
          <span className="viewer-title-rename-error" role="alert">
            {renameError}
          </span>
        )}
        {source && source.kind === "conversation-thread" && onOpenPath && (
          <TabStrip variant="segmented">
            <Tab active>Conversation</Tab>
            <Tab
              onClick={() => {
                void onOpenPath(`${repo}/databases/tickets/${source.ticketId}.json`);
              }}
              title="Open the ticket record (status, tags, notes, asker info)"
            >
              Ticket
            </Tab>
          </TabStrip>
        )}
        {source && source.kind === "entity-folder" && source.entity === "reports" && (
          <>
            <Button
              variant="linkMuted"
              onClick={async () => {
                if (!repo || reportRunning) return;
                setReportRunning(true);
                setReportError(null);
                try {
                  const relPath = await reportOverviewRun(repo);
                  if (onOpenPath) void onOpenPath(`${repo}/${relPath}`);
                } catch (e) {
                  setReportError(e instanceof Error ? e.message : String(e));
                } finally {
                  setReportRunning(false);
                }
              }}
              disabled={reportRunning || !repo}
              loading={reportRunning}
              title="Generate an instant helpdesk overview report"
            >
              {reportRunning ? "generating…" : "generate overview"}
            </Button>
            <Button
              variant="linkMuted"
              onClick={() => {
                // Paste `/report ` into the Claude pane so the admin
                // can type their custom prompt immediately. Distinct
                // from "add to chat" — that just references the
                // reports folder; this kicks off the full skill.
                const wrapped = `${BRACKETED_PASTE_OPEN}/report ${BRACKETED_PASTE_CLOSE}`;
                writeToActiveSession(wrapped).catch((err) =>
                  console.warn("[viewer] ask-custom-report paste failed:", err),
                );
              }}
              title="Kick off /report in chat for a custom report"
            >
              ask for custom report
              <span className="arrow" aria-hidden="true">→</span>
            </Button>
          </>
        )}
        {runFileAffordance && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void runFileAffordance.onRun()}
            title="Run this script with node / python3 and show the output"
          >
            <span className="viewer-run-glyph" aria-hidden="true">▶</span>
            Run
          </Button>
        )}
        {newFileAffordance && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => newFileAffordance.onCreate()}
            title={newFileAffordance.title}
          >
            + New
          </Button>
        )}
        {source && source.kind === "filestores-list" && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setNewCollectionKind(newCollectionKind === "filestore" ? null : "filestore");
              setNewCollectionName("");
            }}
            title="Create a new filestore collection"
          >
            + New
          </Button>
        )}
        {source && source.kind === "databases-list" && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setNewCollectionKind(newCollectionKind === "database" ? null : "database");
              setNewCollectionName("");
            }}
            title="Create a new database"
          >
            + New
          </Button>
        )}
        {showFileTabs && (
          <TabStrip variant="segmented">
            <Tab
              active={mode !== "edit"}
              onClick={() => {
                const renderable =
                  source.kind === "file" && isMarkdown(source.path);
                setMode(renderable ? "rendered" : "raw");
              }}
            >
              View
            </Tab>
            <Tab
              active={mode === "edit"}
              onClick={() => {
                if (mode !== "edit") setEditDraft(content);
                setEditError(null);
                setMode("edit");
              }}
            >
              Edit
            </Tab>
          </TabStrip>
        )}
        {isCommandFile && (
          <Button
            variant="ghost"
            tone="destructive"
            size="sm"
            onClick={async () => {
              if (source.kind !== "file") return;
              const filename = source.path.split("/").pop() ?? "";
              const dir = source.path.slice(0, source.path.length - filename.length - 1);
              const ok = await confirmDelete(
                `Delete command "${filename.replace(/\.md$/, "")}"?\n\nThis cannot be undone.`,
                "Delete command?",
              );
              if (!ok) return;
              try {
                await entityDeleteFile(repo, toRepoRelative(repo, dir), filename);
                // Navigate back to commands list
                if (onOpenPath) void onOpenPath(`${repo}/filestores/skills`);
              } catch (err) {
                console.error("[command-delete] failed:", err);
              }
            }}
            title="Delete this command"
          >
            Delete
          </Button>
        )}
        {showRowTabs && (
          <TabStrip variant="segmented">
            {source.kind === "datastore-row" &&
              source.collection.name === "tickets" &&
              onOpenPath && (
                <Tab
                  onClick={() => {
                    void onOpenPath(
                      `${repo}/databases/conversations/${source.item.key || source.item.id}`,
                    );
                  }}
                  title="Open the conversation thread for this ticket"
                >
                  Conversation
                </Tab>
              )}
            <Tab
              active={mode === "table"}
              onClick={() => setMode("table")}
            >
              {source.kind === "datastore-row" &&
              source.collection.name === "tickets"
                ? "Ticket"
                : "View"}
            </Tab>
            <Tab
              active={mode === "edit"}
              onClick={() => {
                // Seed the form with the current row content the
                // first time edit mode is entered. Re-clicking Edit
                // while already editing keeps the in-progress draft.
                if (mode !== "edit" && source && source.kind === "datastore-row") {
                  const liveItem = rowOverride ?? source.item;
                  const raw = liveItem.content;
                  let parsed: Record<string, unknown> = {};
                  if (raw && typeof raw === "object") {
                    parsed = { ...(raw as Record<string, unknown>) };
                  } else if (typeof raw === "string") {
                    try {
                      parsed = JSON.parse(raw) as Record<string, unknown>;
                    } catch {
                      parsed = {};
                    }
                  }
                  setRowEditDraft(parsed);
                }
                setEditError(null);
                setMode("edit");
              }}
            >
              Edit
            </Tab>
            <Tab
              active={mode === "raw"}
              onClick={() => setMode("raw")}
            >
              Raw
            </Tab>
          </TabStrip>
        )}
        {showAgentTabs && (
          <TabStrip variant="segmented">
            <Tab
              active={mode === "rendered"}
              onClick={() => setMode("rendered")}
            >
              View
            </Tab>
            <Tab
              active={mode === "edit"}
              onClick={() => {
                if (mode !== "edit" && source.kind === "agent" && repo) {
                  void loadAgentEditState({
                    repo,
                    source,
                    agentOverride,
                    setDraft: setAgentEditDraft,
                    setLoaded: setAgentEditLoaded,
                    setKbs: setAgentEditKbs,
                    setDss: setAgentEditDss,
                    setFss: setAgentEditFss,
                  });
                }
                setEditError(null);
                setMode("edit");
              }}
            >
              Edit
            </Tab>
            <Tab
              active={mode === "raw"}
              onClick={() => setMode("raw")}
            >
              Raw
            </Tab>
          </TabStrip>
        )}
        {showPeopleTabs && renderRecordListHeader({
          dbName: "people",
          collection: source.kind === "people-list" ? source.collection : undefined,
          existingKeys: source.kind === "people-list" ? source.people.map((p) => p.key) : [],
          newTitle: "Draft a new contact",
          view: peopleView,
          setView: setPeopleView,
        })}
        {showAccessTabs && renderRecordListHeader({
          dbName: "access",
          collection: source.kind === "access-list" ? source.collection : undefined,
          existingKeys: source.kind === "access-list" ? source.records.map((r) => r.key) : [],
          newTitle: "Draft a new access record",
          view: accessView,
          setView: setAccessView,
        })}
        {showAssetsTabs && renderRecordListHeader({
          dbName: "assets",
          collection: source.kind === "assets-list" ? source.collection : undefined,
          existingKeys: source.kind === "assets-list" ? source.records.map((r) => r.key) : [],
          newTitle: "Draft a new asset record",
          view: assetsView,
          setView: setAssetsView,
        })}
        {showConversationsFilter && (
          <>
            {source.kind === "conversations-list" && source.collection && onShowSource && repo && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (source.kind !== "conversations-list" || !source.collection) return;
                  const col = source.collection;
                  const fields = (col.schema as { fields?: Array<Record<string, unknown>> })?.fields ?? [];
                  const template: Record<string, unknown> = {};
                  for (const f of fields) {
                    const id = f.id as string;
                    if (id === "createdAt" || id === "updatedAt") {
                      template[id] = new Date().toISOString();
                    } else if (id === "askerChannel") {
                      template[id] = "desktop";
                    } else if (id === "status") {
                      template[id] = "open";
                    } else if (id === "priority") {
                      template[id] = "normal";
                    } else {
                      template[id] = "";
                    }
                  }
                  const taken = new Set(source.threads.map((t) => t.ticketId));
                  let filename = "new-ticket.json";
                  let i = 2;
                  while (taken.has(filename.replace(".json", ""))) {
                    filename = `new-ticket-${i}.json`;
                    i += 1;
                  }
                  onShowSource({
                    kind: "draft-file",
                    path: `${repo}/databases/tickets/${filename}`,
                    subdir: "databases/tickets",
                    filename,
                    initialContent: JSON.stringify(template, null, 2),
                    collection: col,
                  });
                }}
                title="Create a new ticket"
              >
                + New
              </Button>
            )}
            <TabStrip>
              {(["all", "open", "resolved", "escalated"] as const).map((key) => (
                <Tab
                  key={key}
                  active={conversationsFilter === key}
                  count={conversationCounts[key]}
                  onClick={() => setConversationsFilter(key)}
                >
                  {key === "all" ? "All" : key[0].toUpperCase() + key.slice(1)}
                </Tab>
              ))}
            </TabStrip>
          </>
        )}
        {showAddToChat && (
          <Button
            variant="linkMuted"
            onClick={handleAddToChat}
            title="Paste these contents into Claude in the right pane"
          >
            add to chat
            <span className="arrow" aria-hidden="true">→</span>
          </Button>
        )}
      </div>
      {(chatAddPath || attachmentsTicketId) && (
        <div className="viewer-subheader">
          {attachmentsTicketId && onOpenPath && (
            <Button
              variant="linkMuted"
              onClick={() => {
                void onOpenPath(`${repo}/databases/conversations/${attachmentsTicketId}`);
              }}
              title="Open the related conversation thread"
            >
              conversation
              <span className="arrow" aria-hidden="true">→</span>
            </Button>
          )}
          {chatAddPath && (
            <Button
              variant="linkMuted"
              onClick={() => {
                writeToActiveSession(chatAddPath + " ").catch((e) =>
                  console.warn("[viewer] add-to-chat failed:", e),
                );
              }}
              title="Reference this in Claude"
            >
              add to chat
              <span className="arrow" aria-hidden="true">→</span>
            </Button>
          )}
        </div>
      )}
      <PaneBody flush={flushBody}>{renderBody()}</PaneBody>
    </div>
  );
}
