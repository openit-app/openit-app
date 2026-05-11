import { useCallback, useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { claudeDetect, claudeInstall } from "./lib/api";
import { Button } from "./ui";

const CLAUDE_INSTALL_DOCS =
  "https://docs.anthropic.com/claude/docs/claude-code";
const DEFAULT_VAULT_DISPLAY = "~/OpenIT/Personal";

// Claude Code detection states
type ClaudeState =
  | { kind: "checking" }
  | { kind: "installing" }
  | { kind: "ready"; path: string }
  | { kind: "failed"; error: string | null };

export function Onboarding({
  onOpenVault,
}: {
  onOpenVault: (path: string) => Promise<void>;
}) {
  const [claude, setClaude] = useState<ClaudeState>({ kind: "checking" });
  const [vaultPath, setVaultPath] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const isWindows = navigator.userAgent.toLowerCase().includes("win");

  // Detect → auto-install flow
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const detected = await claudeDetect();
        if (cancelled) return;
        if (detected) {
          setClaude({ kind: "ready", path: detected });
          return;
        }
        // Not found — try auto-install
        setClaude({ kind: "installing" });
        try {
          const installed = await claudeInstall();
          if (cancelled) return;
          setClaude({ kind: "ready", path: installed });
        } catch (err) {
          if (cancelled) return;
          console.error("claude install failed:", err);
          setClaude({
            kind: "failed",
            error: err instanceof Error ? err.message : String(err),
          });
        }
      } catch {
        if (!cancelled) setClaude({ kind: "failed", error: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const retryDetect = useCallback(async () => {
    setClaude({ kind: "checking" });
    try {
      const detected = await claudeDetect();
      if (detected) {
        setClaude({ kind: "ready", path: detected });
        return;
      }
      setClaude({ kind: "installing" });
      const installed = await claudeInstall();
      setClaude({ kind: "ready", path: installed });
    } catch (err) {
      console.error("claude retry failed:", err);
      setClaude({
        kind: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  const pickFolder = useCallback(async () => {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: "Choose a folder for your vault",
    });
    if (typeof selected === "string") {
      setVaultPath(selected);
    }
  }, []);

  const handleOpen = useCallback(async () => {
    setOpening(true);
    try {
      // Pass empty string for default — Rust resolves to ~/OpenIT/Personal
      await onOpenVault(vaultPath ?? "");
    } catch (e) {
      console.error("[onboarding] open vault failed:", e);
      setOpening(false);
    }
  }, [vaultPath, onOpenVault]);

  const claudeReady = claude.kind === "ready";
  const claudeBusy = claude.kind === "checking" || claude.kind === "installing";
  const canGo = claudeReady && !opening;

  return (
    <div className="onboard">
      <div className="onboard-card">
        {/* Header */}
        <div className="onboard-wordmark">
          <span className="onboard-title">
            Open<em>IT</em>
          </span>
          <span className="onboard-tagline">get IT done</span>
        </div>

        {/* ── Vault section ── */}
        <div className="onboard-section">
          <p className="onboard-question">Where should we keep your stuff?</p>
          <button
            type="button"
            className="onboard-vault-row"
            onClick={pickFolder}
            title="Browse for a folder"
          >
            <code className="onboard-vault-path">
              {vaultPath ?? DEFAULT_VAULT_DISPLAY}
            </code>
            <span className="onboard-browse-label">Browse</span>
          </button>
          <p className="onboard-hint">
            Put it in Google Drive or Dropbox so your team works from the same vault.
          </p>
        </div>

        {/* ── CTA ── */}
        <div className="onboard-actions">
          <Button
            variant="primary"
            size="lg"
            onClick={handleOpen}
            loading={opening}
            disabled={!canGo}
          >
            {opening
              ? "Setting up..."
              : claudeBusy
                ? "Setting up Claude Code..."
                : "Let's go"}
          </Button>
        </div>

        {/* ── Claude Code status bar (adaptive) ── */}
        <div className="onboard-status-bar">
          {claude.kind === "checking" && (
            <div className="onboard-status onboard-status--busy">
              <span className="onboard-status-dot onboard-status-dot--busy" />
              <span>Checking for Claude Code...</span>
            </div>
          )}

          {claude.kind === "installing" && (
            <div className="onboard-status onboard-status--busy">
              <span className="onboard-status-dot onboard-status-dot--busy" />
              <span>
                Installing Claude Code — this takes a few seconds...
              </span>
            </div>
          )}

          {claude.kind === "ready" && (
            <div className="onboard-status onboard-status--ready">
              <span className="onboard-status-dot onboard-status-dot--ready" />
              <span>Claude Code</span>
              <code className="onboard-status-path">{claude.path}</code>
            </div>
          )}

          {claude.kind === "failed" && (
            <div className="onboard-status-failed">
              <div className="onboard-status onboard-status--error">
                <span className="onboard-status-dot onboard-status-dot--error" />
                <span>Claude Code not found</span>
              </div>

              <div className="onboard-install-help">
                <p className="onboard-install-lead">
                  OpenIT needs Claude Code to work. Install it, then click
                  "Check again".
                </p>
                <div className="onboard-install-options">
                  <div className="onboard-install-option" data-os="mac" style={isWindows ? { display: "none" } : undefined}>
                    <span className="onboard-install-label">macOS / Linux</span>
                    <div className="onboard-code-block">
                      <code>curl -fsSL https://claude.ai/install.sh | sh</code>
                      <button
                        className="onboard-copy-btn"
                        onClick={() =>
                          navigator.clipboard.writeText(
                            "curl -fsSL https://claude.ai/install.sh | sh",
                          )
                        }
                        title="Copy"
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                  <div className="onboard-install-option" data-os="win" style={!isWindows ? { display: "none" } : undefined}>
                    <span className="onboard-install-label">Windows (PowerShell)</span>
                    <div className="onboard-code-block">
                      <code>irm https://claude.ai/install.ps1 | iex</code>
                      <button
                        className="onboard-copy-btn"
                        onClick={() =>
                          navigator.clipboard.writeText(
                            "irm https://claude.ai/install.ps1 | iex",
                          )
                        }
                        title="Copy"
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                  <div className="onboard-install-option" data-os="win" style={!isWindows ? { display: "none" } : undefined}>
                    <span className="onboard-install-label">Windows (CMD)</span>
                    <div className="onboard-code-block">
                      <code>curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd</code>
                      <button
                        className="onboard-copy-btn"
                        onClick={() =>
                          navigator.clipboard.writeText(
                            "curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd",
                          )
                        }
                        title="Copy"
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                  <div className="onboard-install-option">
                    <span className="onboard-install-label">npm (all platforms)</span>
                    <div className="onboard-code-block">
                      <code>npm install -g @anthropic-ai/claude-code</code>
                      <button
                        className="onboard-copy-btn"
                        onClick={() =>
                          navigator.clipboard.writeText(
                            "npm install -g @anthropic-ai/claude-code",
                          )
                        }
                        title="Copy"
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                </div>
                {claude.error && (
                  <details className="onboard-error-details">
                    <summary>Error details</summary>
                    <pre className="onboard-error-pre">{claude.error}</pre>
                  </details>
                )}
                <div className="onboard-install-actions">
                  <Button variant="secondary" size="sm" onClick={retryDetect}>
                    Check again
                  </Button>
                  <a
                    href={CLAUDE_INSTALL_DOCS}
                    className="onboard-install-docs-link"
                    onClick={(e) => {
                      e.preventDefault();
                      window.open(CLAUDE_INSTALL_DOCS, "_blank");
                    }}
                  >
                    Installation docs
                  </a>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
