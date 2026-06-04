// Build-time helper. Fetches the latest GH release once during `astro build`
// (or at dev-server start). If the repo has no releases yet, returns a
// pending placeholder so the page still renders.

const REPO = "openit-app/openit-app";

export interface ReleaseInfo {
  available: boolean;
  version: string;
  arm64DmgUrl: string | null;
  x64DmgUrl: string | null;
  winExeUrl: string | null;
  winMsiUrl: string | null;
  releaseUrl: string | null;
  totalDownloads: number;
}

export async function getLatestRelease(): Promise<ReleaseInfo> {
  try {
    // Authenticate when a token is available (GITHUB_TOKEN is auto-provided in
    // GitHub Actions). Unauthenticated requests are capped at 60/hour per IP —
    // which silently empties the download count and the installer links on any
    // rate-limited build. A token raises the cap to 5000/hour.
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    // Sum download_count across the latest release AND any prior releases so the
    // tally doesn't reset when we cut a new version.
    const [latestRes, allRes] = await Promise.all([
      fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers }),
      fetch(`https://api.github.com/repos/${REPO}/releases?per_page=100`, { headers }),
    ]);
    if (!latestRes.ok) {
      return pending();
    }
    const data = (await latestRes.json()) as {
      tag_name: string;
      html_url: string;
      assets: Array<{ name: string; browser_download_url: string; download_count: number }>;
    };
    const allReleases = allRes.ok
      ? ((await allRes.json()) as Array<{
          assets: Array<{ name: string; download_count: number }>;
        }>)
      : [{ assets: data.assets }];

    const findAsset = (suffix: string) =>
      data.assets.find((a) => a.name.endsWith(suffix))?.browser_download_url ?? null;

    const isInstaller = (name: string) =>
      name.endsWith(".dmg") || name.endsWith(".exe") || name.endsWith(".msi");

    const totalDownloads = allReleases.reduce(
      (sum, rel) =>
        sum +
        rel.assets
          .filter((a) => isInstaller(a.name))
          .reduce((s, a) => s + (a.download_count ?? 0), 0),
      0,
    );

    return {
      available: true,
      version: data.tag_name.replace(/^v/, ""),
      arm64DmgUrl: findAsset("_aarch64.dmg"),
      x64DmgUrl: findAsset("_x64.dmg"),
      winExeUrl: findAsset("-setup.exe"),
      winMsiUrl: findAsset("_en-US.msi"),
      releaseUrl: data.html_url,
      totalDownloads,
    };
  } catch {
    return pending();
  }
}

function pending(): ReleaseInfo {
  return {
    available: false,
    version: "0.1.0",
    arm64DmgUrl: null,
    x64DmgUrl: null,
    winExeUrl: null,
    winMsiUrl: null,
    releaseUrl: null,
    totalDownloads: 0,
  };
}
