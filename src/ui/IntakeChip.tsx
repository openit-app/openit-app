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
            ? `Shared at ${tunnelBare}. Click to copy.`
            : "Share this form with your team via a public link"
        }
        onClick={() => {
          if (tunnelUrl) {
            navigator.clipboard.writeText(tunnelUrl).catch(() => {});
          } else {
            onShare();
          }
        }}
      >
        {tunnelBare ?? "share"}
      </button>
    </span>
  );
}
