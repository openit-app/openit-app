/// Conversation-related sub-viewers extracted from Viewer.tsx.
/// Handles `conversations-list` (clickable cards) and
/// `conversation-thread` (chat bubbles + admin reply composer).
/// No behavior changes — purely structural extraction.

import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { loadOpenitConfig } from "../../lib/openitConfig";
import type { ConversationTurn, ConversationThreadSummary } from "../viewerTypes";
import { AttachmentList } from "../AttachmentList";
import { Button } from "../../ui";
import { writeToActiveSession } from "../activeSession";
import { BRACKETED_PASTE_OPEN, BRACKETED_PASTE_CLOSE } from "./viewerHelpers";

// ---------------------------------------------------------------------------
// ConversationsListBody
// ---------------------------------------------------------------------------

export function ConversationsListBody({
  threads,
  intakeUrl,
  conversationsFilter,
  repo,
  onOpenPath,
}: {
  threads: ConversationThreadSummary[];
  intakeUrl?: string | null;
  conversationsFilter: "all" | "open" | "resolved" | "escalated";
  repo: string;
  onOpenPath?: (path: string) => void | Promise<void>;
}) {
  if (threads.length === 0) {
    const sampleUrl = intakeUrl || null;
    return (
      <div className="viewer-summary">
        <p className="summary-desc">
          No conversation threads yet. They appear here once a ticket gets
          its first message — file a ticket via the Intake form to start one.
        </p>
        {sampleUrl && (
          <Button
            variant="primary"
            onClick={() => {
              openUrl(sampleUrl).catch((err) =>
                console.warn("[viewer] openUrl failed:", err),
              );
            }}
          >
            Submit sample ticket
          </Button>
        )}
      </div>
    );
  }

  const matchesFilter = (status: string) => {
    if (conversationsFilter === "all") return true;
    if (conversationsFilter === "open") {
      return status === "open" || status === "agent-responding";
    }
    if (conversationsFilter === "resolved") {
      return status === "resolved" || status === "closed";
    }
    if (conversationsFilter === "escalated") {
      return status === "escalated";
    }
    return true;
  };
  const visibleThreads = threads.filter((t) => matchesFilter(t.status || ""));
  const filterCaption: Record<typeof conversationsFilter, string> = {
    all: "All tickets across every status.",
    open: "Agent is working with the person, awaiting their reply.",
    resolved: "Tickets marked as resolved.",
    escalated: "Agent needs help solving.",
  };
  return (
    <div className="viewer-summary viewer-conversations">
      <p className="viewer-list-caption">{filterCaption[conversationsFilter]}</p>
      {visibleThreads.length === 0 ? (
        <p className="summary-desc">No threads match this filter.</p>
      ) : (
        <div className="viewer-thread-list">
          {visibleThreads.map((t) => (
            <button
              key={t.ticketId}
              type="button"
              className={`thread-card thread-card-status-${t.status || "unknown"}`}
              onClick={() => {
                if (onOpenPath) {
                  void onOpenPath(`${repo}/databases/conversations/${t.ticketId}`);
                }
              }}
              title={`Open conversation for ${t.ticketId}`}
            >
              <div className="thread-card-row">
                <span className="thread-card-subject">{t.subject || "(no subject)"}</span>
                {t.status && <span className="thread-card-status">{t.status}</span>}
              </div>
              <div className="thread-card-meta">
                {t.asker && <span className="thread-card-asker">{t.asker}</span>}
                <span className="thread-card-count">
                  {t.turnCount} message{t.turnCount === 1 ? "" : "s"}
                </span>
                {t.lastTurnAt && (
                  <span className="thread-card-time">{t.lastTurnAt}</span>
                )}
              </div>
              {t.tags.length > 0 && (
                <div className="thread-card-tags">
                  {t.tags.map((tag) => (
                    <span key={tag} className="thread-card-tag">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ConversationThreadBody
// ---------------------------------------------------------------------------

export function ConversationThreadBody({
  turns,
  ticketId,
  repo,
  adminEmail,
  onOpenPath,
}: {
  turns: ConversationTurn[];
  ticketId: string;
  repo: string;
  adminEmail: string | null;
  onOpenPath?: (path: string) => void | Promise<void>;
}) {
  const [replyText, setReplyText] = useState("");
  const [replySending, setReplySending] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [replyAttachments, setReplyAttachments] = useState<
    { path: string; filename: string }[]
  >([]);
  const [replyDragOver, setReplyDragOver] = useState(false);

  /// Write a single admin turn to disk + bump the ticket back to
  /// `open`. Shared between the textarea Send path and the
  /// drag-drop path so a dropped file always shows up as a real
  /// thread message (not just a chip on the composer that the
  /// admin still has to click Send on). Caller has already
  /// validated body / attachments are non-empty.
  const writeAdminTurn = async (
    body: string,
    attachments: string[],
  ): Promise<void> => {
    if (!repo) return;
    const { entityWriteFile, fsRead } = await import("../../lib/api");
    const nowMs = Date.now();
    const rand = Math.random().toString(36).slice(2, 6);
    const msgId = `msg-${nowMs}-${rand}`;
    const isoNow = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    const sender = adminEmail ?? "admin";
    const payload: Record<string, unknown> = {
      id: msgId,
      ticketId,
      role: "admin",
      sender,
      timestamp: isoNow,
      body,
    };
    if (attachments.length > 0) payload.attachments = attachments;
    await entityWriteFile(
      repo,
      `databases/conversations/${ticketId}`,
      `${msgId}.json`,
      JSON.stringify(payload, null, 2),
    );
    try {
      const cfg = await loadOpenitConfig(repo);
      const ticketPath = `${repo}/databases/tickets/${ticketId}.json`;
      const raw = await fsRead(ticketPath);
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      parsed.updatedAt = isoNow;
      if (cfg.ticketLifecycle.escalateOnAdminReply) {
        parsed.status = "escalated";
      }
      if (typeof parsed.assignee !== "string" || !parsed.assignee) {
        parsed.assignee = sender;
      }
      await entityWriteFile(
        repo,
        "databases/tickets",
        `${ticketId}.json`,
        JSON.stringify(parsed, null, 2),
      );
    } catch (e) {
      console.warn("[viewer] reply: ticket update skipped:", e);
    }
  };

  const sendReply = async () => {
    const trimmed = replyText.trim();
    if (!repo) return;
    if (!trimmed && replyAttachments.length === 0) return;
    setReplySending(true);
    setReplyError(null);
    try {
      await writeAdminTurn(
        trimmed || "(attachment)",
        replyAttachments.map((a) => a.path),
      );
      setReplyText("");
      setReplyAttachments([]);
    } catch (err) {
      setReplyError(`Send failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setReplySending(false);
    }
  };

  const markResolved = async () => {
    if (!repo) return;
    if (replySending) return;
    setReplySending(true);
    setReplyError(null);
    try {
      const { entityWriteFile, fsRead } = await import("../../lib/api");
      const ticketPath = `${repo}/databases/tickets/${ticketId}.json`;
      const raw = await fsRead(ticketPath);
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      parsed.status = "resolved";
      parsed.updatedAt = new Date().toISOString().replace(/\.\d+Z$/, "Z");
      await entityWriteFile(
        repo,
        "databases/tickets",
        `${ticketId}.json`,
        JSON.stringify(parsed, null, 2),
      );
      const cmd = `/conversation-to-automation ${ticketId}`;
      const wrapped = `${BRACKETED_PASTE_OPEN}${cmd}${BRACKETED_PASTE_CLOSE}\r`;
      try {
        const pasted = await writeToActiveSession(wrapped);
        if (!pasted) {
          alert(
            "Ticket marked resolved, but couldn't reach Claude to capture the resolution. " +
              `Open Claude in the right pane and run \`${cmd}\` to capture as a KB article, skill, or script.`,
          );
        }
      } catch (e) {
        console.warn(`[viewer] /conversation-to-automation paste failed:`, e);
      }
      if (onOpenPath) {
        void onOpenPath(`${repo}/databases/conversations`);
      }
    } catch (err) {
      setReplyError(`Resolve failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setReplySending(false);
    }
  };

  return (
    <div className="viewer-thread-wrapper">
      {turns.length === 0 ? (
        <div className="viewer-summary">
          <p className="summary-desc">No turns logged yet for this thread.</p>
        </div>
      ) : (
        <div className="viewer-thread">
          {turns.map((t) => {
            const isAsker = t.role === "asker";
            return (
              <div
                key={t.id}
                className={`thread-turn ${isAsker ? "thread-turn-asker" : "thread-turn-agent"}`}
              >
                <div className="thread-turn-meta">
                  <span className="thread-turn-sender">{t.sender || t.role}</span>
                  <span className="thread-turn-role">{t.role}</span>
                  {t.timestamp && (
                    <span className="thread-turn-time">{t.timestamp}</span>
                  )}
                </div>
                <div className="thread-turn-body">{t.body}</div>
                {t.attachments && t.attachments.length > 0 && (
                  <AttachmentList attachments={t.attachments} repo={repo} />
                )}
              </div>
            );
          })}
        </div>
      )}
      <div
        className={`thread-reply-composer${replyDragOver ? " thread-reply-composer-drag" : ""}`}
        onDragOver={(e) => {
          if (Array.from(e.dataTransfer.types).includes("Files")) {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = "copy";
            setReplyDragOver(true);
          }
        }}
        onDragLeave={() => setReplyDragOver(false)}
        onDrop={async (e) => {
          setReplyDragOver(false);
          const files = Array.from(e.dataTransfer.files ?? []);
          if (files.length === 0 || !repo) return;
          e.preventDefault();
          e.stopPropagation();
          const { entityWriteFileBytes } = await import("../../lib/api");
          const subdir = `filestores/attachments/${ticketId}`;
          const newAttachments: { path: string; filename: string }[] = [];
          for (const f of files) {
            const filename = f.name || "upload";
            try {
              const buf = await f.arrayBuffer();
              await entityWriteFileBytes(repo, subdir, filename, buf);
              newAttachments.push({
                path: `${subdir}/${filename}`,
                filename,
              });
            } catch (err) {
              console.error(`[admin-reply] failed to attach ${filename}:`, err);
            }
          }
          if (newAttachments.length === 0) return;
          const trimmed = replyText.trim();
          const filenames = newAttachments.map((a) => a.filename);
          const fallbackBody =
            filenames.length === 1
              ? `attached file: ${filenames[0]}`
              : `attached files: ${filenames.join(", ")}`;
          setReplySending(true);
          setReplyError(null);
          try {
            await writeAdminTurn(
              trimmed || fallbackBody,
              newAttachments.map((a) => a.path),
            );
            setReplyText("");
          } catch (err) {
            setReplyError(
              `Drop failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          } finally {
            setReplySending(false);
          }
        }}
      >
        {replyAttachments.length > 0 && (
          <div className="thread-reply-chips">
            {replyAttachments.map((att) => (
              <span key={att.path} className="thread-reply-chip">
                <span className="thread-reply-chip-name">{att.filename}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  className="thread-reply-chip-remove"
                  onClick={() =>
                    setReplyAttachments((prev) =>
                      prev.filter((a) => a.path !== att.path),
                    )
                  }
                  title="Remove"
                >
                  ×
                </Button>
              </span>
            ))}
          </div>
        )}
        <textarea
          className="thread-reply-input"
          placeholder={`Reply as ${adminEmail ?? "admin"} (drop files to attach)…`}
          value={replyText}
          onChange={(e) => setReplyText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void sendReply();
            }
          }}
          rows={2}
          disabled={replySending}
        />
        <div className="thread-reply-footer">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void markResolved()}
            disabled={replySending}
            title="Mark this ticket as resolved and capture the resolution as a KB article, skill, or script"
          >
            Mark as resolved
          </Button>
          {replyError && (
            <span className="thread-reply-error">{replyError}</span>
          )}
          <span className="thread-reply-hint">⌘↩ to send · drop files to attach</span>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void sendReply()}
            disabled={
              replySending ||
              (!replyText.trim() && replyAttachments.length === 0)
            }
            loading={replySending}
          >
            {replySending ? "Sending…" : "Send"}
          </Button>
        </div>
      </div>
    </div>
  );
}
