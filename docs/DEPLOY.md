# Deploying to Cloudflare Pages + Workers

The app is a static site (`dist/`) plus a small API. On Cloudflare the API runs
as **Pages Functions**, which execute on the **Workers runtime** — so one deploy
ships both the site and the Workers. The Functions exist only to proxy Yahoo
Finance (handling its crumb/cookie auth); the app itself is pure static assets.

```
dist/            → static site  (built by `npm run build`)
functions/       → Pages Functions = Workers
  api/quotes.js            GET /api/quotes?symbols=A.CA,B.CA
  api/quote/[symbol].js    GET /api/quote/:symbol
  api/fundamentals/[symbol].js
wrangler.toml    → Pages config (pages_build_output_dir = "dist")
```

## Prerequisites

- Node 22+ and git on your machine.
- A free Cloudflare account.
- This repo cloned locally (see the GitHub section below).

## Option A — deploy from your machine (fastest first look)

```bash
npm run cf:dev     # preview the deployed shape locally (dist/ + functions/)
npm run deploy     # build, then `wrangler pages deploy dist`
```

`npm run deploy` uses `npx wrangler` (nothing is installed into the project).
The first run opens a browser to log in to Cloudflare and, if the Pages project
doesn't exist yet, offers to create it — accept, and keep the name
`telda-investing-tracker`. Wrangler picks up `./functions` automatically, so the
API deploys alongside the site.

## Option B — connect GitHub (recommended: deploys on every push)

1. Push this repo to GitHub (see below).
2. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**.
3. Pick the repo. Set:
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
   - **Framework preset:** None
4. Deploy. Cloudflare detects `functions/` and deploys the API as Workers.
   Every push to the branch now ships a new version, with preview URLs per PR.

No build dependencies are installed (the app is zero-dependency), so the build
is just `tsc` + a copy step and finishes in seconds.

## Environment variables

None are required. Yahoo needs no API key — the proxy mints its own crumb.
Two optional overrides exist (mainly for testing): `YAHOO_BASE` and
`YAHOO_COOKIE_URL`, settable under Pages → Settings → Variables.

## Notes and limits

- **Yahoo is best-effort.** If Cloudflare's egress is rate-limited or Yahoo
  changes shape, live data may thin out; the app degrades gracefully and the
  offline demo provider always works. For guaranteed EGX fundamentals, wire a
  keyed provider (Twelve Data, EODHD) — the provider interface is ready for it.
- **Data stays on the device.** The app keeps your portfolio and notes in the
  browser's `localStorage`; the Worker only relays public market data. Nothing
  personal is ever sent to the server.
- **Custom domain:** add it under Pages → Custom domains once deployed.
