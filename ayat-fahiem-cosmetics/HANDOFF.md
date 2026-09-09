# Ayat Fahiem Cosmetics — context handoff

**For:** the Meta Ads Dashboard project, where this work becomes one tab.
**Source:** Claude Code session, 3–9 Sep 2026.
**Live app:** https://claude.ai/code/artifact/909777c3-b45f-4db7-8890-b61fca584ab8
**Repo:** `iAnasAhmed/iAnasAhmed`, branch `claude/ayat-fahiem-cosmetics-research-u6dasm`, folder `ayat-fahiem-cosmetics/`

---

## 1. What exists

A single-file HTML intelligence console (`index.html`, ~155 KB, no dependencies, no build step) covering the brand end to end in 16 sections. It runs on the store's **real Shopify data** plus 2026 category research, and it contains four interactive tools: a sortable SKU table, a filterable competitor table, a unit-economics model with 14 sliders, and a twelve-month scenario projection.

Section map: 00 Position · 01 P&L truth · 02 Four leaks, priced · 03 Catalog X-ray · 04 Who is buying · 05 The Egyptian market · 06 Who you compete with · 07 Global high-end board · 08 Trend radar 2026 · 09 The strategy · 10 Eleven plays · 11 Unit economics lab · 12 Road to EGP 12m · 13 First ninety days · 14 Risk register · 15 Method & sources.

## 2. The business, in numbers

Store: `ayatfahiem.com` (Shopify Basic, EGP, Egypt). Founder-led colour cosmetics; founder is a clinical pharmacist and makeup artist with a studio in Mansoura.

**Trailing twelve months, Sep 2025 – Aug 2026 — all measured from the Shopify Admin API:**

| Metric | Value |
|---|---|
| Gross sales | EGP 2,775,955 |
| Total sales (after discounts, returns, incl. shipping) | EGP 2,728,075 |
| Orders | 1,674 |
| Average order value | EGP 1,658 |
| Sessions | 79,535 |
| Conversion rate | 2.03% (beauty median on Shopify is 3.2%) |
| Customers | 1,543 — 1,343 new, 279 returning |
| Repeat share of orders | 16.7% (colour-cosmetics benchmark 20–30%) |
| Returns | EGP 140,203 — 5.05% of gross |
| Revenue per session | EGP 34.91 |

**Funnel:** 79,535 sessions → 5,268 carts (6.6%) → 2,821 checkouts (53.6% of carts) → 1,615 purchases (57.3% of checkouts). The checkout stage is the biggest single leak: 1,206 abandoned checkouts a year, worth about EGP 2.0m of intent.

**Shape:** two spikes (Oct 2025, EGP 491k, the blush launch; Jul 2026, EGP 459k, on zero discount) around a four-month trough (Mar–Jun 2026, 67–79 orders/month). April 2026 was the floor at EGP 81k. Peak-to-trough is 6.0×. Last 30 days to 3 Sep: 223 orders, EGP 311,445, AOV 1,391.

**Payment and delivery:** roughly 85% cash-on-delivery — in a sample of the last 20 orders, 17 sat at `PENDING`. Egypt's RTO rate on COD runs 25–35%, so recorded returns understate real leakage.

## 3. Traffic — the part this project cares about

| Source | Sessions (TTM) | Share |
|---|---|---|
| **Instagram** | 43,710 | 54.5% |
| **Facebook** | 15,511 | 19.4% |
| Direct / unknown | 15,048 | 18.8% |
| Pangle (TikTok ad network) | 2,814 | 3.5% |
| TikTok organic | 1,553 | 1.9% |
| Google organic | 1,371 | 1.7% |
| Google paid | 18 | ~0% |

**Meta is 73.9% of all traffic.** That is the headline dependency and the reason a Meta Ads dashboard matters here more than it would for most brands.

Devices: 96.8% mobile (77,607 of 80,133 sessions). Desktop is 2.7%. Every decision is a phone decision.

Geography: Egypt 90.5% of sessions. Cairo alone is 54.7% of revenue (EGP 1,535,828). Then Giza 255k, Alexandria 241k, Dakahlia/Mansoura 206k. Internationally, 4,124 sessions from the US, UAE, Saudi and Kuwait produced **one** order — a shipping-options problem, not a demand problem.

## 4. The active line — 25 SKUs, all lip and cheek

| Line | Active SKUs | Price EGP | Note |
|---|---|---|---|
| Liquid matte lipstick | 14 shades | 860 / 980 | Two prices, one formula |
| Liquid blush | 4 shades | 1,125 / 1,350 / 1,500 | 42% of TTM revenue |
| Lip gloss | 2 | 750 | One at zero stock, one untracked |
| Lip liner (Lip Contour) | 1 | 499 | Untracked; zero sales in 90 days |
| Travel / mini | 3 | 250 / 400 | Most-ordered item in the store |

Stock as of 5 Sep: **608 units, ≈ EGP 538k at retail.** Candy Rose is 24.0% of the live line's revenue; the top five SKUs are 57.1%. **Candy has ~16 days of cover** and is a top-three seller.

