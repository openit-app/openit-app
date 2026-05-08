import { openUrl } from "@tauri-apps/plugin-opener";
import styles from "./Chip.module.css";

export interface IntakeChipProps {
  /** Local intake server URL. Present once the server is up. */
  sharedUrl: string | null;
  /** Public tunnel URL (from .openit/tunnel.json). Null when not sharing. */
  tunnelUrl: string | null;
  /** Click handler for the share segment — kicks off /share-intake. */
  onShare: () => void;
  className?: string;
}

function strip(u: string | null): string | null {
  if (!u) return null;
  return u.replace(/^https?:\/\//, "");
}

/** Segmented chip — [intake form] [local-url] [share / tunnel-url]. */
export function IntakeChip({
  sharedUrl,
  tunnelUrl,
  onShare,
  className,
}: IntakeChipProps) {
  if (!sharedUrl) return null;

  const localBare = strip(sharedUrl);
  if (!localBare) return null;

  const tunnelBare = strip(tunnelUrl);

  const cls = [styles.segment, className].filter(Boolean).join(" ");
  return (
    <span className={cls} role="group" aria-label="Intake form">
      <span className={styles.label}>intake form</span>
      <button
        type="button"
        title={`Open intake form preview at ${localBare}`}
        onClick={() =>
          openUrl(sharedUrl).catch((e) =>
            console.warn("[intake-chip] openUrl failed:", e),
          )
        }
      >
        {localBare}
      </button>
      <button
        type="button"
        title={
          tunnelBare
            ? `Open shared intake form at ${tunnelBare}`
            : "Share this form with your team via a public link"
        }
        onClick={() => {
          if (tunnelUrl) {
            openUrl(tunnelUrl).catch((e) =>
              console.warn("[intake-chip] openUrl failed:", e),
            );
          } else {
            onShare();
          }
        }}
      >
        {tunnelBare ?? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
            <polyline points="16 6 12 2 8 6" />
            <line x1="12" y1="2" x2="12" y2="15" />
          </svg>
        )}
      </button>
    </span>
  );
}
