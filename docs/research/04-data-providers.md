# Market data providers — evaluation

**Last verified:** 2026-09-02

## The constraint

**Telda has no public API.** Neither does the EGX offer a documented free
developer API. Prices must come from third parties, and holdings must be entered
manually or imported from a file.

This is why `src/data/` is a **provider interface with swappable adapters** and a
built-in offline provider: the app must be fully usable with no network at all.

## Candidates

| Provider | EGX coverage | Cost | Auth | Assessment |
|---|---|---|---|---|
| **Yahoo Finance** (`query1.finance.yahoo.com`) | EGX via `.CA` suffix (e.g. `COMI.CA`) | Free | None | **Recommended default.** Undocumented/unofficial endpoint, no SLA, may rate-limit or break. Good enough for a personal dashboard. |
| **EODHD** | Documented EGX exchange support | Paid, free tier | API key | **Best paid option** if reliability matters. |
| **Twelve Data** | EGX = MIC `XCAI` | Free tier + paid | API key | Solid, documented, generous free tier. |
| **EGXAPI** (`egxapi.com`) | EGX-native, order book, bars | Advertises "free forever" | Key | ⚠️ **UNVERIFIED.** Third party (linked to "EGXlytics"), no independent reviews or corporate identity found. Promising but **do not route real orders through it** without due diligence. Data-only use is lower risk. |
| **Mubasher / Investing.com** | Full EGX | Free web | — | Scraping only; brittle and likely against ToS. **Not implemented.** |
| **ICE Consolidated Feed** | Official, L1/L2 | Institutional pricing | Contract | Out of scope. |

## Decision

1. **`mock`** — deterministic offline provider. Default. Zero network. Always works.
2. **`yahoo`** — free, no key. The practical default once online.
3. **`twelvedata`** / **`eodhd`** — key-based, opt-in via settings for reliability.

All conform to one interface (`src/data/provider.ts`), so switching is a
one-line config change and never touches UI or domain code.

## Ticker mapping

EGX symbols differ per provider. `src/data/symbols.ts` holds the mapping table.
Example — Commercial International Bank:

| Context | Symbol |
|---|---|
| EGX / Telda | `COMI` |
| Yahoo Finance | `COMI.CA` |
| Reuters/Refinitiv | `COMI.CA` |

## Rate limits & etiquette

Poll at most **once per minute** during EGX hours (Sun–Thu, 10:00–14:15 EET) and
never outside them — the market is closed and the request is wasted. Cache
aggressively. The market-hours guard lives in `src/core/market-hours.ts`.
