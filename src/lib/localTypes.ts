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
