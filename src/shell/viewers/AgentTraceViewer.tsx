/// Agent-trace sub-viewers extracted from Viewer.tsx.
/// Handles `agent-trace` (single turn timeline) and `agent-trace-list`
/// (all turns for one ticket) rendering.
/// No behavior changes — purely structural extraction.

import type { TraceDoc } from "../viewerTypes";

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

function formatTs(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// AgentTraceBody
// ---------------------------------------------------------------------------

export function AgentTraceBody({
  doc,
  subject,
}: {
  doc: TraceDoc | null;
  subject: string;
}) {
  if (!doc) {
    return (
      <div className="agent-trace-view">
        <div className="agent-trace-header">
          <div className="agent-trace-subject">{subject}</div>
          <div className="agent-trace-meta">
            <span className="agent-trace-time">composing reply…</span>
          </div>
        </div>
        <div className="viewer-summary">
          <p className="summary-desc">
            The agent hasn't finished its first reply on this
            ticket yet. The timeline will appear here as soon as
            the turn completes.
          </p>
        </div>
      </div>
    );
  }
  const items = doc.events.filter(
    (e) => e.kind === "tool_use" || e.kind === "text" || e.kind === "result",
  );
  return (
    <div className="agent-trace-view">
      <div className="agent-trace-header">
        <div className="agent-trace-subject">{subject}</div>
        <div className="agent-trace-meta">
          <span className={`agent-trace-outcome agent-trace-outcome-${doc.outcome}`}>
            {doc.outcome}
          </span>
          <span className="agent-trace-model">{doc.model}</span>
          <span className="agent-trace-time">
            {formatTs(doc.started_at)} → {formatTs(doc.completed_at)}
          </span>
        </div>
      </div>
      {items.length === 0 ? (
        <div className="viewer-summary">
          <p className="summary-desc">
            No actions recorded for this turn yet.
          </p>
        </div>
      ) : (
        <ol className="agent-trace-timeline">
          {items.map((e, idx) => {
            const verb =
              e.verb ?? (e.tool ? `Running ${e.tool}` : null);
            const isFinalResult = e.kind === "result";
            const isText = e.kind === "text";
            const label = isFinalResult
              ? "Replied"
              : isText
                ? "Thinking"
                : verb || e.kind;
            const snippet = e.text ? e.text.trim() : null;
            return (
              <li
                key={`${e.ts}-${idx}`}
                className={`agent-trace-step agent-trace-step-${e.kind}`}
              >
                <span className="agent-trace-step-time">{formatTs(e.ts)}</span>
                <span className="agent-trace-step-label">{label}</span>
                {snippet && (
                  <span className="agent-trace-step-snippet">{snippet}</span>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AgentTraceListBody
// ---------------------------------------------------------------------------

export function AgentTraceListBody({
  subject,
  docs,
}: {
  subject: string;
  docs: { name: string; doc: TraceDoc | null }[];
}) {
  return (
    <div className="agent-trace-view">
      <div className="agent-trace-header">
        <div className="agent-trace-subject">{subject}</div>
        <div className="agent-trace-meta">
          <span className="agent-trace-time">
            {docs.length} turn{docs.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>
      {docs.length === 0 ? (
        <div className="viewer-summary">
          <p className="summary-desc">No traces recorded for this ticket yet.</p>
        </div>
      ) : (
        docs.map((entry, idx) => {
          const { doc, name } = entry;
          if (!doc) {
            return (
              <section key={name} className="agent-trace-list-turn">
                <header className="agent-trace-list-divider">
                  Turn {idx + 1} · {name} · (unparseable)
                </header>
              </section>
            );
          }
          const items = doc.events.filter(
            (e) => e.kind === "tool_use" || e.kind === "text" || e.kind === "result",
          );
          return (
            <section key={name} className="agent-trace-list-turn">
              <header className="agent-trace-list-divider">
                <span className="agent-trace-list-turn-num">Turn {idx + 1}</span>
                <span className={`agent-trace-outcome agent-trace-outcome-${doc.outcome}`}>
                  {doc.outcome}
                </span>
                <span className="agent-trace-model">{doc.model}</span>
                <span className="agent-trace-time">
                  {formatTs(doc.started_at)} → {formatTs(doc.completed_at)}
                </span>
              </header>
              {items.length === 0 ? (
                <p className="summary-desc">No actions recorded for this turn.</p>
              ) : (
                <ol className="agent-trace-timeline">
                  {items.map((e, i) => {
                    const verb = e.verb ?? (e.tool ? `Running ${e.tool}` : null);
                    const isFinal = e.kind === "result";
                    const isText = e.kind === "text";
                    const label = isFinal ? "Replied" : isText ? "Thinking" : verb || e.kind;
                    const snippet = (() => {
                      if (!e.text) return null;
                      const first = e.text.split("\n")[0]?.trim() ?? "";
                      return first.length > 140 ? `${first.slice(0, 137)}…` : first;
                    })();
                    return (
                      <li
                        key={`${e.ts}-${i}`}
                        className={`agent-trace-step agent-trace-step-${e.kind}`}
                      >
                        <span className="agent-trace-step-time">{formatTs(e.ts)}</span>
                        <span className="agent-trace-step-label">{label}</span>
                        {snippet && (
                          <span className="agent-trace-step-snippet">{snippet}</span>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}
