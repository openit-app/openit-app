// CredentialsManager — compact UI for the secure local credential store
// (PIN-7009). Lets admins save named secrets (env-var style) that scripts
// and Claude commands can read as `process.env.MY_SECRET`, without ever
// writing the value into a vault file that syncs to Dropbox / Drive.
//
// The panel only ever shows credential *names* and a saved/not-saved
// state — never values. Values live in the OS secure store (Keychain /
// Credential Manager) and are injected into child processes by the Rust
// backend at run time.

import { useEffect, useState } from "react";
import {
  credentialsDelete,
  credentialsList,
  credentialsSet,
  isValidCredentialName,
} from "../lib/api";
import { Button } from "../ui";
import styles from "./ToolsPanel.module.css";

export function CredentialsManager() {
  const [names, setNames] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      setNames(await credentialsList());
    } catch {
      /* index unreadable — show empty rather than crash the panel */
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const trimmedName = name.trim();
  const canSave =
    !busy && trimmedName.length > 0 && value.length > 0 && isValidCredentialName(trimmedName);

  const onSave = async () => {
    setError(null);
    if (!isValidCredentialName(trimmedName)) {
      setError("Name must be UPPER_SNAKE_CASE (letters, digits, underscore; no leading digit).");
      return;
    }
    if (value.length === 0) {
      setError("Enter a value to save.");
      return;
    }
    setBusy(true);
    try {
      await credentialsSet(trimmedName, value);
      setName("");
      setValue("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (target: string) => {
    setError(null);
    setBusy(true);
    try {
      await credentialsDelete(target);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.credentialsSection}>
      <h3 className={styles.sectionHeading}>Local credentials</h3>
      <p className={styles.credentialsHint}>
        Saved secrets stay in your OS keychain (never in the vault) and are exposed to scripts and
        Claude commands as environment variables. Reference one with{" "}
        <code className={styles.credentialsCode}>process.env.NAME</code>.
      </p>

      <div className={styles.credentialsForm}>
        <input
          type="text"
          className={styles.credentialNameInput}
          placeholder="SALESFORCE_TOKEN"
          value={name}
          spellCheck={false}
          autoCapitalize="characters"
          onChange={(e) => setName(e.target.value)}
        />
        <input
          type="password"
          className={styles.credentialValueInput}
          placeholder="value (hidden)"
          value={value}
          autoComplete="off"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canSave) void onSave();
          }}
        />
        <Button variant="primary" size="sm" onClick={() => void onSave()} disabled={!canSave}>
          Save
        </Button>
      </div>

      {error && <p className={styles.credentialsError}>{error}</p>}

      {names.length > 0 ? (
        <ul className={styles.credentialsList}>
          {names.map((n) => (
            <li key={n} className={styles.credentialRow}>
              <span className={styles.credentialName}>
                <span className={styles.installedDot} aria-hidden />
                {n}
              </span>
              <Button variant="ghost" size="sm" onClick={() => void onDelete(n)} disabled={busy}>
                Delete
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.credentialsEmpty}>No credentials saved yet.</p>
      )}
    </section>
  );
}
