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
  // --- Anthropic MCP Registry (remote HTTP, one-click auth) ---
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
    id: "linear",
    name: "Linear",
    description: "Issues, projects, cycles, and team workflows.",
    transport: "http",
    endpoint: "https://mcp.linear.app/mcp",
    envVars: [],
    authHint: "Authenticates via Linear OAuth in the browser.",
    docsUrl: "https://linear.app/docs",
    iconHint: "linear",
  },
  {
    id: "notion",
    name: "Notion",
    description: "Search, create, and organize workspace pages and databases.",
    transport: "http",
    endpoint: "https://mcp.notion.com/mcp",
    envVars: [],
    authHint: "Authenticates via Notion OAuth in the browser.",
    docsUrl: "https://developers.notion.com/",
    iconHint: "notion",
  },
  {
    id: "atlassian",
    name: "Jira & Confluence",
    description: "Issues, boards, sprints, wiki pages, and spaces.",
    transport: "http",
    endpoint: "https://mcp.atlassian.com/v1/mcp",
    envVars: [],
    authHint: "Authenticates via Atlassian OAuth in the browser.",
    docsUrl: "https://www.atlassian.com/software/jira",
    iconHint: "atlassian",
  },
  {
    id: "figma",
    name: "Figma",
    description: "Design files, components, and code generation from designs.",
    transport: "http",
    endpoint: "https://mcp.figma.com/mcp",
    envVars: [],
    authHint: "Authenticates via Figma OAuth in the browser.",
    docsUrl: "https://www.figma.com/developers",
    iconHint: "figma",
  },
  {
    id: "stripe",
    name: "Stripe MCP",
    description: "Payments, subscriptions, invoices, and customer data.",
    transport: "http",
    endpoint: "https://mcp.stripe.com",
    envVars: [],
    authHint: "Authenticates via Stripe OAuth in the browser.",
    docsUrl: "https://stripe.com/docs",
    iconHint: "stripe",
  },
  {
    id: "paypal",
    name: "PayPal",
    description: "Payments, transactions, invoices, and disputes.",
    transport: "http",
    endpoint: "https://mcp.paypal.com/mcp",
    envVars: [],
    authHint: "Authenticates via PayPal OAuth in the browser.",
    docsUrl: "https://developer.paypal.com/docs/",
    iconHint: "paypal",
  },
  {
    id: "vercel",
    name: "Vercel",
    description: "Deployments, projects, domains, and serverless functions.",
    transport: "http",
    endpoint: "https://mcp.vercel.com/",
    envVars: [],
    authHint: "Authenticates via Vercel OAuth in the browser.",
    docsUrl: "https://vercel.com/docs",
    iconHint: "vercel",
  },
  {
    id: "supabase",
    name: "Supabase",
    description: "Databases, auth, storage, edge functions, and real-time.",
    transport: "http",
    endpoint: "https://mcp.supabase.com/mcp",
    envVars: [],
    authHint: "Authenticates via Supabase dashboard.",
    docsUrl: "https://supabase.com/docs",
    iconHint: "supabase",
  },
  {
    id: "cloudflare",
    name: "Cloudflare",
    description: "Workers, KV, R2, D1, and DNS management.",
    transport: "http",
    endpoint: "https://bindings.mcp.cloudflare.com/mcp",
    envVars: [],
    authHint: "Authenticates via Cloudflare OAuth in the browser.",
    docsUrl: "https://developers.cloudflare.com/",
    iconHint: "cloudflare",
  },
  {
    id: "huggingface",
    name: "Hugging Face",
    description: "ML models, datasets, Spaces, and Gradio apps.",
    transport: "http",
    endpoint: "https://huggingface.co/mcp",
    envVars: [],
    authHint: "Authenticates via Hugging Face OAuth in the browser.",
    docsUrl: "https://huggingface.co/docs",
    iconHint: "huggingface",
  },
  {
    id: "guru",
    name: "Guru",
    description: "Search and interact with company knowledge base.",
    transport: "http",
    endpoint: "https://mcp.api.getguru.com/mcp",
    envVars: [],
    authHint: "Authenticates via Guru OAuth in the browser.",
    docsUrl: "https://developer.getguru.com/",
    iconHint: "guru",
  },
  {
    id: "amplitude",
    name: "Amplitude",
    description: "Product analytics: events, funnels, cohorts, and dashboards.",
    transport: "http",
    endpoint: "https://mcp.amplitude.com/mcp",
    envVars: [],
    authHint: "Authenticates via Amplitude OAuth in the browser.",
    docsUrl: "https://www.docs.developers.amplitude.com/",
    iconHint: "amplitude",
  },
  // --- npm-based MCP servers (stdio, need API keys) ---
  {
    id: "zoom",
    name: "Zoom",
    description: "Meeting summaries, transcripts, recordings, scheduling.",
    transport: "stdio",
    endpoint: "npx -y @fastmcp-me/zoom-mcp-server",
    envVars: ["ZOOM_CLIENT_ID", "ZOOM_CLIENT_SECRET", "ZOOM_ACCOUNT_ID"],
    authHint: "Create a Server-to-Server OAuth app at marketplace.zoom.us/develop/create.",
    docsUrl: "https://www.npmjs.com/package/@fastmcp-me/zoom-mcp-server",
    iconHint: "zoom",
  },
  {
    id: "servicenow",
    name: "ServiceNow",
    description: "ITSM tickets, incidents, changes, CMDB, and knowledge.",
    transport: "stdio",
    endpoint: "npx -y @servicenow/mcp-server",
    envVars: ["SERVICENOW_INSTANCE_URL", "SERVICENOW_USERNAME", "SERVICENOW_PASSWORD"],
    authHint: "Use your ServiceNow instance URL (e.g. https://myorg.service-now.com) and admin credentials.",
    docsUrl: "https://www.servicenow.com/community/",
    iconHint: "servicenow",
  },
  {
    id: "pagerduty-mcp",
    name: "PagerDuty MCP",
    description: "Incidents, alerts, escalations, and on-call schedules.",
    transport: "stdio",
    endpoint: "npx -y @pagerduty/mcp-server",
    envVars: ["PAGERDUTY_API_KEY"],
    authHint: "Generate a REST API key at yourorg.pagerduty.com/api-keys.",
    docsUrl: "https://developer.pagerduty.com/docs/",
    iconHint: "pagerduty",
  },
  {
    id: "datadog-mcp",
    name: "Datadog MCP",
    description: "Metrics, logs, traces, dashboards, and incident management.",
    transport: "stdio",
    endpoint: "npx -y @datadog/mcp-server",
    envVars: ["DD_API_KEY", "DD_APP_KEY"],
    authHint: "Get API and App keys from app.datadoghq.com/organization-settings/api-keys.",
    docsUrl: "https://docs.datadoghq.com/",
    iconHint: "datadog",
  },
];

export function findMcpEntry(id: string): McpEntry | undefined {
  return MCP_CATALOG.find((e) => e.id === id);
}
