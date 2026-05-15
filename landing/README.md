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

Set the `PUBLIC_CF_BEACON_TOKEN` env var at build time to inject the
Cloudflare Web Analytics beacon. In GitHub Actions, this is wired up via
the `CF_BEACON_TOKEN` repo secret in `.github/workflows/landing.yml`.

Visitor metrics live in the Cloudflare dashboard. Download counts come from
the GitHub Releases API — each asset has a `download_count` field which is
the ground truth for installs.

## Deferred

There is no deploy workflow this round — review locally, decide a host later.
