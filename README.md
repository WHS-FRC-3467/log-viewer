# FRC Log Server

A static, GitHub-Pages-hosted viewer for FRC robot logs. Logs live in separate storage repos (one per season, e.g. [WHS-FRC-3467/logs-2026](https://github.com/WHS-FRC-3467/logs-2026)); the site reads their indexes at runtime and each browser downloads only the log it opens, in the AdvantageScope Lite web viewer, via a shareable link.

## How it works

`npm run build` downloads the pinned AdvantageScope Lite release (`lite.config.json`), extracts its static site (no fork, no recompiling), and injects a small shim (`site/viewer-shim.js`) that replaces the Python server endpoints (`assets`, `logs`, `logs/<name>`) with static files:

- `dist/` landing page (`site/`), `dist/viewer/` patched Lite, `dist/viewer/assets/` bundled + custom assets with a generated `index.json`.
- `site/log-index.js` merges the log lists of every source in `site.config.json` `logSources` (read from `raw.githubusercontent.com`) plus any logs bundled in this repo's `logs/`, and fetches/gunzips logs in the browser (`DecompressionStream`).
- Deep links are `viewer/?log=<path>`, where the path starts with the source's `folder` (e.g. `2026/NE-DCMP/Quals/...`); local files opened from the landing page go through IndexedDB (`viewer/?local=<id>`) and are never uploaded.

## Setup

1. Create a public GitHub repo and push this folder to `main`.
2. Settings > Pages > Source: **GitHub Actions**.
3. The workflow in `.github/workflows/deploy.yml` builds and deploys on every push.

Edit `site.config.json` to change the site title and team number, the log sources, and bundled asset folders to leave out (`excludeBundledAssets`, saves Pages space).

## Adding logs

Push them to the season's storage repo (see its README); its Action gzips them and regenerates its `index.json`, and they appear on the site a few minutes later without rebuilding it.

New season: create `logs-<year>` from the previous storage repo's tooling (`scripts/`, `.github/`, README, no logs) and add it to `logSources`:

```json
"logSources": [
  { "repo": "WHS-FRC-3467/logs-2027", "branch": "main", "folder": "2027" },
  { "repo": "WHS-FRC-3467/logs-2026", "branch": "main", "folder": "2026" }
]
```

A source can also be `{ "url": "https://host/dir/", "folder": "..." }` for any static host that sends CORS headers and has the same `index.json` format. Logs can still be bundled into the site by committing them to `logs/` here (see `logs/README.md`), which counts against the 1 GB Pages limit.

## Custom robots, fields, joysticks

Add folders to `assets/` (see `assets/README.md`).

## Upgrading Lite

Edit `lite.config.json` to a newer release tag and run `npm run build`. The build fails loudly if the Lite markup no longer matches the injection anchors. Re-verify the shim against the new bundles: it relies on the same-origin `assets` / `logs` fetches in `bundles/main.js`, the hub's `window.messagePort`/`open-files` message, `window.assets`, and `window.electron.getFilePath` in the hub's drop handler.

## Local development

```
npm install
npm run build     # use NODE_OPTIONS=--use-system-ca if behind a TLS-inspecting proxy
npm run serve     # http://localhost:8080
```

## Limits

- Storage repos: 100 MB per (gzipped) file; keep each under ~5 GB. `raw.githubusercontent.com` caches for ~5 minutes and isn't a CDN, so very heavy traffic could be throttled.
- GitHub Pages: 1 GB site (build warns above 95 MB per file / 900 MB total).
- The entire log is downloaded into the browser before opening.
- `.hoot` and `.revlog` are not supported; no live NetworkTables connection.
- Lite is an alpha release; it shows its own welcome dialog.

## Attribution

Viewer powered by AdvantageScope Lite, BSD-3-Clause, (c) Littleton Robotics. License texts are published with the site (`LICENSE-AdvantageScope.txt`, `ThirdPartyLicenses.txt`). The site is not affiliated with or endorsed by Littleton Robotics.
