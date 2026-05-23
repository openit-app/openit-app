/// Re-exports for the viewers/ directory. Sub-viewers that already
/// existed (ImageViewer, PdfViewer, SpreadsheetViewer, OfficeViewer)
/// plus newly extracted modules (AgentViewer helpers, viewerHelpers).

export { ImageViewer } from "./ImageViewer";
export { PdfViewer } from "./PdfViewer";
export { SpreadsheetViewer } from "./SpreadsheetViewer";
export { OfficeViewer } from "./OfficeViewer";

// Agent-specific sub-components and logic
export {
  AgentResourceSection,
  AgentToolsSection,
  AgentRenderedView,
  AgentEditForm,
  AgentRawView,
  loadAgentEditState,
  saveAgentEditDraft,
  normalizeResourceRow,
  mergeResourceRows,
  mergeServerRows,
} from "./AgentViewer";
export type { AgentResourceFormRow, AgentEditDraft } from "./AgentViewer";

// Shared helpers, constants, and utility functions
export {
  BRACKETED_PASTE_OPEN,
  BRACKETED_PASTE_CLOSE,
  AGENT_MODEL_OPTIONS,
  AGENT_TRIAGE_SUBDIR,
  ENTITY_FOLDER_LABELS,
  ENTITY_FOLDER_EMPTY_COPY,
  NEW_FILE_TEMPLATES,
  ExternalAnchor,
  isMarkdown,
  isJsonFile,
  isMjsScript,
  isRunnableScript,
  hasEditableTextMode,
  isImage,
  isPdf,
  isSpreadsheet,
  isOfficeDoc,
  mimeForPath,
  toRepoRelative,
  sanitizeUploadFilename,
  uploadFilesToSubdir,
  confirmDelete,
  deleteFileInSubdir,
} from "./viewerHelpers";
export type { ViewMode } from "./viewerHelpers";

// Tasks viewer — flat Linear-style list. Replaces the bespoke ticket UI.
export { TasksViewer } from "./TasksViewer";

// Datastore sub-viewers
export { DatastoreTableBody, DatastoreRowBody, DatastoreSchemaBody, GenericRecordCardsBody } from "./DatastoreViewer";

// Record-list sub-viewers (people, access, assets)
export { PeopleListBody, AccessListBody, AssetsListBody } from "./RecordListViewer";

// Agent-trace sub-viewers
export { AgentTraceBody, AgentTraceListBody } from "./AgentTraceViewer";

// Entity-folder sub-viewer
export { EntityFolderBody } from "./EntityFolderViewer";
