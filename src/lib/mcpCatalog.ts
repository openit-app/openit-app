/// MCP server catalog — services that IT admins connect to via Claude
/// Code's native MCP support. Each entry maps to a `claude mcp add`
/// command. Services with good CLIs live in toolsCatalog.ts instead;
/// this catalog covers services where MCP is the best (or only) path.

export type McpEntry = {
  /// Stable key.
  id: string;
  name: string;
  description: string;
  /// The transport: "http" for remote servers, "stdio" for npm packages.
  transport: "http" | "stdio";
  /// For http: the remote MCP URL. For stdio: the npx command.
  endpoint: string;
  /// Environment variables the user needs to provide (API keys, tokens).
  envVars: string[];
  /// Where to get the API key / token.
  authHint: string;
  /// Vendor docs.
  docsUrl: string;
  /// Icon hint for rendering (maps to entity tones/icons).
  iconHint: string;
};

export const MCP_CATALOG: McpEntry[] = [
  {
    id: "monday",
    name: "Monday.com",
    description: "Manage projects, boards, items, and workflows.",
    transport: "http",
    endpoint: "https://mcp.monday.com/mcp",
    envVars: [],
    authHint: "Authenticates via Monday.com OAuth in the browser.",
    docsUrl: "https://support.monday.com/hc/en-us/articles/28588158981266",
    iconHint: "monday",
  },
  {
    id: "zoom",
    name: "Zoom",
    description: "Meeting summaries, transcripts, recordings, scheduling.",
    transport: "stdio",
    endpoint: "npx -y @fastmcp-me/zoom-mcp-server",
    envVars: ["ZOOM_CLIENT_ID", "ZOOM_CLIENT_SECRET", "ZOOM_ACCOUNT_ID"],
    authHint: "Create a Server-to-Server OAuth app at marketplace.zoom.us/develop/create → get Client ID, Secret, and Account ID.",
    docsUrl: "https://www.npmjs.com/package/@fastmcp-me/zoom-mcp-server",
    iconHint: "zoom",
  },
];

export function findMcpEntry(id: string): McpEntry | undefined {
  return MCP_CATALOG.find((e) => e.id === id);
}
