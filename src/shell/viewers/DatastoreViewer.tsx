/// Datastore sub-viewers extracted from Viewer.tsx.
/// Handles `datastore-table`, `datastore-row`, and `datastore-schema`
/// rendering plus a generic schema-driven card view for custom datastores.

import { type ReactNode } from "react";
import type { DataCollection, MemoryItem } from "../../lib/localTypes";
import { DataTable } from "../DataTable";
import { RowEditForm } from "../RowEditForm";
import { deleteFileInSubdir } from "./viewerHelpers";
import { EntityCardGrid } from "../EntityCardGrid";

// ---------------------------------------------------------------------------
// DatastoreTableBody
// ---------------------------------------------------------------------------

export function DatastoreTableBody({
  collection,
  tableItems,
  tableLoading,
  tableHasMore,
  repo,
  onOpenPath,
  setFolderUploadError,
  showToast,
  onFsChange,
}: {
  collection: DataCollection;
  tableItems: MemoryItem[];
  tableLoading: boolean;
  tableHasMore: boolean;
  repo: string;
  onOpenPath?: (path: string) => void | Promise<void>;
  setFolderUploadError: (err: string | null) => void;
  showToast: (msg: string) => void;
  onFsChange?: () => void;
}) {
  if (tableLoading && tableItems.length === 0) {
    return <div className="viewer-content" style={{ opacity: 0.5 }}>Loading table data...</div>;
  }
  if (tableItems.length === 0) {
    const colName = collection.name;
    const message =
      colName === "tickets"
        ? "No tickets yet. Tickets land here when someone files one via the Intake form (top-right header) — share that URL on your machine and the new rows show up immediately."
        : colName === "people"
          ? "No people records yet. People rows are referenced by tickets (asker, assignee) and access audits. Ask Claude — \"add Alice from Engineering\" — or sync a directory once you connect to cloud."
          : `No rows in "${colName}" yet. Add one by editing the JSON files on disk under databases/${colName}/, or ask Claude to populate this collection.`;
    return (
      <div className="viewer-summary">
        <p className="summary-desc">{message}</p>
      </div>
    );
  }
  return (
    <DataTable
      collection={collection}
      items={tableItems}
      hasMore={tableHasMore}
      onLoadMore={undefined}
      onRowClick={(key) => {
        const filePath = `${repo}/databases/${collection.name}/${key}.json`;
        if (onOpenPath) void onOpenPath(filePath);
      }}
      onRowDelete={
        repo
          ? (key) =>
              deleteFileInSubdir(
                repo,
                `databases/${collection.name}`,
                `${key}.json`,
                setFolderUploadError,
                showToast,
                onFsChange,
              )
          : undefined
      }
    />
  );
}

// ---------------------------------------------------------------------------
// GenericRecordCardsBody — schema-driven card view for any datastore
// ---------------------------------------------------------------------------

export function GenericRecordCardsBody({
  collection,
  items,
  repo,
  onOpenPath,
  setFolderUploadError,
  showToast,
  onFsChange,
}: {
  collection: DataCollection;
  items: MemoryItem[];
  repo: string;
  onOpenPath?: (path: string) => void | Promise<void>;
  setFolderUploadError: (err: string | null) => void;
  showToast: (msg: string) => void;
  onFsChange?: () => void;
}) {
  const schemaFields = (
    (collection.schema as Record<string, unknown> | undefined)?.fields ?? []
  ) as Array<{ id: string; label?: string; type?: string }>;

  if (items.length === 0) {
    return (
      <div className="viewer-summary">
        <p className="summary-desc">
          No records in &ldquo;{collection.name}&rdquo; yet. Create one with
          the <strong>+ New</strong> button or ask Claude to populate this
          collection.
        </p>
      </div>
    );
  }

  const cards = items.map((it) => {
    const c = it.content as Record<string, unknown> | null;
    if (!c || typeof c !== "object") {
      return {
        key: it.key || it.id,
        title: it.key || it.id,
        onClick: () => {
          const filePath = `${repo}/databases/${collection.name}/${it.key || it.id}.json`;
          if (onOpenPath) void onOpenPath(filePath);
        },
      };
    }

    // Use schema fields to pick title/description/meta
    const stringFields = schemaFields.length > 0
      ? schemaFields
      : Object.keys(c).map((k) => ({ id: k }));

    // Title = first field's value, description = second field, meta = third
    const titleField = stringFields[0];
    const descField = stringFields[1];
    const metaFields = stringFields.slice(2, 5); // show up to 3 extra fields

    const titleVal = titleField ? String(c[titleField.id] ?? "") : "";
    const descVal = descField ? String(c[descField.id] ?? "") : "";
    const metaParts = metaFields
      .map((f) => {
        const v = c[f.id];
        if (v === null || v === undefined || v === "") return null;
        return String(v);
      })
      .filter(Boolean);
    const metaStr = metaParts.join(" · ");

    return {
      key: it.key || it.id,
      title: titleVal || it.key || it.id,
      description: descVal || undefined,
      meta: metaStr || undefined,
      onClick: () => {
        const filePath = `${repo}/databases/${collection.name}/${it.key || it.id}.json`;
        if (onOpenPath) void onOpenPath(filePath);
      },
      onDelete: repo
        ? () =>
            deleteFileInSubdir(
              repo,
              `databases/${collection.name}`,
              `${(it.key || it.id)}.json`,
              setFolderUploadError,
              showToast,
              onFsChange,
            )
        : undefined,
    };
  });

  return <EntityCardGrid kind="databases" cards={cards} />;
}

