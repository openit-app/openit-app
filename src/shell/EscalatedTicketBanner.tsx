// Floating top-right notification card for escalated tickets.
// Auto-dismisses after 5 s. Clicking opens the first ticket and
// sends `/answer-ticket` to the active Claude session.
//
// Driven by fs-tick: the parent Shell's fs watcher bumps `fsTick`
// on every change under the project root, which re-scans
// `databases/tickets/` for `status: "escalated"`.

import { useEffect, useState } from "react";
import { scanEscalatedTickets, type TicketSummary } from "../lib/escalatedTickets";
import { writeToActiveSession } from "./activeSession";
import styles from "./EscalatedTicketBanner.module.css";

export function EscalatedTicketBanner({
  repo,
  fsTick,
  onOpenPath,
}: {
  repo: string | null;
  fsTick: number;
  onOpenPath?: (path: string) => void;
}) {
  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!repo) {
      setTickets([]);
      return;
    }
    let cancelled = false;
    scanEscalatedTickets(repo)
      .then((rows) => {
        if (!cancelled) setTickets(rows);
      })
      .catch((e) => {
        if (!cancelled) {
          console.warn("[escalated-banner] scan failed:", e);
          setTickets([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [repo, fsTick]);

  // Stable key from the ticket set so a new ticket re-shows the
  // toast after a prior batch was dismissed or actioned.
  const ticketKey = tickets.map((t) => t.relPath).sort().join("|");

  // Auto-dismiss after 5 seconds. Resets if ticketKey changes
  // (new ticket comes in). The admin can still click before timeout.
  useEffect(() => {
    if (!ticketKey || dismissedKey === ticketKey) return;
    const timer = setTimeout(() => setDismissedKey(ticketKey), 5000);
    return () => clearTimeout(timer);
  }, [ticketKey, dismissedKey]);

  if (tickets.length === 0) return null;
  if (dismissedKey === ticketKey) return null;

  const first = tickets[0];
  const others = tickets.length - 1;
  const subjectLabel = first.subject || first.relPath.split("/").pop() || first.relPath;

  const onAnswer = async () => {
    if (sending) return;
    setSending(true);
    try {
      const wrapped = `\x1b[200~/answer-ticket ${first.relPath}\x1b[201~`;
      await writeToActiveSession(wrapped);

      if (onOpenPath && repo) {
        const ticketFile = first.relPath.split("/").pop() || "";
        const ticketId = ticketFile.replace(/\.json$/, "");
        if (ticketId) {
          onOpenPath(`${repo}/databases/conversations/${ticketId}`);
        }
      }
      setDismissedKey(ticketKey);
    } catch (e) {
      console.error("[escalated-banner] paste-to-Claude failed:", e);
    } finally {
      setTimeout(() => setSending(false), 500);
    }
  };

  return (
    <div className="escalated-toast-anchor">
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: notification card */}
      <div
        className={styles.notification}
        role="status"
        onClick={onAnswer}
      >
        <span className={styles.dot} aria-hidden />
        <div className={styles.content}>
          <div className={styles.eyebrow}>Needs your reply</div>
          <div className={styles.subject}>
            {subjectLabel}
            {others > 0 && (
              <span className={styles.badge}>+{others} more</span>
            )}
          </div>
        </div>
        <button
          type="button"
          className={styles.close}
          aria-label="Dismiss"
          onClick={(e) => {
            e.stopPropagation();
            setDismissedKey(ticketKey);
          }}
        >
          {"\u00d7"}
        </button>
      </div>
    </div>
  );
}
