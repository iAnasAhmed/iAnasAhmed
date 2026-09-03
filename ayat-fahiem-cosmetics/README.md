# The Ayat Fahiem Growth Dossier

A single-file strategic intelligence console for **Ayat Fahiem Cosmetics** (ayatfahiem.com) —
built on the store's own live Shopify data, cross-read against 2026 global prestige-beauty
and Egyptian market research.

Open `index.html` in a browser. No build step, no dependencies, no network calls except Google Fonts.

## What's in it

| # | Section | What it answers |
|---|---------|-----------------|
| 00 | Position | The thesis, six headline metrics, and the shade card sized by revenue |
| 01 | The P&L truth | Monthly gross sales and orders, seasonality, returns |
| 02 | Four leaks, priced | The full funnel with each drop-off costed in EGP |
| 03 | Catalog X-ray | Every SKU sortable, category mix, the price-ladder contradiction |
| 04 | Who is buying | Revenue by governorate, customer economics, data hygiene |
| 05 | The Egyptian market | Sizing, macro, the 1.56× import-duty wall, channel map |
| 06 | Global high-end board | 24-brand tracker, filterable, with the mechanic to steal from each |
| 07 | Trend radar 2026 | 12 trends, each verdicted act / build / watch / not yours |
| 08 | The strategy | Positioning, portfolio architecture, wedge, moat, stop-doing list |
| 09 | Eleven plays | Costed and ranked by modelled annual EGP impact |
| 10 | Unit economics lab | Interactive contribution model with 14 inputs and a cost waterfall |
| 11 | Road to EGP 12m | Four-lever twelve-month projection against the real baseline |
| 12 | First ninety days | Sequenced checklist, persisted in `localStorage` |
| 13 | Risk register | Nine risks with the early-warning signal for each |
| 14 | Method & sources | What is measured, what is modelled, and 22 references |

## Data provenance

Two kinds of number, kept separate throughout:

- **Marked `§` — measured.** Pulled from the Shopify Admin API for `ayatfahiem.com` on
  3 September 2026: monthly sales/orders/discounts/returns, the session-to-purchase funnel,
  traffic by referrer/device/country, sales by governorate and city, product-level revenue over
  both 12 months and 90 days, the live and archived catalogue with prices and stock, collections,
  and samples of recent orders and repeat customers. Headline totals use the twelve complete
  months **Sep 2025 – Aug 2026**; September 2026 is excluded because it was two days old.
- **Modelled.** Sections 10 and 11 and the "recoverable EGP" column in section 02. Shopify holds
  no cost of goods, ad spend or courier invoices, so those inputs are assumptions — exposed as
  sliders so they can be replaced with real figures. Uplift assumptions use the conservative end
  of published 2026 benchmarks.

## Build notes

- Single HTML file, ~134 KB, no framework. Charts are hand-built SVG, re-rendered on resize.
- Themes: full light and dark token sets covering `prefers-color-scheme` and an explicit
  `data-theme` stamp.
- Chart palette validated for colour-vision deficiency in both modes — categorical hues
  `#b4315e · #c08015 · #3f51a8 · #00937c · #8a4fb8` (light) and
  `#db5384 · #b5851c · #7286dd · #12a88f · #a87cdd` (dark), with a single-hue wine ramp for the
  ordinal funnel.
- Type: Instrument Serif (display) · Archivo (body) · IBM Plex Mono (data) · IBM Plex Sans Arabic.
