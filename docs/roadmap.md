# Roadmap

Phase gates are the owner's rule: **nothing advances until the prior phase is
handled well** (`CLAUDE.md` §1.2).

## Phase 1 — Telda + EGX (current)

**Goal:** track every EGP with total accuracy.

- [x] Verify Telda's investing offering and constraints
- [x] Verify EGX costs, stamp duty, and tax treatment
- [x] Establish the macro hurdle rate
- [x] Money arithmetic in integer piastres
- [x] Cost engine (stamp duty, commission, fees)
- [x] Portfolio engine (weighted-average cost, realised/unrealised P&L)
- [x] Performance engine (XIRR, TWR, real returns, benchmark comparison)
- [x] Responsive dashboard UI
- [x] Local persistence + JSON export/import
- [ ] **Owner:** place one real trade, record the contract note, replace estimated fees
- [ ] Live price provider wired up (Yahoo adapter) once running locally
- [ ] CSV import of Telda statements (needs a real statement to design against)

### Research / screener (done)

- [x] Screener scoring engine — filter, factor-rank, weighted match score
- [x] Liquidity tiers and the dividend-vs-hurdle column
- [x] Sector-concentration flags against current holdings
- [x] Watchlist to shortlist candidates before committing money
- [x] Fundamentals provider (offline demo + best-effort live Yahoo)

## Phase 2 — Depth

- [ ] Dividend tracking with 5% WHT modelled
- [ ] Watchlist with price alerts
- [ ] USD-adjusted portfolio view (devaluation-aware)
- [ ] Multi-account support (Telda + any second broker, e.g. Thndr for US stocks)
- [ ] Monthly review report generation

## Phase 3 — Binance (GATED)

⛔ **Blocked by two gates:**
1. Phase 1 fully complete and in daily use.
2. **Legal review** — see `docs/research/05-crypto-egypt-legal.md`. Article 206 of
   Law 194/2020 prohibits crypto trading without CBE approval; penalties include
   imprisonment and fines of EGP 1–10M. This is a legal question, not a technical
   one, and must be resolved with an Egyptian lawyer first.

Scoped, if and when unblocked, as **read-only tracking first** — balance and
transaction import, never order execution. The data layer is already
exchange-agnostic, so this is an adapter, not a rewrite.

## Explicitly out of scope

- Automated/algorithmic order execution
- Anything requiring custody of credentials or funds
- Stock recommendations or signals — the dashboard measures decisions, it does
  not make them
