//! Read access to persisted per-turn agent traces. (Legacy: the
//! original producer was the now-removed chat-intake server, which
//! wrote these docs to `traces/<ticketId>/<turnIso>.json`. The
//! `ticketId`/`ticket_id` folder key is an internal trace id, not a
//! helpdesk ticket — do not rename it. The writer was removed in the
//! 2026-06 pivot; this module now only *reads* traces that already
//! exist on disk for the desktop viewer.)
//!
//! `TraceEvent` / `TraceDoc` are the on-disk shapes — kind, verb, raw
//! input — rendered in the center-panel trace viewer without
//! re-parsing claude's wire format on the frontend. `agent_trace_latest`
//! returns the most recent trace doc for a given trace id.

use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::fs;

/// Normalized record of one step the agent took during a turn. Mostly
/// derived from claude's `stream-json` events; fields are
/// intentionally string-typed so the frontend doesn't need a
/// schema-aware parser. Unknown / unparseable claude events are still
/// captured (kind="raw") so the audit log is lossless.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TraceEvent {
    /// ISO-8601 UTC second-precision timestamp.
    pub ts: String,
    /// Event family. Common values: "tool_use", "tool_result",
    /// "text", "result", "raw".
    pub kind: String,
    /// Tool name when `kind == "tool_use"`. None otherwise.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool: Option<String>,
    /// Friendly verb for UI rendering — e.g. "Searching the
    /// knowledge base for \"login reset\"". Falls back to the raw
    /// tool name for unrecognized tools.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verb: Option<String>,
    /// Raw event payload from claude (assistant message, tool_use
    /// block, tool_result, etc.). Kept verbatim so future UI surfaces
    /// can render details on demand without us having to re-stream.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw: Option<Value>,
    /// Plain text content from `text_delta` / final `result.result`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}

/// Top-level trace document persisted to disk.
#[derive(Debug, Serialize, Deserialize)]
pub struct TraceDoc {
    pub ticket_id: String,
    pub turn_id: String,
    pub started_at: String,
    pub completed_at: String,
    pub model: String,
    /// Final outcome the dispatcher applied (`answered` / `escalated`
    /// / `resolved`). Filled in by `chat_turn` after parsing the
    /// marker.
    pub outcome: String,
    pub events: Vec<TraceEvent>,
}

/// Tauri command: return the latest persisted trace document for a
/// given ticket, or `None` if no trace has been written yet (no
/// turns have been processed by the agent for this
/// ticket).
///
/// Used by the desktop UI to render the agent-activity banner's
/// click-through into the center-panel timeline. Filenames are
/// ISO-8601 timestamps with `:` replaced by `-`, so a lex-max sort
/// over directory entries is equivalent to "most recent turn".
#[tauri::command]
pub async fn agent_trace_latest(
    repo: String,
    ticket_id: String,
) -> Result<Option<TraceDoc>, String> {
    let dir = Path::new(&repo).join("traces").join(&ticket_id);
    let mut read_dir = match fs::read_dir(&dir).await {
        Ok(rd) => rd,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("read traces dir: {}", e)),
    };
    let mut latest: Option<(String, std::path::PathBuf)> = None;
    while let Some(entry) = read_dir
        .next_entry()
        .await
        .map_err(|e| format!("walk traces dir: {}", e))?
    {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.ends_with(".json") {
            continue;
        }
        let take = match &latest {
            None => true,
            Some((cur, _)) => name.as_str() > cur.as_str(),
        };
        if take {
            latest = Some((name, entry.path()));
        }
    }
    let Some((_, path)) = latest else {
        return Ok(None);
    };
    let bytes = fs::read(&path)
        .await
        .map_err(|e| format!("read trace file: {}", e))?;
    let doc: TraceDoc =
        serde_json::from_slice(&bytes).map_err(|e| format!("parse trace file: {}", e))?;
    Ok(Some(doc))
}
