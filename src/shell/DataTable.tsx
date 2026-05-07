import { useMemo, useState } from "react";
import type { DataCollection, MemoryItem } from "../lib/localTypes";
import { TrashIcon } from "./TrashIcon";

type Props = {
  collection: DataCollection;
  items: MemoryItem[];
  hasMore?: boolean;
  onLoadMore?: () => void;
  onRowClick?: (key: string) => void;
  /** When set, every row gets a trailing trash cell that calls this
   *  handler with the row's key. The handler is responsible for
   *  confirmation; the table just stops propagation so the row's
   *  onRowClick doesn't fire alongside the delete. */
  onRowDelete?: (key: string) => void | Promise<void>;
};

type SortState = { fieldId: string; direction: "asc" | "desc" } | null;

function formatCell(value: unknown, fieldType: string): string {
  if (value == null) return "";
  if (fieldType === "boolean") return value ? "Yes" : "No";
  return String(value);
}

export function DataTable({ collection, items, hasMore, onLoadMore, onRowClick, onRowDelete }: Props) {
  const [sort, setSort] = useState<SortState>(null);

  const fields = (collection.schema as { fields?: Array<Record<string, unknown>> })?.fields ?? [];

  const handleHeaderClick = (fieldId: string) => {
    setSort((prev) => {
      if (prev?.fieldId === fieldId) {
        return prev.direction === "asc"
          ? { fieldId, direction: "desc" }
          : null;
      }
      return { fieldId, direction: "asc" };
    });
  };

  const parsedRows = useMemo(() => {
    return items.map((item) => {
      let parsed: Record<string, unknown> = {};
      try {
        if (typeof item.content === "object" && item.content !== null) {
          parsed = item.content as Record<string, unknown>;
        } else if (typeof item.content === "string") {
          parsed = JSON.parse(item.content);
        }
      } catch {
        // content is not valid JSON; leave parsed empty
      }
      return { key: item.key, parsed };
    });
  }, [items]);

  const sortedRows = useMemo(() => {
    if (!sort) return parsedRows;

    const { fieldId, direction } = sort;
    const sorted = [...parsedRows];
    sorted.sort((a, b) => {
      const aVal = fieldId === "key" ? a.key : a.parsed[fieldId];
      const bVal = fieldId === "key" ? b.key : b.parsed[fieldId];

      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;

      if (typeof aVal === "number" && typeof bVal === "number") {
        return direction === "asc" ? aVal - bVal : bVal - aVal;
      }

      const aStr = String(aVal);
      const bStr = String(bVal);
      const cmp = aStr.localeCompare(bStr);
      return direction === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [parsedRows, sort]);

  return (
    <div className="data-table">
      <table>
        <thead>
          <tr className="data-table-header">
            <th
              onClick={() => handleHeaderClick("key")}
              style={{ cursor: "pointer" }}
            >
              Key{sort?.fieldId === "key" ? (sort.direction === "asc" ? " \u25B2" : " \u25BC") : ""}
            </th>
            {fields.map((field: Record<string, unknown>) => (
              <th
                key={field.id as string}
                onClick={() => handleHeaderClick(field.id as string)}
                style={{ cursor: "pointer" }}
              >
                {field.label as string}
                {sort?.fieldId === field.id
                  ? sort?.direction === "asc"
                    ? " \u25B2"
                    : " \u25BC"
                  : ""}
              </th>
            ))}
            {onRowDelete && <th className="data-table-action-col" aria-label="actions" />}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row, idx) => (
            <tr
              key={row.key || idx}
              className={`data-table-row${onRowClick ? " data-table-row-clickable" : ""}`}
              onClick={onRowClick && row.key ? () => onRowClick(row.key) : undefined}
            >
              <td className="data-table-cell">{row.key}</td>
              {fields.map((field: Record<string, unknown>) => (
                <td key={field.id as string} className="data-table-cell">
                  {formatCell(row.parsed[field.id as string], field.type as string)}
                </td>
              ))}
              {onRowDelete && (
                <td className="data-table-cell data-table-action-cell">
                  {row.key && (
                    <button
                      type="button"
                      className="data-table-delete"
                      title={`Delete ${row.key}`}
                      aria-label={`Delete ${row.key}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        void onRowDelete(row.key);
                      }}
                    >
                      <TrashIcon />
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {hasMore && (
        <button className="data-table-load-more" onClick={onLoadMore}>
          Load more
        </button>
      )}
    </div>
  );
}
