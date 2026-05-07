import { useCallback, useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  claudeDetect,
  claudeInstall,
} from "./lib/api";
import { Button } from "./ui";

const CLAUDE_INSTALL_DOCS = "https://docs.anthropic.com/claude/docs/claude-code";
const DEFAULT_VAULT_PATH = `${
  typeof window !== "undefined" ? "" : ""
}~/OpenIT/Personal`;

type StepProps = {
  n: number;
  title: string;
  state: "pending" | "active" | "done" | "skipped";
  detail?: React.ReactNode;
  action?: React.ReactNode;
};

function Step({ n, title, state, detail, action }: StepProps) {
  return (
    <div className={`onboard-step ${state}`}>
      <div className="onboard-step-num">{state === "done" ? "\u2713" : n}</div>
      <div className="onboard-step-body">
        <div className="onboard-step-title">{title}</div>
        {detail && <div className="onboard-step-detail">{detail}</div>}
      </div>
      {action && <div className="onboard-step-action">{action}</div>}
    </div>
  );
}

export function Onboarding({
  onOpenVault,
}: {
  onOpenVault: (path: string) => Promise<void>;
}) {
  const [claudePath, setClaudePath] = useState<string | null | "loading" | "installing">(
    "loading",
  );
  const [claudeInstallError, setClaudeInstallError] = useState<string | null>(null);
  const [vaultPath, setVaultPath] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  // Auto-install Claude Code on first run if it's missing.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const detected = await claudeDetect();
        if (cancelled) return;
        if (detected) {
          setClaudePath(detected);
          return;
        }
        setClaudePath("installing");
        setClaudeInstallError(null);
        try {
          const installed = await claudeInstall();
          if (cancelled) return;
          setClaudePath(installed);
        } catch (err) {
          if (cancelled) return;
          console.error("claude install failed:", err);
          setClaudeInstallError(
            err instanceof Error ? err.message : String(err),
          );
          setClaudePath(null);
        }
      } catch {
        if (!cancelled) setClaudePath(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const retryInstall = useCallback(async () => {
    setClaudePath("installing");
    setClaudeInstallError(null);
    try {
      const installed = await claudeInstall();
      setClaudePath(installed);
    } catch (err) {
      console.error("claude install retry failed:", err);
      setClaudeInstallError(err instanceof Error ? err.message : String(err));
      setClaudePath(null);
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
      await onOpenVault(vaultPath ?? "");
    } catch (e) {
      console.error("[onboarding] open vault failed:", e);
      setOpening(false);
    }
  }, [vaultPath, onOpenVault]);

  const claudeReady = typeof claudePath === "string" && claudePath !== null;

  return (
    <div className="onboard">
      <div className="onboard-card">
        <div className="onboard-wordmark">
          <span className="onboard-title">Open<em>IT</em></span>
          <span className="onboard-tagline">get IT done</span>
        </div>
        <p className="onboard-subtitle">
          A Claude-powered IT cockpit for small teams. Local-first.
        </p>

        <Step
          n={1}
          title={
            claudeReady
              ? "Claude Code installed"
              : claudePath === "installing"
                ? "Installing Claude Code..."
                : claudePath === "loading"
                  ? "Checking for Claude Code"
                  : "Install Claude Code"
          }
          state={
            claudePath === "loading" || claudePath === "installing"
              ? "active"
              : claudeReady
                ? "done"
                : "active"
          }
          detail={
            claudePath === "loading" ? (
              "Checking your PATH..."
            ) : claudePath === "installing" ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <span className="sc-spinner" aria-hidden="true" />
                <span>
                  Downloading from{" "}
                  <code>claude.ai/install.sh</code> -- this takes a few seconds.
                </span>
              </span>
            ) : claudeReady ? (
              <code className="onboard-path">{claudePath as string}</code>
            ) : (
              <>
                <div style={{ color: "#b91c1c", marginBottom: 4 }}>
                  Auto-install failed. Retry, or{" "}
                  <a
                    href={CLAUDE_INSTALL_DOCS}
                    onClick={(e) => {
                      e.preventDefault();
                      window.open(CLAUDE_INSTALL_DOCS, "_blank");
                    }}
                  >
                    install manually
                  </a>
                  .
                </div>
                {claudeInstallError ? (
                  <pre className="onboard-error-pre">{claudeInstallError}</pre>
                ) : null}
              </>
            )
          }
          action={
            !claudeReady &&
            claudePath !== "loading" &&
            claudePath !== "installing" ? (
              <Button variant="secondary" onClick={retryInstall}>
                Retry
              </Button>
            ) : null
          }
        />

        <Step
          n={2}
          title={vaultPath ? "Vault selected" : "Choose your vault folder"}
          state={vaultPath ? "done" : "active"}
          detail={
            vaultPath ? (
              <code className="onboard-path">{vaultPath}</code>
            ) : (
              <span>
                Pick any folder — your desktop, Dropbox, iCloud Drive, or
                the default <code>{DEFAULT_VAULT_PATH}</code>. Your data
                lives here as plain files.
              </span>
            )
          }
          action={
            <Button variant="secondary" onClick={pickFolder}>
              {vaultPath ? "Change" : "Browse..."}
            </Button>
          }
        />

        <div className="onboard-actions">
          <Button
            variant="primary"
            size="lg"
            onClick={handleOpen}
            loading={opening}
            disabled={opening}
          >
            {vaultPath ? "Open Vault" : "Use Default"}
          </Button>
        </div>
      </div>
    </div>
  );
}
