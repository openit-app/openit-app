/// Hardcoded v1 catalog of tools an IT admin can install into their
/// machine. Each entry maps to a brew install and a one-line CLAUDE.md
/// hint that tells Claude the tool exists. Claude already knows the
/// popular tools from training; for less-common ones the hint includes
/// a `<tool> --help` nudge so Claude can self-discover surface area on
/// demand.
///
/// Why local CLIs instead of MCP servers: zero token cost until the
/// tool is actually invoked (no schemas in baseline context), no
/// per-session tool cap, and IT admins already know the brew install
/// pattern.

export type CatalogEntry = {
  /// Short stable id used as the entry key in the marker block.
  id: string;
  name: string;
  description: string;
  /// PATH-resolvable binary name — what `which` looks for.
  binary: string;
  /// Brew install command (preferred). Run as `brew install <pkg>` so
  /// the wrapper just substitutes <pkg>.
  brewPkg: string;
  /// One-line guidance dropped into the project CLAUDE.md when the tool
  /// is installed. Should explain WHAT the tool is plus a HOW-TO nudge
  /// (e.g. "run `<tool> --help`") for less-known tools.
  claudeMdHint: string;
  /// External link shown next to the install button — vendor docs.
  docsUrl: string;
};

export const CATALOG: CatalogEntry[] = [
  {
    id: "aws",
    name: "AWS CLI",
    description: "AWS infrastructure: IAM, EC2, S3, RDS, CloudWatch, etc.",
    binary: "aws",
    brewPkg: "awscli",
    claudeMdHint:
      "AWS CLI (`aws`) is installed. Use it for AWS operations — auth via `aws configure` or AWS_PROFILE.",
    docsUrl: "https://docs.aws.amazon.com/cli/",
  },
  {
    id: "az",
    name: "Azure CLI",
    description: "Azure resources: AAD/Entra, VMs, storage, networking.",
    binary: "az",
    brewPkg: "azure-cli",
    claudeMdHint:
      "Azure CLI (`az`) is installed. Use it for Azure operations — auth via `az login`.",
    docsUrl: "https://learn.microsoft.com/cli/azure/",
  },
  {
    id: "gcloud",
    name: "Google Cloud SDK",
    description: "GCP projects, IAM, GKE, BigQuery, Cloud Run, etc.",
    binary: "gcloud",
    brewPkg: "google-cloud-sdk",
    claudeMdHint:
      "Google Cloud SDK (`gcloud`) is installed. Use it for GCP operations — auth via `gcloud auth login`.",
    docsUrl: "https://cloud.google.com/sdk/docs/",
  },
  {
    id: "gh",
    name: "GitHub CLI",
    description: "Repos, PRs, issues, releases, Actions.",
    binary: "gh",
    brewPkg: "gh",
    claudeMdHint:
      "GitHub CLI (`gh`) is installed. Use it for GitHub operations — auth via `gh auth login`.",
    docsUrl: "https://cli.github.com/",
  },
  {
    id: "okta",
    name: "Okta CLI",
    description: "Okta identity admin: users, groups, apps, policies.",
    binary: "okta",
    brewPkg: "okta/tap/okta-cli",
    claudeMdHint:
      "Okta CLI (`okta`) is installed. Run `okta --help` to see commands. Auth via `okta login`.",
    docsUrl: "https://cli.okta.com/",
  },
  {
    id: "tailscale",
    name: "Tailscale CLI",
    description: "Zero-trust VPN admin: devices, ACLs, exit nodes, audit.",
    binary: "tailscale",
    brewPkg: "tailscale",
    claudeMdHint:
      "Tailscale CLI (`tailscale`) is installed. Use it for tailnet operations — auth via `tailscale up`. Run `tailscale --help` to see commands.",
    docsUrl: "https://tailscale.com/kb/1080/cli",
  },
  {
    id: "op",
    name: "1Password CLI",
    description: "Secrets management, item access, service accounts.",
    binary: "op",
    brewPkg: "1password-cli",
    claudeMdHint:
      "1Password CLI (`op`) is installed. Use `op item get`, `op read op://...` for secrets. Run `op --help` for the full surface.",
    docsUrl: "https://developer.1password.com/docs/cli/",
  },
  {
    id: "gam",
    name: "GAM",
    description: "Google Workspace admin: users, groups, licenses, Drive, OUs.",
    binary: "gam",
    // GAM doesn't ship a Homebrew formula — the official path is the
    // GAM-team installer script. brew install will fail; the failed-
    // state UI then offers "Ask Claude to debug" which hands off the
    // stderr to Claude (the install script URL is in the hint below
    // so the agent has the canonical install method).
    brewPkg: "gam",
    claudeMdHint:
      "GAM (`gam`) is installed for Google Workspace admin. Auth via `gam oauth create`. Run `gam help` for the full surface. If `gam` isn't on PATH, install with the official script at https://github.com/GAM-team/GAM/wiki/How-to-Install-GAM (curl-bash, no brew formula).",
    docsUrl: "https://github.com/GAM-team/GAM/wiki",
  },
  {
    id: "stripe",
    name: "Stripe CLI",
    description: "Stripe billing/audit: customers, subscriptions, events, logs.",
    binary: "stripe",
    brewPkg: "stripe/stripe-cli/stripe",
    claudeMdHint:
      "Stripe CLI (`stripe`) is installed. Auth via `stripe login`. Use it for billing lookups (`stripe customers retrieve`, `stripe events list`, `stripe logs tail`). Run `stripe --help` for the full surface.",
    docsUrl: "https://stripe.com/docs/stripe-cli",
  },
  // --- IT admin SaaS tools (customer-driven) ---
  {
    id: "sf",
    name: "Salesforce CLI",
    description: "Salesforce admin: orgs, metadata, SOQL queries, data, deploy.",
    binary: "sf",
    brewPkg: "salesforcecli",
    claudeMdHint:
      "Salesforce CLI (`sf`) is installed. Use it for Salesforce operations — auth via `sf org login web`. Query with `sf data query --query 'SELECT ...'`. Run `sf --help` for the full surface.",
    docsUrl: "https://developer.salesforce.com/tools/salesforcecli",
  },
  {
    id: "gws",
    name: "Google Workspace CLI",
    description: "Gmail, Drive, Calendar, Sheets, Docs, Chat, Admin — unified.",
    binary: "gws",
    brewPkg: "googleworkspace/tap/gws",
    claudeMdHint:
      "Google Workspace CLI (`gws`) is installed. Covers Gmail, Drive, Calendar, Sheets, Docs, Chat, Admin. Auth via `gws auth setup`. Run `gws --help` for the full surface.",
    docsUrl: "https://github.com/googleworkspace/cli",
  },
  {
    id: "hs",
    name: "HubSpot CLI",
    description: "HubSpot CRM: contacts, deals, tickets, marketing, reports.",
    binary: "hs",
    brewPkg: "hubspot-cli",
    claudeMdHint:
      "HubSpot CLI (`hs`) is installed. Use it for HubSpot CRM operations — auth via `hs auth`. Run `hs --help` for the full surface.",
    docsUrl: "https://developers.hubspot.com/docs/developer-tooling/local-development/hubspot-cli/reference",
  },
  {
    id: "m365",
    name: "Microsoft 365 CLI",
    description: "Outlook, Teams, SharePoint, OneDrive, Entra ID admin.",
    binary: "m365",
    brewPkg: "m365",
    claudeMdHint:
      "Microsoft 365 CLI (`m365`) is installed. Covers Outlook, Teams, SharePoint, OneDrive, Entra ID. Auth via `m365 login`. Run `m365 --help` for the full surface.",
    docsUrl: "https://pnp.github.io/cli-microsoft365/",
  },
  // --- Infrastructure & DevOps ---
  {
    id: "terraform",
    name: "Terraform",
    description: "Infrastructure as code: plan, apply, state for any cloud.",
    binary: "terraform",
    brewPkg: "hashicorp/tap/terraform",
    claudeMdHint:
      "Terraform (`terraform`) is installed. Use it for infrastructure-as-code — `terraform plan`, `terraform apply`. Run `terraform --help` for the full surface.",
    docsUrl: "https://developer.hashicorp.com/terraform/docs",
  },
  {
    id: "kubectl",
    name: "Kubernetes CLI",
    description: "Kubernetes cluster admin: pods, services, deployments, logs.",
    binary: "kubectl",
    brewPkg: "kubectl",
    claudeMdHint:
      "Kubernetes CLI (`kubectl`) is installed. Use it for cluster operations — context via `kubectl config use-context`. Run `kubectl --help` for the full surface.",
    docsUrl: "https://kubernetes.io/docs/reference/kubectl/",
  },
  {
    id: "snyk",
    name: "Snyk CLI",
    description: "Security scanning: vulnerabilities, license issues, IaC misconfigs.",
    binary: "snyk",
    brewPkg: "snyk",
    claudeMdHint:
      "Snyk CLI (`snyk`) is installed. Use it for security scanning — auth via `snyk auth`. Run `snyk test` to scan. Run `snyk --help` for the full surface.",
    docsUrl: "https://docs.snyk.io/snyk-cli",
  },
  // --- Identity & MDM ---
  {
    id: "jamf",
    name: "Jamf Pro CLI",
    description: "Apple device management: computers, policies, profiles, inventory.",
    binary: "jamf",
    brewPkg: "jamf-pro-cli",
    claudeMdHint:
      "Jamf Pro CLI (`jamf`) is installed. Use it for Apple device management — auth via `jamf auth`. Run `jamf --help` for the full surface.",
    docsUrl: "https://learn.jamf.com/en-US/bundle/jamf-pro-documentation-current/page/Jamf_Pro_CLI.html",
  },
  {
    id: "jumpcloud",
    name: "JumpCloud CLI",
    description: "Directory & identity admin: users, groups, devices, policies.",
    binary: "jcapi",
    brewPkg: "jumpcloud/tap/jcapi",
    claudeMdHint:
      "JumpCloud CLI (`jcapi`) is installed. Use it for directory operations — users, groups, device management. Run `jcapi --help` for the full surface.",
    docsUrl: "https://docs.jumpcloud.com/api/",
  },
  // --- Observability & Incidents ---
  {
    id: "datadog",
    name: "Datadog CLI",
    description: "Monitoring: metrics, logs, traces, dashboards, incidents.",
    binary: "datadog-ci",
    brewPkg: "datadog/datadog/datadog-ci",
    claudeMdHint:
      "Datadog CLI (`datadog-ci`) is installed. Use it for CI/CD integration, synthetics, and metric submission. Run `datadog-ci --help` for the full surface.",
    docsUrl: "https://docs.datadoghq.com/continuous_integration/",
  },
  {
    id: "pagerduty",
    name: "PagerDuty CLI",
    description: "Incident management: alerts, escalations, on-call schedules.",
    binary: "pd",
    brewPkg: "martindstone/pagerduty-cli/pd",
    claudeMdHint:
      "PagerDuty CLI (`pd`) is installed. Use it for incident management — auth via `pd login`. Run `pd --help` for the full surface.",
    docsUrl: "https://github.com/martindstone/pagerduty-cli",
  },
  // --- Support & Tickets ---
  {
    id: "zendesk",
    name: "Zendesk CLI (ZCLI)",
    description: "Zendesk admin: tickets, users, orgs, apps, themes.",
    binary: "zcli",
    brewPkg: "zendesk/tap/zcli",
    claudeMdHint:
      "Zendesk CLI (`zcli`) is installed. Use it for Zendesk admin and app development — auth via `zcli login`. Run `zcli --help` for the full surface.",
    docsUrl: "https://developer.zendesk.com/documentation/apps/getting-started/using-zcli/",
  },
];

export function findEntry(id: string): CatalogEntry | undefined {
  return CATALOG.find((e) => e.id === id);
}
