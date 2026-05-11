import { useEffect, useMemo, useState } from "react";
import { listInstalledMcps, type InstalledMcp } from "../lib/api";
import { MCP_CATALOG, type McpEntry } from "../lib/mcpCatalog";
import { CATALOG, type CatalogEntry } from "../lib/toolsCatalog";
import { listInstalled } from "../lib/toolsInstall";
import { Button } from "../ui";
import { writeToActiveSession } from "./activeSession";
import styles from "./ToolsPanel.module.css";

type UnifiedTool = {
  id: string;
  name: string;
  description: string;
  type: "cli" | "mcp";
  installed: boolean;
  /** CLI-specific */
  cliEntry?: CatalogEntry;
  /** MCP-specific */
  mcpEntry?: McpEntry;
  installedMcp?: InstalledMcp;
  needsAuth?: boolean;
};

export function ToolsPanel({ projectRoot }: { projectRoot: string | null }) {
  const [installed, setInstalled] = useState<Set<string>>(new Set());
  const [installedMcps, setInstalledMcps] = useState<InstalledMcp[]>([]);
  const [search, setSearch] = useState("");
  const [mcpEnvInputs, setMcpEnvInputs] = useState<Record<string, Record<string, string>>>({});

  const refreshInstalled = async () => {
    if (!projectRoot) return;
    try { setInstalled(await listInstalled()); } catch { /* */ }
  };
  const refreshInstalledMcps = async () => {
    if (!projectRoot) return;
    try { setInstalledMcps(await listInstalledMcps(projectRoot)); } catch { /* */ }
  };

  useEffect(() => {
    refreshInstalled();
    refreshInstalledMcps();
  }, [projectRoot]);

  const oauthCatalogIds = useMemo(
    () => new Set(MCP_CATALOG.filter((e) => e.transport === "http" && e.envVars.length === 0).map((e) => e.id)),
    [],
  );

  const installedMcpNames = useMemo(
    () => new Set(installedMcps.map((m) => m.name)),
    [installedMcps],
  );

  // Build unified list
  const tools = useMemo(() => {
    const list: UnifiedTool[] = [];

    // CLI tools
    for (const entry of CATALOG) {
      list.push({
        id: `cli-${entry.id}`,
        name: entry.name,
        description: entry.description,
        type: "cli",
        installed: installed.has(entry.id),
        cliEntry: entry,
      });
    }

    // Installed MCPs (not in catalog)
    for (const mcp of installedMcps) {
      const catalogEntry = MCP_CATALOG.find((e) => e.id === mcp.name);
      list.push({
        id: `mcp-installed-${mcp.name}`,
        name: mcp.name,
        description: catalogEntry?.description ?? "Connected MCP server",
        type: "mcp",
        installed: true,
        mcpEntry: catalogEntry,
        installedMcp: mcp,
        needsAuth: oauthCatalogIds.has(mcp.name),
      });
    }

    // MCP catalog entries not installed
    for (const entry of MCP_CATALOG) {
      if (installedMcpNames.has(entry.id)) continue;
      list.push({
        id: `mcp-catalog-${entry.id}`,
        name: entry.name,
        description: entry.description,
        type: "mcp",
        installed: false,
        mcpEntry: entry,
      });
    }

    // Filter by search
    const q = search.trim().toLowerCase();
    const filtered = q
      ? list.filter((t) => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q))
      : list;

    // Sort: installed first, then alphabetical
    return filtered.sort((a, b) => {
      if (a.installed !== b.installed) return a.installed ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [search, installed, installedMcps, installedMcpNames, oauthCatalogIds]);

  // Actions
  const onCliInstall = async (entry: CatalogEntry) => {
    await writeToActiveSession(
      `Install ${entry.name} (${entry.binary}) on this machine. Use brew on macOS, apt/snap on Linux, or winget/choco on Windows. After installing, verify with \`which ${entry.binary}\`.\r`,
    );
    setTimeout(() => void refreshInstalled(), 5000);
    setTimeout(() => void refreshInstalled(), 10000);
  };
  const onCliRemove = async (entry: CatalogEntry) => {
    await writeToActiveSession(`Uninstall ${entry.name} (${entry.binary}) from this machine.\r`);
    setTimeout(() => void refreshInstalled(), 5000);
  };
  const onExplore = async (name: string) => {
    await writeToActiveSession(`What can I do with ${name}?\r`);
  };
  const onConnectMcp = async (entry: McpEntry) => {
    if (entry.envVars.length > 0) {
      const vals = mcpEnvInputs[entry.id] ?? {};
      const missing = entry.envVars.filter((v) => !vals[v]?.trim());
      if (missing.length > 0) return;
      const envFlags = entry.envVars.map((v) => `-e ${v}=${vals[v].trim()}`).join(" ");
      const parts = entry.endpoint.split(" ");
      const cmd = `claude mcp add ${entry.id} --transport ${entry.transport} ${envFlags} -- ${parts.join(" ")}`;
      await writeToActiveSession(cmd + "\r");
    } else if (entry.transport === "http") {
      await writeToActiveSession(`claude mcp add ${entry.id} --transport http ${entry.endpoint}\r`);
    } else {
      const parts = entry.endpoint.split(" ");
      await writeToActiveSession(`claude mcp add ${entry.id} --transport stdio -- ${parts.join(" ")}\r`);
    }
    setTimeout(() => void refreshInstalledMcps(), 2000);
    setTimeout(() => void refreshInstalledMcps(), 5000);
  };
  const onRemoveMcp = async (name: string) => {
    await writeToActiveSession(`claude mcp remove ${name}\r`);
    setTimeout(() => void refreshInstalledMcps(), 2000);
  };
  const onAuthenticateMcp = async () => {
    await writeToActiveSession("/mcp\r");
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
      <p className={styles.tagline}>
        Install tools so Claude can act on your IT systems.
      </p>
      <input
        type="text"
        className={styles.search}
        placeholder="Search tools…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className={styles.grid}>
        {tools.map((tool) => (
          <div key={tool.id} className={styles.card}>
            <div className={styles.cardHeader}>
              <span className={styles.cardTitle}>
                {tool.installed && <span className={styles.installedDot} aria-hidden />}
                {tool.name}
                {tool.type === "cli" && tool.cliEntry && (
                  <span className={styles.cardBinary}>{tool.cliEntry.binary}</span>
                )}
              </span>
              <span className={styles.mcpTransportBadge}>{tool.type.toUpperCase()}</span>
            </div>
            <p className={styles.cardDesc}>{tool.description}</p>

            {/* MCP env var inputs */}
            {!tool.installed && tool.mcpEntry && tool.mcpEntry.envVars.length > 0 && (
              <div className={styles.mcpEnvBlock}>
                {tool.mcpEntry.envVars.map((varName) => (
                  <input
                    key={varName}
                    type="text"
                    className={styles.mcpEnvInput}
                    placeholder={varName}
                    value={mcpEnvInputs[tool.mcpEntry!.id]?.[varName] ?? ""}
                    onChange={(e) => setMcpEnvVar(tool.mcpEntry!.id, varName, e.target.value)}
                  />
                ))}
                {tool.mcpEntry.authHint && (
                  <span className={styles.mcpAuthHint}>{tool.mcpEntry.authHint}</span>
                )}
              </div>
            )}

            <div className={styles.cardActions}>
              {tool.installed ? (
                <>
                  <Button variant="link" size="sm" onClick={() => onExplore(tool.name)}>
                    What can I do with this? →
                  </Button>
                  {tool.needsAuth && (
                    <Button variant="primary" size="sm" onClick={onAuthenticateMcp}>
                      Authenticate
                    </Button>
                  )}
                  {tool.type === "cli" && tool.cliEntry && (
                    <Button variant="ghost" size="sm" onClick={() => onCliRemove(tool.cliEntry!)}>
                      Remove
                    </Button>
                  )}
                  {tool.type === "mcp" && (
                    <Button variant="ghost" size="sm" onClick={() => onRemoveMcp(tool.name)}>
                      Remove
                    </Button>
                  )}
                </>
              ) : (
                <>
                  {tool.type === "cli" && tool.cliEntry && (
                    <Button variant="primary" onClick={() => onCliInstall(tool.cliEntry!)}>
                      Install
                    </Button>
                  )}
                  {tool.type === "mcp" && tool.mcpEntry && (
                    <Button
                      variant="primary"
                      onClick={() => onConnectMcp(tool.mcpEntry!)}
                      disabled={tool.mcpEntry.envVars.length > 0 && !tool.mcpEntry.envVars.every((v) => mcpEnvInputs[tool.mcpEntry!.id]?.[v]?.trim())}
                    >
                      Connect
                    </Button>
                  )}
                </>
              )}
              {(tool.cliEntry?.docsUrl || tool.mcpEntry?.docsUrl) && (
                <a
                  className={styles.docsLink}
                  href={tool.cliEntry?.docsUrl ?? tool.mcpEntry?.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  docs ↗
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
      <p className={styles.mcpEmptyHint}>
        Can't find your app?{" "}
        <button
          type="button"
          className={styles.hintLink}
          onClick={() => {
            writeToActiveSession(
              "What MCP servers or CLI tools can you install for me?\r",
            );
          }}
        >
          Ask Claude Code
        </button>{" "}
        to install it.
      </p>
    </div>
  );
}
