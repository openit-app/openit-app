import { useCallback, useEffect, useRef, useState } from "react";
import { readProfileName, suggestedName, writeProfileName } from "../lib/profile";
import { Button } from "../ui";

// First-run identity capture. Shows a one-time "What should we call you?"
// prompt whenever a vault is open but `profile.md` has no name yet. This
// triggers on the *condition* (vault loaded + no profile name), not on the
// onboarding screen — so it covers both new installs AND existing users
// who upgrade into a vault that predates the profile feature. Once a name
// is saved (or the user skips), it never shows again for that vault.

function skipKey(repo: string): string {
  return `openit:profile-prompt-skipped:${repo}`;
}

export function ProfilePrompt({
  repo,
  onSaved,
}: {
  repo: string;
  /** Nudge the file tick so the Tasks composer picks up the new name. */
  onSaved?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setOpen(false);
    (async () => {
      if (!repo) return;
      // Already dismissed for this vault — don't nag.
      try {
        if (localStorage.getItem(skipKey(repo))) return;
      } catch {
        /* localStorage unavailable — fall through and ask */
      }
      // Only ask when there's no name recorded yet.
      const existing = await readProfileName(repo);
      if (cancelled || existing) return;
      const suggestion = await suggestedName();
      if (cancelled) return;
      setName(suggestion);
      setOpen(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [repo]);

  // Focus + select the suggested name when the prompt opens, so a user
  // who agrees just hits Enter and one who doesn't can overtype immediately.
  useEffect(() => {
    if (open) {
      const id = window.setTimeout(() => inputRef.current?.select(), 0);
      return () => window.clearTimeout(id);
    }
  }, [open]);

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(skipKey(repo), "1");
    } catch {
      /* non-fatal */
    }
    setOpen(false);
  }, [repo]);

  const save = useCallback(async () => {
    const clean = name.trim();
    if (!clean || saving) return;
    setSaving(true);
    try {
      await writeProfileName(repo, clean);
      try {
        localStorage.setItem(skipKey(repo), "1");
      } catch {
        /* non-fatal */
      }
      onSaved?.();
      setOpen(false);
    } catch (err) {
      console.error("[profile] failed to write profile.md:", err);
      // Leave the prompt open so the user can retry; surfacing a toast
      // would need the provider in scope — a retry on the same dialog
      // is enough for this one-time capture.
    } finally {
      setSaving(false);
    }
  }, [name, repo, saving, onSaved]);

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(40, 28, 14, 0.32)",
      }}
      role="dialog"
      aria-modal="true"
      aria-label="What should we call you?"
    >
      <div
        style={{
          width: 420,
          maxWidth: "calc(100vw - 32px)",
          background: "var(--surface)",
          color: "var(--text)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          boxShadow: "var(--shadow-pop)",
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 600 }}>What should we call you?</div>
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>
          Claude uses this to assign tasks to you and to greet you by name. It's
          saved to <code>profile.md</code> in your vault — edit it anytime.
        </p>
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void save();
            } else if (e.key === "Escape") {
              e.preventDefault();
              dismiss();
            }
          }}
          placeholder="Your name"
          aria-label="Your name"
          spellCheck={false}
          autoCapitalize="words"
          style={{
            appearance: "none",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "10px 12px",
            fontSize: 14,
            color: "var(--text)",
            background: "var(--surface)",
            outline: "none",
          }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
          <Button variant="ghost" size="sm" onClick={dismiss} disabled={saving}>
            Skip for now
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void save()}
            loading={saving}
            disabled={!name.trim()}
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
