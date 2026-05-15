# OpenIT landing site

Static marketing + downloads page for OpenIT. Astro, no client JS, plain CSS.

## Run locally

```bash
cd landing
npm install
npm run dev
```

Site lives at http://localhost:4321.

## Build

```bash
npm run build
```

Static output lands in `landing/dist/`. Drop into any static host (Cloudflare
Pages, GitHub Pages once the repo is public, Vercel, S3, anything).

## Pages

- `/` — what OpenIT is, screenshot, download CTA. Download buttons link
  directly to the platform-specific installer on GitHub Releases (rewritten
  client-side via UA sniff; SSR fallback points at the release page).
- `/privacy` — privacy stub.
- `/terms` — terms stub.

## How the download links work

`src/lib/release.ts` fetches the latest release tag from
`https://api.github.com/repos/openit-app/openit-app/releases/latest` at build
time. If no release exists yet (404), it falls back to a "coming soon" state.

The tag determines the filenames it links to. Tauri produces:
- `OpenIT_<version>_aarch64.dmg`
- `OpenIT_<version>_x64.dmg`
- `OpenIT_<version>_x64-setup.exe`

If the file naming changes in the release workflow, update the helper.

## Analytics

Two metrics are tracked, each from the source that's actually authoritative
for that metric:

| Metric | Source | Where to read it |
|---|---|---|
| Unique visitors / pageviews | Cloudflare Web Analytics beacon (injected in `BaseLayout.astro` at build time) | https://dash.cloudflare.com → Analytics & Logs → Web Analytics → `openit-app.github.io` |
| App downloads (total, per asset) | GitHub Releases `download_count` per asset, summed across all releases. Surfaced on the landing page next to each download button as "X downloads · vX.Y.Z". | The landing page itself, the GitHub Releases UI, or `curl https://api.github.com/repos/openit-app/openit-app/releases \| jq '[.[].assets[] \| select(.name \| test("\\.(dmg\|exe\|msi)$")) \| .download_count] \| add'` |

The CF beacon is gated behind the `PUBLIC_CF_BEACON_TOKEN` env var so local
dev builds don't ping production analytics. In GitHub Actions it's wired
via the `CF_BEACON_TOKEN` repo secret in `.github/workflows/landing.yml`.

### Why download_count instead of click tracking

Cloudflare Web Analytics doesn't support custom events on the free tier
(see https://developers.cloudflare.com/web-analytics/faq/ — "Does Web
Analytics support custom events? Not yet."). Since the Download buttons
link directly to the GitHub Releases CDN (no intermediate `/download`
page), there's no client-side pageview to count.

`download_count` from the Releases API is actually a higher-fidelity
signal than click counting would be: it's the number of installer
artifacts actually transferred to a user's machine. Clicks can double-fire,
get cancelled, or be triggered by bots — `download_count` is what
the underlying CDN saw served.

## Deferred

There is no deploy workflow this round — review locally, decide a host later.
