/// Shared catalog types and helpers. Both `toolsCatalog.ts` and
/// `mcpCatalog.ts` extend from this base so the shared pattern
/// (id + name + description + docsUrl + find-by-id) is defined once.

/// Fields every catalog entry carries regardless of whether it's
/// a CLI tool or an MCP server.
export interface CatalogEntryBase {
  /// Stable unique key.
  id: string;
  name: string;
  description: string;
  /// Vendor documentation URL.
  docsUrl: string;
}

/// Generic find helper. Returns the first entry whose `id` matches,
/// or `undefined` if none does. Works on any catalog whose entries
/// extend `CatalogEntryBase`.
export function createCatalogFinder<T extends CatalogEntryBase>(
  catalog: T[],
): (id: string) => T | undefined {
  return (id: string) => catalog.find((e) => e.id === id);
}
