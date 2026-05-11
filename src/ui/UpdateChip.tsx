import type { UpdateState } from "../lib/updater";
import styles from "./Chip.module.css";

export function UpdateChip({ update }: { update: UpdateState }) {
  if (!update.available) return null;

  const label = update.installing ? "Installing…" : `Update v${update.version}`;

  return (
    <button
      type="button"
      className={`${styles.chip} ${styles.accent}`}
      onClick={update.install}
      disabled={update.installing}
      title={`OpenIT v${update.version} is available. Click to install and relaunch.`}
    >
      {update.installing && (
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden>
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="8">
            <animateTransform attributeName="transform" type="rotate" from="0 8 8" to="360 8 8" dur="0.8s" repeatCount="indefinite" />
          </circle>
        </svg>
      )}
      {label}
    </button>
  );
}
