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

import type { CatalogEntryBase } from "./catalogBase";
import { createCatalogFinder } from "./catalogBase";

export type CatalogEntry = CatalogEntryBase & {
  /// PATH-resolvable binary name — what `which` looks for.
  binary: string;
  /// Brew install command (preferred). Run as `brew install <pkg>` so
  /// the wrapper just substitutes <pkg>.
  brewPkg: string;
  /// One-line guidance dropped into the project CLAUDE.md when the tool
  /// is installed. Should explain WHAT the tool is plus a HOW-TO nudge
  /// (e.g. "run `<tool> --help`") for less-known tools.
  claudeMdHint: string;
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
    id: "cloudflared",
    name: "Cloudflare CLI",
    description: "Cloudflare tunnels, DNS, workers, and zero-trust access.",
    binary: "cloudflared",
    brewPkg: "cloudflare/cloudflare/cloudflared",
    claudeMdHint:
      "Cloudflare CLI (`cloudflared`) is installed. Use it for tunnels (`cloudflared tunnel`), DNS, and workers. Run `cloudflared --help` for the full surface.",
    docsUrl: "https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/",
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
  // --- IT admin SaaS tools (verified brew formulas) ---
  {
    id: "sf",
    name: "Salesforce CLI",
    description: "Salesforce admin: orgs, metadata, SOQL queries, data, deploy.",
    binary: "sf",
    brewPkg: "salesforce-cli",
    claudeMdHint:
      "Salesforce CLI (`sf`) is installed. Use it for Salesforce operations — auth via `sf org login web`. Query with `sf data query --query 'SELECT ...'`. Run `sf --help` for the full surface.",
    docsUrl: "https://developer.salesforce.com/tools/salesforcecli",
  },
  {
    id: "gws",
    name: "Google Workspace CLI",
    description: "Gmail, Drive, Calendar, Sheets, Docs, Chat, Admin — unified.",
    binary: "gws",
    brewPkg: "googleworkspace-cli",
    claudeMdHint:
      "Google Workspace CLI (`gws`) is installed. Covers Gmail, Drive, Calendar, Sheets, Docs, Chat, Admin. Auth via `gws auth setup`. Run `gws --help` for the full surface.",
    docsUrl: "https://github.com/googleworkspace/cli",
  },
  // --- Infrastructure & DevOps (verified brew formulas) ---
  {
    id: "kubectl",
    name: "Kubernetes CLI",
    description: "Kubernetes cluster admin: pods, services, deployments, logs.",
    binary: "kubectl",
    brewPkg: "kubernetes-cli",
    claudeMdHint:
      "Kubernetes CLI (`kubectl`) is installed. Use it for cluster operations — context via `kubectl config use-context`. Run `kubectl --help` for the full surface.",
    docsUrl: "https://kubernetes.io/docs/reference/kubectl/",
  },
  {
    id: "snyk",
    name: "Snyk CLI",
    description: "Security scanning: vulnerabilities, license issues, IaC misconfigs.",
    binary: "snyk",
    brewPkg: "snyk-cli",
    claudeMdHint:
      "Snyk CLI (`snyk`) is installed. Use it for security scanning — auth via `snyk auth`. Run `snyk test` to scan. Run `snyk --help` for the full surface.",
    docsUrl: "https://docs.snyk.io/snyk-cli",
  },
];

export const findEntry = createCatalogFinder(CATALOG);
