# CLAUDE.md — Telda Investing Tracker

> **This file is the project's constitution.** Every session, every agent, every
> contributor reads this first. It encodes the owner's intent verbatim so the
> project never drifts.

---

## 1. The owner's mandate (verbatim intent)

Anas Ahmed's words, recorded as standing instruction for this repository:

> Work on the **Telda investing section**. Start investing in **stocks**. Find all
> the well-known, **authenticated** information — especially on **X** and
> **Reddit**, and every other network — and **always verify it first**. Build a
> **dashboard to track everything**. Start with the **Egyptian market** if Telda
> supports it; if not, cover all markets. Reach the next milestone only **after
> handling everything well in Telda**. Then work on **Binance**. Main capital is
> about **30,000 EGP** — determine the good amount to start with and where, and
> **track it all**. Choose the **fastest, cleanest, most organized** languages.
> Build a **perfect, responsive UI**. This is a **web application**.

### Binding rules derived from that mandate

1. **Verify before you state.** No fact about Telda, the EGX, fees, taxes, or
   market data enters this repo without a dated, linked source. Unverified claims
   are marked `UNVERIFIED` or omitted. See `docs/research/`.
2. **Telda first.** Phase 1 is Telda + EGX, completed properly. No Binance or
   crypto work begins until Phase 1 is done. See `docs/roadmap.md`.
3. **Track everything.** Every EGP in and out is representable: buys, sells,
   dividends, fees, stamp duty, cash, fund subscriptions/redemptions.
4. **Accuracy over convenience.** Money is integer arithmetic. Never floats.
5. **Responsive, always.** Mobile-first. The dashboard must be fully usable on a
   phone — that is where it will actually be read.
6. **Not financial advice.** This project produces tools and frameworks, never
   personalised recommendations. Frameworks are educational; the owner decides.
7. **The owner's money is real.** Bugs here cost EGP. Test the maths.

---

## 2. Stack — chosen, and why

**TypeScript everywhere. Zero runtime dependencies.**

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript 6, `strict` | One language front to back; types catch money bugs |
| Domain core | Pure TS, no imports | Portable, testable, framework-agnostic |
| Tests | `node:test` + `node:assert` | Built into Node 22 — no test framework to install |
| Build | `tsc` only | No bundler, no config sprawl |
| Frontend | Native ES modules + DOM | Loads instantly, no hydration, no framework tax |
| Styling | Hand-authored CSS with custom properties | Full control, no utility-class build step |
| Charts | Hand-rolled inline SVG | No chart library; exact control; tiny |
| Storage | `localStorage` + JSON import/export | Private by default — financial data never leaves the device |
| Server | Node stdlib static server | `npm start` works with nothing installed |

**Non-negotiable:** the app must run with **zero `npm install`**. If a dependency
ever becomes genuinely necessary, it must be justified in a PR description
against this rule.

**Migration path:** `src/core/` and `src/data/` are pure TypeScript with no DOM or
Node APIs. They drop into Next.js, React Native, or a Cloudflare Worker unchanged
if the project ever outgrows the zero-dependency constraint.

---

## 3. Architecture

```
src/
  core/     Pure domain. No DOM, no fetch, no Node APIs. 100% unit-tested.
            money.ts        integer piastre arithmetic
            types.ts        Transaction, Holding, Instrument, Lot
            costs.ts        EGX stamp duty + commission modelling
            portfolio.ts    holdings, weighted-average cost, realised/unrealised P&L
            performance.ts  XIRR, time-weighted return, drawdown
  data/     Market-data providers behind one interface. Swappable, offline-capable.
  web/      UI only. Renders what core computes. Contains no business logic.
```

**The dependency rule:** `web/` → `data/` → `core/`. Never the reverse.
`core/` imports nothing. If a calculation lives in `web/`, it is in the wrong place.

---

## 4. Conventions

- **Money:** integer **piastres** (1 EGP = 100 pt). Prices are integer
  **millipiastres** (3 dp) because EGX quotes to 3 decimals. Never `number` EGP.
- **Dates:** ISO `YYYY-MM-DD` strings. EGX trades Sun–Thu, 10:00–14:15 EET.
- **Naming:** `camelCase` values, `PascalCase` types, `SCREAMING_SNAKE` constants.
- **Files:** one concern per file; colocate `x.test.ts` beside `x.ts`.
- **Comments:** explain *why*, never *what*. Cite sources for any magic number.
- **Every rate, fee, or tax constant** carries a source comment and an effective date.
- **No TypeScript-only runtime syntax.** Tests run under Node's type-stripping,
  which erases types but cannot *transform* code. So: no `enum`, no constructor
  parameter properties (`constructor(private x: T)`), no decorators, no
  namespaces. Declare fields explicitly and assign them in the constructor.

## 5. Commands

```bash
npm test        # node:test over src/**/*.test.ts
npm run check   # tsc --noEmit, strict typecheck
npm run build   # tsc -> dist/
npm start       # build + serve on :3000
```

## 6. Definition of done

A change is done when: `npm run check` passes, `npm test` passes, new maths has
tests covering the edge cases, the UI was verified at 375px and 1440px, and any
new financial constant cites its source with an effective date.