// ---------------------------------------------------------------------------
// DatastoreRowBody
// ---------------------------------------------------------------------------

export function DatastoreRowBody({
  collection,
  liveItem,
  mode,
  content,
  rowEditDraft,
  setRowEditDraft,
  editSaving,
  editError,
  setEditSaving,
  setEditError,
  setContent,
  setRowOverride,
  setMode,
  repo,
}: {
  collection: DataCollection;
  liveItem: MemoryItem;
  mode: string;
  content: string;
  rowEditDraft: Record<string, unknown>;
  setRowEditDraft: (d: Record<string, unknown>) => void;
  editSaving: boolean;
  editError: string | null;
  setEditSaving: (v: boolean) => void;
  setEditError: (v: string | null) => void;
  setContent: (v: string) => void;
  setRowOverride: (v: MemoryItem | null) => void;
  setMode: (m: "table" | "edit" | "raw" | "rendered") => void;
  repo: string;
}) {
  if (mode === "table") {
    const schemaFields = ((collection.schema as Record<string, unknown> | undefined)?.fields ?? []) as Array<{
      id: string;
      label?: string;
      type?: string;
      values?: string[];
      nullable?: boolean;
    }>;
    const rowContent =
      liveItem.content && typeof liveItem.content === "object"
        ? (liveItem.content as Record<string, unknown>)
        : {};
    // When no schema is defined, auto-detect fields from the
    // record's JSON content so the View tab isn't blank.
    const fields: Array<{ id: string; label?: string; type?: string }> =
      schemaFields.length > 0
        ? schemaFields
        : Object.keys(rowContent).map((k) => {
            const v = rowContent[k];
            const type = Array.isArray(v) ? "string[]" : typeof v === "string" && v.length > 100 ? "text" : undefined;
            return { id: k, type };
          });
    const renderValue = (
      field: { id: string; type?: string },
      value: unknown,
    ): ReactNode => {
      const empty =
        value === null ||
        value === undefined ||
        (typeof value === "string" && value === "") ||
        (Array.isArray(value) && value.length === 0);
      if (empty) {
        return <span className="row-view-empty">—</span>;
      }
      if (field.type === "string[]" && Array.isArray(value)) {
        return (
          <div className="row-view-tags">
            {value.map((v, i) => (
              <span key={i} className="thread-card-tag">
                {String(v)}
              </span>
            ))}
          </div>
        );
      }
      if (field.type === "text" && typeof value === "string") {
        return <div className="row-view-text">{value}</div>;
      }
      if (typeof value === "boolean") {
        return <span>{value ? "Yes" : "No"}</span>;
      }
      if (typeof value === "object") {
        return <code className="row-view-code">{JSON.stringify(value)}</code>;
      }
      return <span>{String(value)}</span>;
    };
    return (
      <div className="row-view">
        <div className="row-view-key">
          <span className="row-view-key-label">Key</span>
          <code className="row-view-code">{liveItem.key || liveItem.id}</code>
        </div>
        <dl className="row-view-fields">
          {fields.map((field) => (
            <div key={field.id} className="row-view-field">
              <dt>{field.label ?? field.id}</dt>
              <dd>{renderValue(field, rowContent[field.id])}</dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }
  if (mode === "edit") {
    const rowKey = liveItem.key || liveItem.id;
    const onSave = async () => {
      if (!repo) {
        setEditError("Cannot save: no repo open.");
        return;
      }
      setEditSaving(true);
      setEditError(null);
      try {
        const { entityWriteFile } = await import("../../lib/api");
        const json = JSON.stringify(rowEditDraft, null, 2);
        await entityWriteFile(
          repo,
          `databases/${collection.name}`,
          `${rowKey}.json`,
          json,
        );
        setContent(json);
        setRowOverride({ ...liveItem, content: rowEditDraft });
        setMode("table");
      } catch (err) {
        setEditError(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setEditSaving(false);
      }
    };
    const onCancel = () => {
      setRowEditDraft({});
      setEditError(null);
      setMode("table");
    };
    return (
      <RowEditForm
        collection={collection}
        draft={rowEditDraft}
        onChange={setRowEditDraft}
        onSave={onSave}
        onCancel={onCancel}
        saving={editSaving}
        error={editError}
      />
    );
  }
  return <pre className="viewer-content">{content}</pre>;
}

// ---------------------------------------------------------------------------
// DatastoreSchemaBody
// ---------------------------------------------------------------------------

export function DatastoreSchemaBody({
  collection,
  mode,
  content,
  renderEditTextarea,
  repo,
}: {
  collection: DataCollection;
  mode: string;
  content: string;
  renderEditTextarea: (args: {
    filePath: string;
    afterMode: "raw" | "rendered" | "edit";
    validateAsJson: boolean;
  }) => ReactNode;
  repo: string;
}) {
  if (mode === "edit") {
    return renderEditTextarea({
      filePath: `${repo}/databases/${collection.name}/_schema.json`,
      afterMode: "raw",
      validateAsJson: true,
    });
  }
  return <pre className="viewer-content">{content}</pre>;
}
