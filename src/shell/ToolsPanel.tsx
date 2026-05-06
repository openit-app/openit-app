import { useEffect, useMemo, useState } from "react";
import { listInstalledMcps, type InstalledMcp } from "../lib/api";
import { MCP_CATALOG, type McpEntry } from "../lib/mcpCatalog";
import { CATALOG, type CatalogEntry } from "../lib/toolsCatalog";
import { listInstalled } from "../lib/toolsInstall";
import { Button } from "../ui";
import { writeToActiveSession } from "./activeSession";
import styles from "./ToolsPanel.module.css";

/// Tools catalog rendered into the center pane via the `tools` entity
/// route.
///
/// All install/remove actions are delegated to Claude via
/// `writeToActiveSession`. This keeps the UI cross-platform and
/// transparent — the user sees exactly what Claude runs.

export function ToolsPanel({ projectRoot }: { projectRoot: string | null }) {
  const [activeTab, setActiveTab] = useState<"cli" | "mcp">("cli");
  const [installed, setInstalled] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  // MCP-specific state
  const [mcpSearch, setMcpSearch] = useState("");
  const [installedMcps, setInstalledMcps] = useState<InstalledMcp[]>([]);
  const [mcpEnvInputs, setMcpEnvInputs] = useState<Record<string, Record<string, string>>>({});

  const refreshInstalled = async () => {
    if (!projectRoot) return;
    try {
      setInstalled(await listInstalled());
    } catch (e) {
      console.error("[ToolsPanel] listInstalled failed:", e);
    }
  };

  const refreshInstalledMcps = async () => {
    if (!projectRoot) return;
    try {
      setInstalledMcps(await listInstalledMcps(projectRoot));
    } catch (e) {
      console.error("[ToolsPanel] listInstalledMcps failed:", e);
    }
  };

  useEffect(() => {
    refreshInstalled();
    refreshInstalledMcps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectRoot]);

  const sortedFiltered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matched = q
      ? CATALOG.filter(
          (e) =>
            e.name.toLowerCase().includes(q) ||
            e.description.toLowerCase().includes(q) ||
            e.binary.toLowerCase().includes(q),
        )
      : CATALOG;
    return [...matched].sort((a, b) => {
      const aIns = installed.has(a.id) ? 0 : 1;
      const bIns = installed.has(b.id) ? 0 : 1;
      return aIns - bIns;
    });
  }, [search, installed]);

  const installedMcpNames = useMemo(
    () => new Set(installedMcps.map((m) => m.name)),
    [installedMcps],
  );

  // Catalog entries whose id is NOT already installed — the "Add More" pool.
  const catalogNotInstalled = useMemo(() => {
    const q = mcpSearch.trim().toLowerCase();
    const pool = MCP_CATALOG.filter((e) => !installedMcpNames.has(e.id));
    return q
      ? pool.filter(
          (e) =>
            e.name.toLowerCase().includes(q) ||
            e.description.toLowerCase().includes(q),
        )
      : pool;
  }, [mcpSearch, installedMcpNames]);

  // Installed MCPs filtered by search — the "Your Connections" list.
  const filteredInstalledMcps = useMemo(() => {
    const q = mcpSearch.trim().toLowerCase();
    return q
      ? installedMcps.filter((m) => m.name.toLowerCase().includes(q))
      : installedMcps;
  }, [mcpSearch, installedMcps]);

  // Set of catalog ids that use HTTP + no env vars (OAuth flow — need /mcp auth).
  const oauthCatalogIds = useMemo(
    () =>
      new Set(
        MCP_CATALOG.filter(
          (e) => e.transport === "http" && e.envVars.length === 0,
        ).map((e) => e.id),
      ),
    [],
  );

  // ── CLI card actions — all delegate to the active Claude session ──

  const onCliInstall = async (entry: CatalogEntry) => {
    await writeToActiveSession(
      `Install ${entry.name} (${entry.binary}) on this machine. Use brew on macOS, apt/snap on Linux, or winget/choco on Windows. After installing, verify with \`which ${entry.binary}\`.\r`,
    );
    // Refresh after delays so the installed status catches up.
    setTimeout(() => void refreshInstalled(), 5000);
    setTimeout(() => void refreshInstalled(), 10000);
  };

  const onCliRemove = async (entry: CatalogEntry) => {
    await writeToActiveSession(
      `Uninstall ${entry.name} (${entry.binary}) from this machine. Use brew uninstall on macOS, apt remove on Linux, etc.\r`,
    );
    setTimeout(() => void refreshInstalled(), 5000);
    setTimeout(() => void refreshInstalled(), 10000);
  };

  const onCliExplore = async (entry: CatalogEntry) => {
    await writeToActiveSession(`What can I do with ${entry.name}?\r`);
  };

  // ── MCP card actions ──

  const onMcpExplore = async (name: string) => {
    await writeToActiveSession(
      `What can I do with the ${name} MCP server?\r`,
    );
  };

  const onConnectMcp = async (entry: McpEntry) => {
    // For entries with env vars, check all are filled in.
    if (entry.envVars.length > 0) {
      const vals = mcpEnvInputs[entry.id] ?? {};
      const missing = entry.envVars.filter((v) => !vals[v]?.trim());
      if (missing.length > 0) return; // inputs not filled yet
      // Build: claude mcp add <slug> --transport stdio -e KEY=VAL ... -- npx -y <pkg>
      const envFlags = entry.envVars.map((v) => `-e ${v}=${vals[v].trim()}`).join(" ");
      const parts = entry.endpoint.split(" "); // e.g. ["npx", "-y", "@pkg/name"]
      const cmd = `claude mcp add ${entry.id} --transport ${entry.transport} ${envFlags} -- ${parts.join(" ")}`;
      await writeToActiveSession(cmd + "\r");
    } else if (entry.transport === "http") {
      const cmd = `claude mcp add ${entry.id} --transport http ${entry.endpoint}`;
      await writeToActiveSession(cmd + "\r");
    } else {
      // stdio with no env vars
      const parts = entry.endpoint.split(" ");
      const cmd = `claude mcp add ${entry.id} --transport stdio -- ${parts.join(" ")}`;
      await writeToActiveSession(cmd + "\r");
    }
    // Refresh after delays to let Claude write the config file.
    setTimeout(() => void refreshInstalledMcps(), 2000);
    setTimeout(() => void refreshInstalledMcps(), 5000);
    setTimeout(() => void refreshInstalledMcps(), 10000);
  };

  const onAuthenticateMcp = async () => {
    await writeToActiveSession("/mcp\r");
  };

  const onRemoveMcp = async (name: string) => {
    await writeToActiveSession(`claude mcp remove ${name}\r`);
    setTimeout(() => void refreshInstalledMcps(), 2000);
    setTimeout(() => void refreshInstalledMcps(), 5000);
  };

  const setMcpEnvVar = (entryId: string, varName: string, value: string) => {
    setMcpEnvInputs((prev) => ({
      ...prev,
      [entryId]: { ...(prev[entryId] ?? {}), [varName]: value },
    }));
  };

  if (!projectRoot) {
    return (
      <div className={styles.panel}>
        <p className={styles.empty}>Connect a project to install tools.</p>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <h2 className={styles.heading}>Give your agent hands</h2>

      {/* Tab strip */}
      <div className={styles.tabStrip}>
        <button
          type="button"
          className={`${styles.tab} ${activeTab === "cli" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("cli")}
        >
          CLI
        </button>
        <button
          type="button"
          className={`${styles.tab} ${activeTab === "mcp" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("mcp")}
        >
          MCP
        </button>
      </div>

      {activeTab === "cli" && (
        <>
          <p className={styles.tagline}>
            Install tools so Claude can act on your IT systems via Bash.
          </p>
          <input
            type="text"
            className={styles.search}
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className={styles.grid}>
            {sortedFiltered.map((entry) => (
              <ToolCard
                key={entry.id}
                entry={entry}
                installed={installed.has(entry.id)}
                onInstall={() => onCliInstall(entry)}
                onRemove={() => onCliRemove(entry)}
                onExplore={() => onCliExplore(entry)}
              />
            ))}
          </div>
        </>
      )}

      {activeTab === "mcp" && (
        <>
          <p className={styles.tagline}>
            Add MCP servers so Claude can interact with your SaaS tools
            directly.
          </p>
          <input
            type="text"
            className={styles.search}
            placeholder="Search MCP servers…"
            value={mcpSearch}
            onChange={(e) => setMcpSearch(e.target.value)}
          />

          {/* Section 1: Your Connections */}
          <h3 className={styles.sectionHeading}>Your Connections</h3>
          {filteredInstalledMcps.length === 0 ? (
            <p className={styles.mcpEmptyHint}>No connections yet.</p>
          ) : (
            <div className={styles.grid}>
              {filteredInstalledMcps.map((mcp) => (
                <InstalledMcpCard
                  key={`${mcp.source}-${mcp.name}`}
                  mcp={mcp}
                  needsAuth={oauthCatalogIds.has(mcp.name)}
                  onAuthenticate={onAuthenticateMcp}
                  onExplore={() => onMcpExplore(mcp.name)}
                  onRemove={() => onRemoveMcp(mcp.name)}
                />
              ))}
            </div>
          )}

          {/* Section 2: Add More */}
          {catalogNotInstalled.length > 0 && (
            <>
              <h3 className={styles.sectionHeading}>Add More</h3>
              <div className={styles.grid}>
                {catalogNotInstalled.map((entry) => (
                  <McpCard
                    key={entry.id}
                    entry={entry}
                    envInputs={mcpEnvInputs[entry.id] ?? {}}
                    onEnvChange={(varName, value) =>
                      setMcpEnvVar(entry.id, varName, value)
                    }
                    onConnect={() => onConnectMcp(entry)}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function ToolCard({
  entry,
  installed,
  onInstall,
  onRemove,
  onExplore,
}: {
  entry: CatalogEntry;
  installed: boolean;
  onInstall: () => void;
  onRemove: () => void;
  onExplore: () => void;
}) {
  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <span className={styles.cardTitle}>
          {installed && <span className={styles.installedDot} aria-hidden />}
          {entry.name}
          <span className={styles.cardBinary}>{entry.binary}</span>
        </span>
        {installed && <span className={styles.installedPill}>Installed</span>}
      </div>
      <p className={styles.cardDesc}>{entry.description}</p>
      <div className={styles.cardActions}>
        {installed ? (
          <>
            <Button variant="link" size="sm" onClick={onExplore}>
              What can I do with this? →
            </Button>
            <Button variant="ghost" size="sm" onClick={onRemove}>
              Remove
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={onInstall}>
            Install
          </Button>
        )}
        <a
          className={styles.docsLink}
          href={entry.docsUrl}
          target="_blank"
          rel="noreferrer"
        >
          docs ↗
        </a>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Installed MCP card — shown in "Your Connections"
// ---------------------------------------------------------------------------

function sourceBadgeLabel(source: string): string {
  switch (source) {
    case "claude-code":
      return "global";
    case "claude-code-project":
      return "this vault";
    case "claude-desktop":
      return "Claude app";
    default:
      return source;
  }
}

function InstalledMcpCard({
  mcp,
  needsAuth,
  onAuthenticate,
  onExplore,
  onRemove,
}: {
  mcp: InstalledMcp;
  needsAuth: boolean;
  onAuthenticate: () => void;
  onExplore: () => void;
  onRemove: () => void;
}) {
  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <span className={styles.cardTitle}>
          <span className={styles.installedDot} aria-hidden />
          {mcp.name}
        </span>
        <span className={styles.installedPill}>Installed</span>
      </div>
      <div className={styles.cardActions}>
        {needsAuth && (
          <Button variant="primary" size="sm" onClick={onAuthenticate}>
            Authenticate
          </Button>
        )}
        <Button variant="link" size="sm" onClick={onExplore}>
          What can I do with this? →
        </Button>
        <Button variant="ghost" size="sm" onClick={onRemove}>
          Remove
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MCP catalog card — shown in "Add More"
// ---------------------------------------------------------------------------

function McpCard({
  entry,
  envInputs,
  onEnvChange,
  onConnect,
}: {
  entry: McpEntry;
  envInputs: Record<string, string>;
  onEnvChange: (varName: string, value: string) => void;
  onConnect: () => void;
}) {
  const needsEnv = entry.envVars.length > 0;
  const allEnvFilled =
    !needsEnv || entry.envVars.every((v) => envInputs[v]?.trim());

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <span className={styles.cardTitle}>
          {entry.name}
        </span>
      </div>
      <p className={styles.cardDesc}>{entry.description}</p>

      {needsEnv && (
        <div className={styles.mcpEnvBlock}>
          {entry.envVars.map((varName) => (
            <input
              key={varName}
              type="text"
              className={styles.mcpEnvInput}
              placeholder={varName}
              value={envInputs[varName] ?? ""}
              onChange={(e) => onEnvChange(varName, e.target.value)}
            />
          ))}
          <span className={styles.mcpAuthHint}>{entry.authHint}</span>
        </div>
      )}

      <div className={styles.cardActions}>
        <Button
          variant="primary"
          onClick={onConnect}
          disabled={!allEnvFilled}
        >
          Connect
        </Button>
        <a
          className={styles.docsLink}
          href={entry.docsUrl}
          target="_blank"
          rel="noreferrer"
        >
          docs ↗
        </a>
      </div>
    </div>
  );
}
