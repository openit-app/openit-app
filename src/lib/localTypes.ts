// Local type definitions for entity data structures.
// These were previously defined in cloud-specific modules (skillsApi.ts,
// agentSync.ts, workflowSync.ts). Now defined locally since the app
// operates on files on disk, not cloud APIs.

/// A data collection (datastore, KB, or filestore). In local-first mode
/// these are derived from the on-disk folder structure rather than a
/// cloud API response.
export type DataCollection = {
  id: string;
  name: string;
  type: string;
  description?: string;
  numItems?: number;
  schema?: unknown;
  isStructured?: boolean;
};

/// A single row in a datastore collection. Content is the parsed JSON
/// from the on-disk file.
export type MemoryItem = {
  id: string;
  key: string;
  content: unknown;
  createdAt: string;
  updatedAt: string;
  sortField?: string;
};

/// Agent configuration read from `agents/<name>/<name>.json`.
export type AgentRow = {
  id?: string;
  name: string;
  description?: string;
  selectedModel?: string;
  isShared?: boolean;
  promptExamples?: unknown;
  introMessage?: string;
  resources?: unknown;
  tools?: unknown;
};

/// Alias used by downstream UI components.
export type Agent = AgentRow;

/// Workflow configuration read from `workflows/<name>.json`.
export type WorkflowRow = {
  id?: string;
  name: string;
  description?: string;
  triggers?: unknown;
  inputs?: unknown;
};

/// Alias used by downstream UI components.
export type Workflow = WorkflowRow;
