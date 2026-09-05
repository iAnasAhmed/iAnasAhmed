# Ayat Fahiem Cosmetics — Meta Ads Command Centre

A live dashboard and media-buying mentor for the **ayatfahiemcosmetics** Meta ad account
(`1119657799748776`, EGP). It tracks what is happening, keeps its own history so it can tell
you what changed and what happened next, segments your audiences into a working hierarchy,
and builds the campaign plan off your own numbers rather than generic benchmarks.

Built on a small, standard Node stack: Express, better-sqlite3, dotenv on the backend; Chart.js
on the frontend, loaded from a local file rather than a CDN.

```bash
npm install                # pulls the four dependencies, copies Chart.js into public/vendor/
cp .env.example .env       # add your Meta token
npm start                  # → http://localhost:4300
```

It works before you add a token: a baseline of the account's real history (captured 2 Sept 2026)
ships in `data/seed.json` and loads on first boot, so every tab has data from the first second.

---

## Getting it live

1. **Token.** Business Settings → Users → System Users → Generate New Token, on business
   `ayatfahiemcosmetics` (`7587342798035629`). Scopes: `ads_read`, `business_management`.
   Put it in `.env` as `META_ACCESS_TOKEN`. System-user tokens do not expire; a personal token
   dies in about 60 days.
2. **Economics.** The mentor's verdicts are only as good as these, so set them honestly in `.env`:
   `BUSINESS_GROSS_MARGIN` (margin after COGS and shipping), `TARGET_ROAS`, `TARGET_CPA`,
   `MONTHLY_BUDGET`. Break-even ROAS is derived as `1 / margin` — at 55% margin that is 1.82x.
3. **Run it.** `npm start`. It syncs on boot and every 15 minutes after
   (`SYNC_INTERVAL_MINUTES`), and pushes updates to the open dashboard over server-sent events.

`npm run doctor` prints the full mentor report to the terminal.
`npm run sync` forces one sync.

---

## The six tabs

| Tab | What it answers |
|---|---|
| **Pulse** | What is happening right now — spend, return, CPM, click-through, and a delivery calendar where every dark day is visible. |
| **Mentor** | What is wrong, ranked, each with the numbers behind it, why it costs money, and the fix. 19 checks. |
| **Campaigns** | Every campaign and ad set against break-even and target, plus an efficiency map of spend versus return. |
| **Audiences** | What you own, whether it can actually be used, and the ladder you should be running — with the build order for finding new customers. |
| **Planner** | Your real unit economics, budget split across the funnel, four scenarios for the month, and a week-by-week plan. |
| **Research** | What your competitors are running in the Meta Ad Library, how long each ad has survived, and a spreadsheet export of the lot. |
| **History** | Month by month, every delivery gap, every change we detected, Meta's activity log, and when each finding opened and closed. |

---

## What it found in the account

Read on the baseline pulled 2 Sept 2026 — lifetime spend **EGP 654,255**, **3.56x** return.
The account score is **7/100**. It is making money today, but on a foundation that will not hold.

**The good.** `Liptick_Restock_Jul` is running at **7.40x** on EGP 88,866 — 492 purchases at
EGP 181 each against a lifetime blended cost of EGP 243. Average order value is EGP 1,418, and
at 55% margin you keep EGP 780 per order, so there is real headroom to bid harder.

**The four criticals.**

1. **The whole account is one ad set.** One of five ad sets is delivering. When it fatigues,
   revenue goes to zero the same week with nothing warmed up behind it.
2. **That ad set is saturating.** Frequency 5.70, against an audience Meta estimates at only
   10,300–12,200 accounts. Above 5x you are buying diminishing returns daily.
3. **The source audiences are empty.** Purchasers, Visitors_180, Purchased_730 and the AddToCart
   pool each report ~20 accounts. Meta needs 100 to build a lookalike and realistically 1,000+
   for a good one. The pixel is firing and the site has traffic, so these are almost certainly
   bound to the wrong dataset or filtered by a rule that no longer matches — worth checking
   in Audience Manager rather than assuming.
4. **Five of six lookalikes cannot deliver.** They are downstream of (3): a lookalike built on an
   empty seed never activates. That is why there is no working cold-prospecting asset.

**Also open:** 5 dark days in the last 60 (delivery keeps stopping, which restarts learning);
return down 30% week over week; top-of-funnel event match quality at 6.4–6.6 while Purchase sits
at 9.3 (email is on only 21% of AddToCart events, so the retargeting pools can never fill);
no retargeting ad set live at all; and cosmetics, the photography studio and the dress line all
share one ad account and one pixel, which blends the signal all three depend on.

**The shape of the fix**, in the order the Planner lays it out: rebuild the seeds and upload the
Shopify customer list → get a second and third prospecting ad set live → turn on retargeting →
scale what proved itself. On the account's own numbers, a working funnel at the same budget is
worth roughly **EGP 200k gross profit a month against EGP 154k today**; letting the current ad
set saturate takes it to **EGP 96k**.

---

## How it works

