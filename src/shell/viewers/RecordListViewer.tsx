/// Record-list sub-viewers extracted from Viewer.tsx.
/// Handles `people-list`, `access-list`, and `assets-list` rendering.
/// All three share the same Cards / Table toggle pattern.
/// No behavior changes — purely structural extraction.

import type { DataCollection, MemoryItem } from "../../lib/localTypes";
import type { PersonSummary, AccessSummary, AssetSummary } from "../viewerTypes";
import { DataTable } from "../DataTable";
import { Button } from "../../ui";
import { TrashIcon } from "../TrashIcon";
import { deleteFileInSubdir } from "./viewerHelpers";

// ---------------------------------------------------------------------------
// PeopleListBody
// ---------------------------------------------------------------------------

export function PeopleListBody({
  view,
  people,
  collection,
  items,
  repo,
  onOpenPath,
  folderUploadError,
  setFolderUploadError,
  showToast,
  onFsChange,
}: {
  view: "cards" | "table";
  people: PersonSummary[];
  collection: DataCollection;
  items: MemoryItem[];
  repo: string;
  onOpenPath?: (path: string) => void | Promise<void>;
  folderUploadError: string | null;
  setFolderUploadError: (err: string | null) => void;
  showToast: (msg: string) => void;
  onFsChange?: () => void;
}) {
  if (view === "table") {
    return (
      <div className="viewer-summary viewer-people">
        {folderUploadError && (
          <p className="viewer-edit-error">{folderUploadError}</p>
        )}
        <DataTable
          collection={collection}
          items={items}
          onRowClick={(key) => {
            if (onOpenPath) {
              void onOpenPath(`${repo}/databases/${collection.name}/${key}.json`);
            }
          }}
          onRowDelete={
            repo
              ? async (key) => {
                  await deleteFileInSubdir(
                    repo,
                    `databases/${collection.name}`,
                    `${key}.json`,
                    setFolderUploadError,
                    showToast,
                    onFsChange,
                  );
                }
              : undefined
          }
        />
      </div>
    );
  }

  if (people.length === 0) {
    return (
      <div className="viewer-summary viewer-people">
        <p className="summary-desc">
          No people yet. People rows let you identify task assignees and
          teammates consistently across your vault.
        </p>
      </div>
    );
  }

  return (
    <div className="viewer-summary viewer-people">
      {folderUploadError && (
        <p className="viewer-edit-error">{folderUploadError}</p>
      )}
      <div className="viewer-thread-list">
        {people.map((p) => (
          <div key={p.key} className="thread-card-wrapper">
            <button
              type="button"
              className="thread-card thread-card-person"
              onClick={() => {
                if (onOpenPath) {
                  void onOpenPath(`${repo}/databases/people/${p.key}.json`);
                }
              }}
              title={`Open ${p.name || p.email || p.key}`}
            >
              <div className="thread-card-row">
                <span className="thread-card-subject">
                  {p.name || p.email || p.key}
                </span>
                {p.role && (
                  <span className="thread-card-status">{p.role}</span>
                )}
              </div>
              <div className="thread-card-meta">
                {p.email && p.email !== p.name && (
                  <span className="thread-card-asker">{p.email}</span>
                )}
                {p.department && (
                  <span className="thread-card-count">{p.department}</span>
                )}
              </div>
            </button>
            {repo && (
              <Button
                variant="ghost"
                tone="destructive"
                size="sm"
                iconOnly
                className="entity-card-delete thread-card-delete"
                title={`Delete ${p.name || p.email || p.key}`}
                aria-label={`Delete ${p.name || p.email || p.key}`}
                onClick={(e) => {
                  e.stopPropagation();
                  void deleteFileInSubdir(
                    repo,
                    "databases/people",
                    `${p.key}.json`,
                    setFolderUploadError,
                    showToast,
                    onFsChange,
                  );
                }}
              >
                <TrashIcon />
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AccessListBody
// ---------------------------------------------------------------------------

export function AccessListBody({
  view,
  records,
  collection,
  items,
  repo,
  onOpenPath,
  folderUploadError,
  setFolderUploadError,
  showToast,
  onFsChange,
}: {
  view: "cards" | "table";
  records: AccessSummary[];
  collection: DataCollection;
  items: MemoryItem[];
  repo: string;
  onOpenPath?: (path: string) => void | Promise<void>;
  folderUploadError: string | null;
  setFolderUploadError: (err: string | null) => void;
  showToast: (msg: string) => void;
  onFsChange?: () => void;
}) {
  if (view === "table") {
    return (
      <div className="viewer-summary viewer-access">
        {folderUploadError && (
          <p className="viewer-edit-error">{folderUploadError}</p>
        )}
        <DataTable
          collection={collection}
          items={items}
          onRowClick={(key) => {
            if (onOpenPath) {
              void onOpenPath(`${repo}/databases/${collection.name}/${key}.json`);
            }
          }}
          onRowDelete={
            repo
              ? async (key) => {
                  await deleteFileInSubdir(
                    repo,
                    `databases/${collection.name}`,
                    `${key}.json`,
                    setFolderUploadError,
                    showToast,
                    onFsChange,
                  );
                }
              : undefined
          }
        />
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div className="viewer-summary viewer-access">
        <p className="summary-desc">
          No access records yet. Onboard and offboard actions will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="viewer-summary viewer-access">
      {folderUploadError && (
        <p className="viewer-edit-error">{folderUploadError}</p>
      )}
      <div className="viewer-thread-list">
        {records.map((r) => (
          <div key={r.key} className="thread-card-wrapper">
            <button
              type="button"
              className="thread-card thread-card-person"
              onClick={() => {
                if (onOpenPath) {
                  void onOpenPath(`${repo}/databases/access/${r.key}.json`);
                }
              }}
              title={`Open ${r.employee || r.email || r.key}`}
            >
              <div className="thread-card-row">
                <span className="thread-card-subject">
                  {r.employee || r.email || r.key}
                </span>
              </div>
              <div className="thread-card-meta">
                {r.email && r.email !== r.employee && (
                  <span className="thread-card-asker">{r.email}</span>
                )}
                {r.role && (
                  <span className="thread-card-count">{r.role}</span>
                )}
                {r.date && (
                  <span className="thread-card-count">{r.date}</span>
                )}
              </div>
            </button>
            {repo && (
              <Button
                variant="ghost"
                tone="destructive"
                size="sm"
                iconOnly
                className="entity-card-delete thread-card-delete"
                title={`Delete ${r.employee || r.email || r.key}`}
                aria-label={`Delete ${r.employee || r.email || r.key}`}
                onClick={(e) => {
                  e.stopPropagation();
                  void deleteFileInSubdir(
                    repo,
                    "databases/access",
                    `${r.key}.json`,
                    setFolderUploadError,
                    showToast,
                    onFsChange,
                  );
                }}
              >
                <TrashIcon />
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AssetsListBody
// ---------------------------------------------------------------------------

export function AssetsListBody({
  view,
  records,
  collection,
  items,
  repo,
  onOpenPath,
  folderUploadError,
  setFolderUploadError,
  showToast,
  onFsChange,
}: {
  view: "cards" | "table";
  records: AssetSummary[];
  collection: DataCollection;
  items: MemoryItem[];
  repo: string;
  onOpenPath?: (path: string) => void | Promise<void>;
  folderUploadError: string | null;
  setFolderUploadError: (err: string | null) => void;
  showToast: (msg: string) => void;
  onFsChange?: () => void;
}) {
  if (view === "table") {
    return (
      <div className="viewer-summary viewer-assets">
        {folderUploadError && (
          <p className="viewer-edit-error">{folderUploadError}</p>
        )}
        <DataTable
          collection={collection}
          items={items}
          onRowClick={(key) => {
            if (onOpenPath) {
              void onOpenPath(`${repo}/databases/${collection.name}/${key}.json`);
            }
          }}
          onRowDelete={
            repo
              ? async (key) => {
                  await deleteFileInSubdir(
                    repo,
                    `databases/${collection.name}`,
                    `${key}.json`,
                    setFolderUploadError,
                    showToast,
                    onFsChange,
                  );
                }
              : undefined
          }
        />
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div className="viewer-summary viewer-assets">
        <p className="summary-desc">
          No assets yet. Devices and equipment will appear here once tracked.
        </p>
      </div>
    );
  }

  return (
    <div className="viewer-summary viewer-assets">
      {folderUploadError && (
        <p className="viewer-edit-error">{folderUploadError}</p>
      )}
      <div className="viewer-thread-list">
        {records.map((r) => (
          <div key={r.key} className="thread-card-wrapper">
            <button
              type="button"
              className="thread-card thread-card-person"
              onClick={() => {
                if (onOpenPath) {
                  void onOpenPath(`${repo}/databases/assets/${r.key}.json`);
                }
              }}
              title={`Open ${r.name || r.key}`}
            >
              <div className="thread-card-row">
                <span className="thread-card-subject">
                  {r.name || r.key}
                </span>
                {r.status && (
                  <span className={`thread-card-status ${r.status === "available" ? "thread-card-status-ok" : r.status === "assigned" ? "thread-card-status-info" : r.status === "decommissioned" || r.status === "repair" ? "thread-card-status-warn" : ""}`}>
                    {r.status}
                  </span>
                )}
              </div>
              <div className="thread-card-meta" style={{ paddingRight: 32 }}>
                {r.type && (
                  <span className="thread-card-asker">{r.type}</span>
                )}
                {r.assignedTo && (
                  <span className="thread-card-count">{r.assignedTo}</span>
                )}
                {r.serialNumber && (
                  <span className="thread-card-count">{r.serialNumber}</span>
                )}
              </div>
            </button>
            {repo && (
              <Button
                variant="ghost"
                tone="destructive"
                size="sm"
                iconOnly
                className="entity-card-delete thread-card-delete"
                title={`Delete ${r.name || r.key}`}
                aria-label={`Delete ${r.name || r.key}`}
                onClick={(e) => {
                  e.stopPropagation();
                  void deleteFileInSubdir(
                    repo,
                    "databases/assets",
                    `${r.key}.json`,
                    setFolderUploadError,
                    showToast,
                    onFsChange,
                  );
                }}
              >
                <TrashIcon />
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