Fifteen "Kit" bundle SKUs were archived in Nov 2025 and are **permanently discontinued** — removed from every part of the analysis at the founder's instruction. The only remaining mention is an instruction to delete the leftover empty `/collections/kits` page.

## 5. The competitive position

Egyptian lip and cheek retail splits into mass under EGP 600 and parallel-imported prestige above EGP 1,500. **The whole line sits alone in the gap.** Verified Egyptian shelf prices, Sep 2026:

- Sandra liquid blush *with brush* — **EGP 100**
- Amanda Milano matte lipstick (Egypt's #1 local brand, est. 1984) — **EGP 165–229**
- Maybelline SuperStay Matte Ink — **EGP 468–600** ← the real reference point, same long-wear claim at half the price
- **Ayat Fahiem — EGP 499–1,500**
- MAC lipstick — **EGP 1,499–2,299**
- Rare Beauty Soft Pinch liquid blush — **EGP 2,000–2,916**

So: the blush is 51–75% of Rare Beauty's Egyptian price, the lipstick is 43–65% of MAC's, and the blush is 15× Sandra's. None of that is said anywhere on the site. It also explains why the EGP 1,500 blush outsells both EGP 1,125 blushes combined at full price.

There is no Sephora retail estate in Egypt. Prestige reaches consumers through independent e-tailers (Ramfa, GoMyz, Maven, Havenly, Loolia, Cosmetics EG), none of which carries an Egyptian brand at this quality tier — they are competitors today and the most realistic wholesale route tomorrow.

## 6. The eleven plays, ranked

Modelled at **+EGP 5.34m of additional annual gross sales** in total, against TTM traffic and AOV, using the conservative end of published 2026 benchmarks. Ranked by impact: fix the checkout and delivery promise (750k) · rebuild the price ladder and stop discounting (360k) · build the Lip + Cheek set (520k) · repeat engine (470k) · kill the Mar–Jun trough (480k) · TikTok Shop + 300 creators (550k) · Arabic SEO and real product pages (450k) · turn on the Gulf (400k) · relaunch lip liner (380k) · pharmacy and salon channel (600k) · publish the undertone system (380k).

The single largest headline: closing the conversion gap from 2.03% to the 3.2% beauty median, on traffic already paid for, is **EGP 1.55m/year with zero extra ad spend.**

## 7. Where this connects to the Meta Ads dashboard

**This is the join that makes the two halves worth putting in one project.**

What the dossier is missing, and Meta Ads has:
- **Ad spend and CAC.** The unit-economics model treats acquisition cost as a slider defaulted to EGP 250. It is the single most load-bearing unvalidated assumption in the whole analysis — everything about contribution margin and break-even moves with it.
- **Paid vs organic split of the 73.9%.** Instagram and Facebook sessions are recorded as one bucket. Nobody currently knows how much of the business is bought and how much is earned.
- **CPM, CPC, CTR and cost per purchase** — needed to price the trough-filling and creator plays honestly.
- **ROAS by campaign and by product.** Candy Rose is 24% of revenue; whether that is product-market fit or just where the budget went is unresolved.
- **Whether the Pangle traffic** (2,814 sessions, TikTok's ad network) is a deliberate buy or spillover.

What the dossier gives the dashboard in return: real AOV (1,658), real conversion rate (2.03%), real return rate (5.05%), real COD share (~85%) and real repeat rate (16.7%) — the denominators a ROAS number is meaningless without. A blended ROAS that ignores a 25–35% RTO exposure on cash-on-delivery orders overstates profitability substantially.

## 8. Constraints and gotchas for whoever picks this up

- **Two kinds of number, kept separate.** Figures marked `§` in the app are measured from the Shopify Admin API. Sections 11 and 12 and the "recoverable EGP" column in section 02 are **models** with assumptions exposed as sliders. Keep that distinction — it is the reason the analysis is trustworthy.
- **Headline totals use Sep 2025 – Aug 2026**, twelve complete months. September 2026 is excluded.
- **`ayatfahiem.com` is blocked by the network egress proxy** in these sessions, so nobody has actually seen the live product pages, photography or copy. Several recommendations (shade proof, ingredient story, delivery promise) are inferred from data rather than observed. This is the largest gap in the work.
- **Shopify data is live** — stock and sales move between pulls. Inventory in the app is as of 5 Sep 2026.
- **Trademark exposure:** two shade names, "Barbie" and "Marilyn Monroe", should be renamed before any wholesale contract or Gulf listing.

## 9. Open decisions

1. Play 03 is a **new** Lip + Cheek set at EGP 2,400. Kits are gone, but a forward-looking bundle survives. Confirm whether bundles are wanted at all.
2. Blush repricing to a single EGP 1,500 tier, and lipstick to a single EGP 980 tier, is recommended but not actioned.
3. Nothing in the store has been changed. Every Shopify call in this work was read-only.
