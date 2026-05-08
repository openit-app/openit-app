/// Agent-specific sub-components and helpers extracted from the
/// original Viewer.tsx. Includes: AgentResourceSection, AgentToolsSection,
/// AgentRenderedView, loadAgentEditState, saveAgentEditDraft, and
/// supporting merge/normalize utilities.

import { useEffect, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { fsRead, fsList, entityWriteFile } from "../../lib/api";
import type { Agent } from "../../lib/localTypes";
import { Button } from "../../ui";
import type { ViewerSource } from "../viewerTypes";
import { AGENT_TRIAGE_SUBDIR } from "./viewerHelpers";

// ── Types ────────────────────────────────────────────────────────────

export type AgentResourceFormRow = {
  name: string;
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
};

function stripOpenitPrefix(name: string): string {
  return name.startsWith("openit-") ? name.slice("openit-".length) : name;
}

// ── Normalize / Merge helpers ────────────────────────────────────────

export function normalizeResourceRow(r: AgentResourceFormRow | { name?: string; canRead?: boolean; canWrite?: boolean; canDelete?: boolean }): AgentResourceFormRow {
  return {
    name: typeof r.name === "string" ? r.name : "",
    canRead: typeof r.canRead === "boolean" ? r.canRead : true,
    canWrite: typeof r.canWrite === "boolean" ? r.canWrite : false,
    canDelete: typeof r.canDelete === "boolean" ? r.canDelete : false,
  };
}

export function mergeResourceRows(
  loaded: AgentResourceFormRow[] | undefined,
  formRows: AgentResourceFormRow[],
): AgentResourceFormRow[] {
  // Drop rows where every permission is false (mirrors platform
  // validateResources). Form name keys the row identity; unknown loaded
  // names round-trip verbatim.
  const formByName = new Map(formRows.map((r) => [r.name, r]));
  const out: AgentResourceFormRow[] = [];
  if (Array.isArray(loaded)) {
    for (const row of loaded) {
      if (formByName.has(row.name)) {
        const merged = formByName.get(row.name)!;
        if (merged.canRead || merged.canWrite || merged.canDelete) out.push(merged);
        formByName.delete(row.name);
      } else {
        out.push(normalizeResourceRow(row));
      }
    }
  }
  for (const r of formByName.values()) {
    if (r.canRead || r.canWrite || r.canDelete) out.push(r);
  }
  return out;
}

export function mergeServerRows(
  loaded: { name: string; allTools?: boolean; [k: string]: unknown }[],
  formRows: { name: string; allTools: boolean }[],
): { name: string; allTools: boolean; [k: string]: unknown }[] {
  const formByName = new Map(formRows.map((r) => [r.name, r]));
  const out: { name: string; allTools: boolean; [k: string]: unknown }[] = [];
  for (const row of loaded) {
    const formRow = formByName.get(row.name);
    if (formRow) {
      out.push({ ...row, name: formRow.name, allTools: formRow.allTools });
      formByName.delete(row.name);
    } else {
      out.push({ ...row, name: row.name, allTools: row.allTools ?? true });
    }
  }
  for (const r of formByName.values()) out.push(r);
  return out;
}

// ── Load / Save ──────────────────────────────────────────────────────

export async function loadAgentEditState(args: {
  repo: string;
  source: ViewerSource | null;
  agentOverride: Agent | null;
  setDraft: (draft: {
    description: string;
    common: string;
    cloud: string;
    local: string;
    selectedModel: string;
    isShared: boolean;
    promptExamples: string;
    introMessage: string;
    knowledgeBases: AgentResourceFormRow[];
    datastores: AgentResourceFormRow[];
    filestores: AgentResourceFormRow[];
    servers: { name: string; allTools: boolean }[];
  }) => void;
  setLoaded: (loaded: {
    json: Record<string, unknown>;
    common: string;
    cloud: string;
    local: string;
  }) => void;
  setKbs: (list: string[] | null) => void;
  setDss: (list: string[] | null) => void;
  setFss: (list: string[] | null) => void;
}): Promise<void> {
  if (!args.source || args.source.kind !== "agent") return;
  const a = args.agentOverride ?? args.source.agent;
  // Re-read triage.json from disk so we capture every field the form
  // doesn't render (V4 will add per-tool config; cloud may have a 4th
  // MCP server). Without this, Save round-trips only the fields the
  // form knows about and silently drops anything else.
  let parsed: Record<string, unknown> = {};
  try {
    const raw = await fsRead(args.source.path);
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // fall back to the in-memory shape — better than blank form
    parsed = JSON.parse(JSON.stringify(a)) as Record<string, unknown>;
  }
  const repo = args.repo;
  const [common, cloud, local] = await Promise.all([
    fsRead(`${repo}/${AGENT_TRIAGE_SUBDIR}/common.md`).catch(() => ""),
    fsRead(`${repo}/${AGENT_TRIAGE_SUBDIR}/cloud.md`).catch(() => ""),
    fsRead(`${repo}/${AGENT_TRIAGE_SUBDIR}/local.md`).catch(() => ""),
  ]);
  args.setLoaded({ json: parsed, common, cloud, local });

  const resources = (parsed.resources as
    | { knowledgeBases?: AgentResourceFormRow[]; datastores?: AgentResourceFormRow[]; filestores?: AgentResourceFormRow[] }
    | undefined) ?? {};
  const tools = (parsed.tools as { servers?: { name: string; allTools?: boolean }[] } | undefined) ?? {};
  args.setDraft({
    description: typeof parsed.description === "string" ? parsed.description : "",
    common,
    cloud,
    local,
    selectedModel:
      typeof parsed.selectedModel === "string" ? parsed.selectedModel : "",
    isShared: typeof parsed.isShared === "boolean" ? parsed.isShared : false,
    promptExamples: Array.isArray(parsed.promptExamples)
      ? (parsed.promptExamples as unknown[])
          .filter((x): x is string => typeof x === "string")
          .join("\n")
      : "",
    introMessage:
      typeof parsed.introMessage === "string" ? parsed.introMessage : "",
    knowledgeBases: (resources.knowledgeBases ?? []).map(normalizeResourceRow),
    datastores: (resources.datastores ?? []).map(normalizeResourceRow),
    filestores: (resources.filestores ?? []).map(normalizeResourceRow),
    servers: (tools.servers ?? []).map((s) => ({
      name: typeof s.name === "string" ? s.name : "",
      allTools: typeof s.allTools === "boolean" ? s.allTools : true,
    })),
  });

  // Fetch collection lists from the running sync engines + a one-off
  // datastore call. Each is best-effort — errors leave that picker in
  // its empty state (which renders the "connect cloud first" hint).
  args.setKbs(null);
  args.setDss(null);
  args.setFss(null);
  // KB and filestore sync modules were removed; these collections are now
  // discovered from the on-disk folder structure, so we leave them empty.
  args.setKbs([]);
  args.setFss([]);
  try {
    const dbPath = `${args.repo}/databases`;
    const nodes = await fsList(dbPath);
    args.setDss(nodes.filter((n) => n.is_dir).map((n) => stripOpenitPrefix(n.name)));
  } catch {
    args.setDss([]);
  }
}

/// Save handler for the agent Edit form. Diffs each form field against
/// the loaded snapshot and writes only the files that actually
/// changed — no all-files-write churn on a one-character edit.
export async function saveAgentEditDraft(args: {
  repo: string;
  draft: {
    description: string;
    common: string;
    cloud: string;
    local: string;
    selectedModel: string;
    isShared: boolean;
    promptExamples: string;
    introMessage: string;
    knowledgeBases: AgentResourceFormRow[];
    datastores: AgentResourceFormRow[];
    filestores: AgentResourceFormRow[];
    servers: { name: string; allTools: boolean }[];
  };
  loaded: {
    json: Record<string, unknown>;
    common: string;
    cloud: string;
    local: string;
  } | null;
  agent: Agent;
}): Promise<void> {
  const { repo, draft, loaded, agent } = args;

  // Build the new triage.json BEFORE any disk write so we can deep-equal
  // it against the loaded snapshot and skip writing when nothing
  // changed. Without this, every Save bumps mtime and forces a re-PATCH
  // on the next push, even on a no-op Save.
  const next: Record<string, unknown> = { ...(loaded?.json ?? {}) };
  next.id = String(next.id ?? agent.id ?? "");
  next.name = String(next.name ?? agent.name ?? "");
  next.description = draft.description;
  if (draft.selectedModel) next.selectedModel = draft.selectedModel;
  else delete next.selectedModel;
  next.isShared = draft.isShared;
  const promptExamples = draft.promptExamples
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (promptExamples.length > 0) next.promptExamples = promptExamples;
  else delete next.promptExamples;
  if (draft.introMessage) next.introMessage = draft.introMessage;
  else delete next.introMessage;

  // Resources: merge form rows with any unknown rows from the loaded
  // JSON. Form rows replace by name; unknown names round-trip as-is.
  const loadedResources =
    (loaded?.json.resources as
      | { knowledgeBases?: AgentResourceFormRow[]; datastores?: AgentResourceFormRow[]; filestores?: AgentResourceFormRow[] }
      | undefined) ?? {};
  next.resources = {
    knowledgeBases: mergeResourceRows(loadedResources.knowledgeBases, draft.knowledgeBases),
    datastores: mergeResourceRows(loadedResources.datastores, draft.datastores),
    filestores: mergeResourceRows(loadedResources.filestores, draft.filestores),
  };

  // Tools.servers: same merge — preserve any cloud-side additions the
  // form doesn't render (V4 will add per-tool config UI).
  const loadedServers = ((loaded?.json.tools as { servers?: { name: string; allTools?: boolean }[] } | undefined)?.servers) ?? [];
  next.tools = { servers: mergeServerRows(loadedServers, draft.servers) };

  // Compute pending writes up-front so we can fail loudly without
  // partial-disk state. Each write is wrapped per-file: if any write
  // throws, we bail before subsequent writes — so worst case is the
  // first N succeed and the (N+1)th's content stays unwritten.
  // Atomic-across-files would require a Tauri batch write or a
  // staging dir + rename; out of scope. The error gets thrown back to
  // the Save handler which surfaces it inline.
  type Write = { filename: string; content: string };
  const pending: Write[] = [];
  if (loaded && draft.common !== loaded.common) {
    pending.push({ filename: "common.md", content: draft.common });
  }
  if (loaded && draft.cloud !== loaded.cloud) {
    pending.push({ filename: "cloud.md", content: draft.cloud });
  }
  if (loaded && draft.local !== loaded.local) {
    pending.push({ filename: "local.md", content: draft.local });
  }
  // Skip the JSON write when nothing changed — diff against loaded.
  // Use a stable serialization (same indent, same key order via the
  // ...spread) so the comparison is meaningful.
  const nextJson = JSON.stringify(next, null, 2);
  const loadedJson = loaded
    ? JSON.stringify(loaded.json, null, 2)
    : null;
  if (nextJson !== loadedJson) {
    const filename = `${agent.name}.json`;
    pending.push({ filename, content: nextJson });
  }

  for (const write of pending) {
    try {
      await entityWriteFile(repo, AGENT_TRIAGE_SUBDIR, write.filename, write.content);
    } catch (e) {
      throw new Error(
        `Save failed at ${write.filename}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}

// ── Sub-components ───────────────────────────────────────────────────

export function AgentResourceSection(props: {
  title: string;
  emptyHint: string;
  available: string[] | null;
  rows: AgentResourceFormRow[];
  onChange: (rows: AgentResourceFormRow[]) => void;
}): ReactNode {
  const { title, emptyHint, available, rows, onChange } = props;
  const attachedNames = new Set(rows.map((r) => r.name));
  const unattached = (available ?? []).filter((n) => !attachedNames.has(n));
  return (
    <div className="agent-edit-section">
      <h4 className="agent-edit-section-title">{title}</h4>
      {available !== null && available.length === 0 && (
        <p className="agent-edit-empty">{emptyHint}</p>
      )}
      {rows.length === 0 && available !== null && available.length > 0 && (
        <p className="agent-edit-empty">No {title.toLowerCase()} attached.</p>
      )}
      {rows.map((row, idx) => (
        <div className="agent-edit-row" key={`${row.name}-${idx}`}>
          <code className="agent-edit-row-name">{row.name}</code>
          <label className="agent-edit-row-perm">
            <input
              type="checkbox"
              checked={row.canRead}
              onChange={(e) => {
                const next = [...rows];
                next[idx] = { ...row, canRead: e.target.checked };
                onChange(next);
              }}
            />
            R
          </label>
          <label className="agent-edit-row-perm">
            <input
              type="checkbox"
              checked={row.canWrite}
              onChange={(e) => {
                const next = [...rows];
                next[idx] = { ...row, canWrite: e.target.checked };
                onChange(next);
              }}
            />
            W
          </label>
          <label className="agent-edit-row-perm">
            <input
              type="checkbox"
              checked={row.canDelete}
              onChange={(e) => {
                const next = [...rows];
                next[idx] = { ...row, canDelete: e.target.checked };
                onChange(next);
              }}
            />
            D
          </label>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange(rows.filter((_, i) => i !== idx))}
          >
            Remove
          </Button>
        </div>
      ))}
      {unattached.length > 0 && (
        <div className="agent-edit-add-row">
          <select
            value=""
            onChange={(e) => {
              if (!e.target.value) return;
              onChange([
                ...rows,
                {
                  name: e.target.value,
                  canRead: true,
                  canWrite: false,
                  canDelete: false,
                },
              ]);
            }}
          >
            <option value="">+ Attach {title.toLowerCase().replace(/s$/, "")}…</option>
            {unattached.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

export function AgentToolsSection(props: {
  rows: { name: string; allTools: boolean }[];
  onChange: (rows: { name: string; allTools: boolean }[]) => void;
}): ReactNode {
  const { rows, onChange } = props;
  // V2 form ships the three default MCP servers as toggles; custom
  // servers come from the loaded JSON via mergeServerRows. The form's
  // identity for each row is `name`.
  const DEFAULTS = ["knowledge-base", "datastore-structured", "filestorage"];
  const presentByName = new Map(rows.map((r) => [r.name, r]));
  const visible: { name: string; allTools: boolean }[] = [];
  for (const name of DEFAULTS) {
    visible.push(presentByName.get(name) ?? { name, allTools: true });
  }
  // Preserve any non-default servers (cloud-side adds) below the
  // defaults so the user can toggle them on/off too.
  for (const row of rows) {
    if (DEFAULTS.includes(row.name)) continue;
    visible.push(row);
  }
  const setEnabled = (name: string, enabled: boolean): void => {
    if (enabled) {
      const existing = presentByName.get(name);
      const next = [
        ...rows.filter((r) => r.name !== name),
        existing ?? { name, allTools: true },
      ];
      onChange(next);
    } else {
      onChange(rows.filter((r) => r.name !== name));
    }
  };
  return (
    <div className="agent-edit-section">
      <h4 className="agent-edit-section-title">MCP servers</h4>
      {visible.map((row) => {
        const enabled = presentByName.has(row.name);
        return (
          <label className="agent-edit-row" key={row.name}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(row.name, e.target.checked)}
            />
            <code className="agent-edit-row-name">{row.name}</code>
            <span className="agent-edit-row-hint">(all tools)</span>
          </label>
        );
      })}
    </div>
  );
}

export function AgentRenderedView(props: { agent: Agent; repo: string | null }): ReactNode {
  const { agent: a, repo } = props;
  const [common, setCommon] = useState<string>("");
  const [cloud, setCloud] = useState<string>("");
  const [local, setLocal] = useState<string>("");
  useEffect(() => {
    if (!repo) return;
    let cancelled = false;
    Promise.all([
      fsRead(`${repo}/${AGENT_TRIAGE_SUBDIR}/common.md`).catch(() => ""),
      fsRead(`${repo}/${AGENT_TRIAGE_SUBDIR}/cloud.md`).catch(() => ""),
      fsRead(`${repo}/${AGENT_TRIAGE_SUBDIR}/local.md`).catch(() => ""),
    ]).then(([c, cl, l]) => {
      if (cancelled) return;
      setCommon(c);
      setCloud(cl);
      setLocal(l);
    });
    return () => {
      cancelled = true;
    };
  }, [repo, a.id, a.name]);
  return (
    <div className="viewer-summary">
      <h2>{a.name}</h2>
      {a.description && <p className="summary-desc">{a.description}</p>}
      <div className="summary-section">
        <h3>Details</h3>
        <table className="summary-table">
          <tbody>
            <tr><td>ID</td><td><code>{a.id}</code></td></tr>
            {a.selectedModel && <tr><td>Model</td><td>{a.selectedModel}</td></tr>}
            {a.isShared !== undefined && (
              <tr><td>Shared</td><td>{a.isShared ? "Yes" : "No"}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {a.introMessage && (
        <div className="summary-section">
          <h3>Intro message</h3>
          <p>{a.introMessage}</p>
        </div>
      )}
      {Array.isArray(a.promptExamples) && (a.promptExamples as string[]).length > 0 && (
        <div className="summary-section">
          <h3>Prompt bubbles</h3>
          <ul>
            {(a.promptExamples as string[]).map((p: string, i: number) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      {a.resources ? (() => {
        const res = a.resources as { knowledgeBases?: { name: string }[]; datastores?: { name: string }[]; filestores?: { name: string }[] };
        return (
        <div className="summary-section">
          <h3>Resources</h3>
          <table className="summary-table">
            <tbody>
              {res.knowledgeBases && res.knowledgeBases.length > 0 && (
                <tr>
                  <td>Knowledge bases</td>
                  <td>{res.knowledgeBases.map((r: { name: string }) => r.name).join(", ")}</td>
                </tr>
              )}
              {res.datastores && res.datastores.length > 0 && (
                <tr>
                  <td>Datastores</td>
                  <td>{res.datastores.map((r: { name: string }) => r.name).join(", ")}</td>
                </tr>
              )}
              {res.filestores && res.filestores.length > 0 && (
                <tr>
                  <td>Filestores</td>
                  <td>{res.filestores.map((r: { name: string }) => r.name).join(", ")}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        );
      })() : null}
      {(() => {
        const tools = a.tools as { servers?: { name: string }[] } | undefined;
        return tools?.servers && tools.servers.length > 0 ? (
        <div className="summary-section">
          <h3>Tools</h3>
          <table className="summary-table">
            <tbody>
              <tr>
                <td>MCP servers</td>
                <td>{tools.servers.map((s: { name: string }) => s.name).join(", ")}</td>
              </tr>
            </tbody>
          </table>
        </div>
        ) : null;
      })()}
      {(common || cloud || local) && (
        <div className="summary-section">
          <h3>Instructions</h3>
          {common && (
            <>
              <h4>Common</h4>
              <div className="viewer-md">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{common}</ReactMarkdown>
              </div>
            </>
          )}
          {cloud && (
            <>
              <h4>Cloud-runtime</h4>
              <div className="viewer-md">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{cloud}</ReactMarkdown>
              </div>
            </>
          )}
          {local && (
            <>
              <h4>Local-runtime</h4>
              <div className="viewer-md">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{local}</ReactMarkdown>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
