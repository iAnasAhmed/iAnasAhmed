# Telda Investing — verified findings

**Last verified:** 2026-09-02 · **Status:** LIVE

## Headline

**Yes — Telda supports investing, and it is Egyptian-market (EGX) only.**
The service launched **29 March 2026**. This directly answers the project's
opening question: *Phase 1 is the Egyptian market.*

## What is confirmed

| Fact | Detail | Confidence |
|---|---|---|
| Launch date | 29 March 2026 | **High** — multiple independent outlets |
| Market | Egyptian Exchange (EGX) only | **High** |
| Instruments | EGX-listed stocks + mutual fund units | **High** |
| Commission | Zero commission, zero subscription fee | **High** — stated in launch PR |
| Account opening | Minutes, national ID only, fully digital | **High** |
| Regulator | Egypt's Financial Regulatory Authority (FRA) | **High** |
| Brokerage entity | Telda **acquired City Capital**, a licensed broker | **High** |
| Fund partner | **Beltone Asset Management** (announced June 2026) | **High** |
| Card integration | Deposit/withdraw between Telda card and investment account | **High** |
| Real-time prices | Advertised in-app | **Medium** — vendor claim, unverified independently |

## What is NOT available (important for scope)

- **No US / international stocks.** Telda investing is EGX-only. Anyone wanting
  US equities needs a different route (e.g. Thndr's Alpaca-backed US offering).
- **No public API.** No developer API, OAuth, or data export is documented.
  → **This is the single most important architectural constraint of this project.**
  The dashboard cannot auto-sync from Telda. It must be **manual-entry-first**,
  with CSV/JSON import and market prices fetched from independent providers.
- **No crypto.** Telda does not offer crypto (see `05-crypto-egypt-legal.md` for
  why that is unsurprising in Egypt).

## The "zero commission" caveat — verify this yourself in-app

Zero *broker* commission does **not** mean zero cost. Egyptian trades carry
mandatory regulatory charges that no broker can waive — EGX/MCDR/FRA fees and,
since August 2026, **stamp duty on both sides of every trade**. See
`02-egx-costs-and-tax.md`. Telda's marketing figure refers to its own commission.

**Action for the owner:** place one small real trade and record the *exact*
deducted amounts. Put the real numbers into `src/core/costs.ts`. Until then the
cost model uses published regulatory rates and is marked as an estimate.

## Competitive context

**Thndr** is the incumbent — FRA-licensed, 3M+ downloads, EGX stocks, funds, gold,
plus US equities via Alpaca, and a well-regarded learning/simulator product.
Telda's edge is unification: card, payments, and brokerage in one app.

*Relevance:* Telda for Phase 1 as mandated. Thndr is the natural second account
if US-market exposure is ever wanted. The dashboard is **broker-agnostic** — it
models accounts, so it can track both without redesign.

## Community sentiment (X / Reddit) — honest assessment

The mandate asks for authenticated community information. **Finding: it is thin.**
The feature is ~5 months old. Telda's official X account is
[@TeldaApp](https://x.com/teldaapp). App-store reviews surface complaints about
delayed rollouts ("will start soon"). No substantial, verifiable Reddit thread
comparing Telda vs Thndr investing was found.

**Deliberately not recorded here:** unsourced claims, influencer stock tips, or
anything that could not be traced to a named outlet or official account. Per
`CLAUDE.md` §1.1, absence of evidence is reported as absence, not filled with
plausible-sounding guesses.

## Sources

- [Egyptian Streets — Telda launches in-app securities trading (2026-03-31)](https://egyptianstreets.com/2026/03/31/telda-launches-in-app-securities-trading-and-fund-subscriptions-for-egypts-egx-investors/)
- [Zawya / Reuters via TradingView — Telda launches investment in stocks and funds (2026-03-29)](https://www.tradingview.com/news/reuters.com,2026-03-29:newsml_Zaw1RnCNC:0-zawya-telda-launches-investment-in-stocks-and-funds-through-its-app/)
- [Daily News Egypt — Telda launches in-app stock, fund investment service (2026-03-29)](https://www.dailynewsegypt.com/2026/03/29/telda-launches-in-app-stock-fund-investment-service/)
- [Enterprise AM — Telda moves into investing with zero-fee stock trading (2026-03-30)](https://enterpriseam.com/egypt/2026/03/30/telda-moves-into-investing-with-zero-fee-stock-trading/)
- [TechCabal — Beltone taps Telda to bring mutual funds to Egypt's digital investors (2026-06-15)](https://techcabal.com/2026/06/15/beltone-taps-fintech-telda-to-bring-mutual-funds-to-egypts-digital-investors/)
- [Lucidity Insights — Telda acquires brokerage firm City Capital](https://lucidityinsights.com/news/telda-acquires-city-capital)
- [WAYA — FRA approves licenses for Telda, Bokra, EGY Trend](https://waya.media/fra-approves-licenses-for-telda-bokra-egy-trend-true-finance-lease/)
- [Telda on the App Store](https://apps.apple.com/eg/app/telda/id1519608437) · [Google Play](https://play.google.com/store/apps/details?id=io.telda.app)
