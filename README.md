# Telda Investing Tracker

A portfolio dashboard for investing on the **Egyptian Exchange (EGX) through
Telda** — built to answer one question honestly:

> **Is picking stocks actually beating an EGP money-market fund?**

In Egypt that question has teeth. Risk-free EGP instruments currently yield
**~20–25%**, so a "+18% year" is a *loss* against doing nothing. This dashboard
is built around that comparison and is deliberately unflattering about it.

<!-- Screenshots: run `npm start` and see it yourself — no data leaves your machine. -->

## Why this exists

Telda [launched EGX stock and fund investing on 29 March 2026](https://www.dailynewsegypt.com/2026/03/29/telda-launches-in-app-stock-fund-investment-service/)
with zero commission — but **no public API and no export**. So the app is
manual-entry-first: you log transactions, it does the maths exactly.

## What it does

- **Tracks everything** — buys, sells, dividends, fees, stamp duty, cash,
  deposits, withdrawals. Every EGP is accounted for.
- **Benchmarks you against doing nothing** — XIRR vs. an EGP money-market fund,
  with the shortfall shown in EGP, not just percent.
- **Shows real returns** — inflation-adjusted, using the exact Fisher relation.
- **Models EGX costs correctly** — 0.05% stamp duty per side, 5% dividend
  withholding, Telda's zero commission.
- **Flags concentration** — oversized *equity* positions only; the money-market
  core is exempt by design.
- **Works offline** — demo price provider by default; live quotes optional.
- **Keeps your data private** — `localStorage` only. No account, no server, no
  telemetry. Explicit JSON export/import.

## Live market data (optional)

The app ships offline-first (demo prices and demo fundamentals). To use **real
EGX data**:

1. Run the app with `npm start` — the bundled server includes the data proxy.
2. In **Settings → Price source**, choose *Yahoo Finance (live)*.
3. In **Research → Data source**, choose *Yahoo Finance (live)* for the screener.

No API key is needed. Yahoo's quote endpoints require a crumb + cookie, which
the local proxy fetches and refreshes for you (`scripts/yahoo.mjs`); the browser
only ever talks to `localhost`. Prices also have a crumbless fallback (Yahoo's
chart endpoint), so the portfolio keeps working even if the batch path hiccups.

**Caveat:** Yahoo's coverage of EGX (`.CA`) tickers is uneven — some names come
back with only part of their fundamentals, or none. Missing figures are handled
gracefully (they score neutrally in the screener). For complete, reliable EGX
fundamentals, a keyed provider (Twelve Data, EODHD) is the next step; the
provider interface is already in place for it.

## Quick start

Requires **Node 22.6+**. That is the only requirement.

```bash
npm start          # build + serve at http://localhost:3000
```

Then open <http://localhost:3000/#demo> to see it populated with an example
portfolio built to the framework in [`docs/allocation-framework.md`](docs/allocation-framework.md).

```bash
npm run verify     # typecheck + full test suite
npm test           # 105 tests, node:test
npm run check      # tsc --noEmit, strict
```

**There is no `npm install`.** Zero runtime and zero build dependencies — see
[`CLAUDE.md`](CLAUDE.md) §2 for why, and for the migration path if that ever
stops being the right call.

## Documentation

| Document | What it covers |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Project constitution — the owner's mandate and binding rules |
| [`docs/allocation-framework.md`](docs/allocation-framework.md) | How to size a first position on ~30,000 EGP |
| [`docs/roadmap.md`](docs/roadmap.md) | Phase gates: Telda → depth → Binance |
| [`docs/research/01-telda-investing.md`](docs/research/01-telda-investing.md) | What Telda actually offers, verified |
| [`docs/research/02-egx-costs-and-tax.md`](docs/research/02-egx-costs-and-tax.md) | Stamp duty, capital gains, dividend WHT |
| [`docs/research/03-macro-context.md`](docs/research/03-macro-context.md) | Rates, inflation, and the hurdle rate |
| [`docs/research/04-data-providers.md`](docs/research/04-data-providers.md) | Market-data options and their trade-offs |
| [`docs/research/05-crypto-egypt-legal.md`](docs/research/05-crypto-egypt-legal.md) | ⛔ Why the Binance phase is legally gated |

Every factual claim carries a dated, linked source. Anything unverified is
labelled `UNVERIFIED` rather than asserted.

## Architecture

```
src/
  core/   Pure domain. Zero imports, 100% tested. Money is integer piastres.
  data/   Market-data providers behind one swappable interface.
  web/    UI only. Renders what core computes; contains no business logic.
```

The dependency rule is one-way: `web/` → `data/` → `core/`.
`core/` and `data/` are portable — they drop into Next.js or a Worker unchanged.

## Accuracy

Money is **integer piastres**; prices are **integer milli-EGP** (EGX quotes to
3 dp). No floats touch a balance. The test suite covers the edge cases that
actually cost money: partial sells, overselling, cost capitalisation, dividend
withholding, and the accounting identity `value = contributions + P&L`.

Cost constants are modelled from published regulatory rates and are marked as
estimates where unverified. **After your first real trade, put the contract-note
figures into `src/core/costs.ts`** — one trade removes all the uncertainty.

## Not financial advice

This is a measurement tool. It tracks decisions; it does not make them. Nothing
here is a recommendation to buy or sell any security. Verify all figures against
your real Telda statements.