```
scripts/postinstall.js  copies Chart.js's browser build into public/vendor/ after npm install
src/
  server.js        Express app — routes, static files, SSE push
  config.js        dotenv-backed config, derived economics
  meta.js          Graph API client — retry, backoff, pagination, action normalisation
  store.js         better-sqlite3 schema and queries
  sync.js          live pull, change detection, seed loader
  api.js           builds one shared context; the six endpoint payloads
  cli.js           `doctor` and `sync` from the terminal
  engine/
    metrics.js     aggregation, windows, gaps, trends
    mentor.js      19 diagnostic rules
    audiences.js   segmentation, the ladder, the new-customer path
    planner.js     unit economics, budget allocation, scenarios, the 4-week plan
  adlibrary.js     Ad Library search, winner detection, CSV export
public/            dashboard — vanilla JS modules; charts.js wraps Chart.js
data/seed.json     baseline history captured from the live account
```

**Dependencies, and why each one.** `express` for routing and static files instead of hand-rolled
`node:http` plumbing. `better-sqlite3` for storage — a synchronous, battle-tested native module
(Node's own experimental `node:sqlite` was modelled on its API, so the swap was mechanical).
`dotenv` for `.env` loading. `chart.js` for the line, bar and bubble/scatter charts. Two chart
types stay hand-rolled SVG on purpose: the delivery calendar and the inline tile sparklines have
no clean native Chart.js fit, and forcing them through a chart library would cost more code and
risk than the SVG they replace.

**Competitor research.** The Research tab reads the public Meta Ad Library through the
official `ads_archive` endpoint. You track competitors by their Facebook page, and the dashboard
shows every ad they are running ranked by how long it has been live — an ad still running after
30 days has survived enough optimisation that its offer, hook and audience are all working, which
is the only signal the Ad Library gives you about what is performing. Everything exports to CSV,
which Excel and Google Sheets both open natively (the file carries a UTF-8 BOM so Excel reads the
Arabic correctly).

Two deliberate limits. It tracks pages rather than only keywords, because a keyword search
returns the newest ads across every advertiser while a page search returns one brand's whole
active roster — which is what you actually need to spot a long-runner. And it does not download
creative in bulk: `ads_archive` returns ad text, dates and a link, never the image or video files,
and pulling those would mean scraping facebook.com, which breaks Meta's terms. Each ad opens in
the Ad Library instead, and "Copy all links" gets you the whole set at once.

Because the dashboard records every ad it has ever seen with its own first-seen and last-seen
timestamps, it can tell you an ad has since stopped and how long it ultimately ran — something a
browser extension reading one page of results cannot do.

**History is the point.** Every sync writes daily facts per entity and diffs entity
configuration against the previous sync, so budget changes, status flips and new objects land in
a changelog. Meta's own activity log is mirrored locally, which matters because Meta only keeps
90 days of it. Findings are persisted with first-seen and resolved-at timestamps, so you can see
when a problem started and whether your fix actually closed it.

**Numbers you can trust.** Rates are always recomputed from raw counts after aggregating, never
averaged across days — averaging rates over days with different spend is the most common way a
media dashboard lies. Account-level spend and revenue are never patched from another level. Where
the baseline cannot know something (per-day purchase counts, which arrive with the first live
sync) the dashboard says so instead of showing a zero.

**Charts.** Chart.js, loaded from `public/vendor/chart.umd.js` — a file `npm install` copies out
of `node_modules`, not a CDN `<script>` tag, so the dashboard still works with no internet access
once installed. Spend and return are two stacked plots sharing a timeline rather than one
dual-axis chart. Colours are a validated categorical set that stays distinguishable under
colour-vision deficiency in both light and dark themes; status colours are reserved for state and
always paired with a word, never colour alone. Line charts get a hover crosshair via a small
custom Chart.js plugin; every chart's tooltip is custom HTML (Chart.js's "external tooltip" hook)
so it looks identical to the rest of the interface rather than a canvas-drawn default.

**Interface.** A fixed rail for navigation, a sticky page header carrying the reporting window
(7 / 28 / 90 days on the windowed views), and one card grammar throughout. Light and dark are both
deliberately stepped rather than an inverted flip. It collapses to a single column with a scrolling
top bar on narrow screens, and respects `prefers-reduced-motion`.

---

## Notes and limits

- **Multi-day frequency** is impressions ÷ summed daily reach, which reads slightly low against
  Ads Manager's de-duplicated reach. Treat it as a floor: if the dashboard says fatigue,
  Ads Manager says worse.
- **The baseline** is exact at account level per day. Campaign and ad set splits are spread evenly
  across each entity's active period until the first live sync replaces them with real per-day rows.
- **Read-only.** It never writes to your ad account. Every recommendation is something you action
  in Ads Manager yourself.
- The dashboard follows your system light/dark setting until you press the theme button, which is then
  remembered. `?theme=dark` or `?theme=light` forces one for a single load.
- `?live=0` on the URL disables the push stream — useful for headless screenshots.
- The second account (`660617751508124`, EGP 33,772, no recorded purchases) is tracked in
  `META_EXTRA_AD_ACCOUNTS` but the dashboard focuses on the primary one.
- **better-sqlite3 is a native module.** `npm install` fetches a prebuilt binary for common
  platforms automatically; on an unusual platform/Node combination it falls back to compiling
  from source, which needs a C++ toolchain (Xcode Command Line Tools on macOS, `build-essential`
  on Debian/Ubuntu, the "Desktop development with C++" workload on Windows). This is the one step
  in `npm install` that can fail on a machine with no compiler and no matching prebuilt binary.
