# Starting allocation framework — 30,000 EGP

**Not financial advice.** This is a decision *framework* with the arithmetic made
explicit, so the owner can decide with clear eyes. Numbers are illustrative.
All rates as verified 2026-09-02 (`docs/research/03-macro-context.md`).

---

## Step 0 — The question behind the question

"How much should I start with?" has a precise answer for a first-time investor,
and it is **not** a percentage of net worth. It is:

> **The amount whose total loss would not change any decision in your life,
> and whose daily fluctuation you can watch without acting on it.**

For a first EGX position that number is usually **much smaller than people
expect** — and that is fine, because the first year's real return is *education*,
not profit.

## Step 1 — Reserve what is not investable

Before any allocation, subtract:

| Bucket | Purpose | Where it belongs |
|---|---|---|
| **Emergency fund** | 3–6 months of expenses | Bank savings / money-market fund — **never** stocks |
| **Known near-term spending** | Anything needed within 12 months | Same. Money needed soon must not carry market risk |

**Only what remains is investable capital.** If 30,000 EGP *is* the emergency
fund, then the honest answer is that the investable amount is near zero, and the
correct first move is to keep building the reserve. That is not a failure — it is
the highest-return financial decision available.

## Step 2 — The hurdle rate changes everything

This is the single most important fact for an Egyptian investor right now:

```
EGP money-market fund / T-bills   ≈ 20–25% nominal, effectively risk-free
Inflation                         ≈ 16–17%
Real risk-free return             ≈ +6 to +9%
```

**Doing nothing clever earns roughly 22%.** So:

> Every stock you buy must be expected to beat **~22% per year**,
> or you have made a worse decision than the default.

In most countries the risk-free rate is ~0–5% and any equity exposure looks
attractive. **In Egypt in 2026 the bar is genuinely high.** Telda's fund
subscriptions make the money-market option reachable inside the same app.

## Step 3 — A worked structure

Illustrative split of **investable** capital (assume the full 30,000 is
investable and the emergency fund exists separately):

| Sleeve | Share | Amount | Instrument | Purpose |
|---|---|---|---|---|
| **Core — the hurdle** | 70% | 21,000 | EGP money-market / fixed-income fund | Earns ~22% while you learn. This is the benchmark you must beat. |
| **Learning sleeve** | 20% | 6,000 | 2–3 large, liquid EGX names | Real skin in the game. Small enough that mistakes are tuition. |
| **Reserve / opportunity** | 10% | 3,000 | Cash in Telda | Dry powder; avoids forced selling |

**Why the learning sleeve is small.** Beginner returns in year one are dominated
by behavioural error — overtrading, panic-selling, position sizing. Paying that
tuition on 6,000 EGP instead of 30,000 costs ~5× less for the identical lesson.

**Concrete rule of thumb:** start the equity sleeve at **10–20% of investable
capital**, and only increase it after **two full quarters** of tracked decisions
in this dashboard showing you beat the money-market benchmark *after costs*.

## Step 4 — Position sizing inside the learning sleeve

With ~6,000 EGP in equities:

- **2–3 positions maximum.** More than that on a small base is unmanageable and
  each position becomes too small for costs to make sense.
- **No single position above ~40%** of the sleeve (~2,400 EGP).
- **Liquidity first.** Only names with real daily volume — thin stocks have wide
  spreads that quietly cost more than every fee combined.
- **No leverage. No margin. No day trading.** Day trading halves stamp duty per
  side but multiplies total cost through turnover, and the tax code rewards
  holding (capital gains untaxed).

## Step 5 — What to actually measure

The dashboard exists to answer these, honestly, every month:

1. **Am I beating the money-market benchmark, after all costs?**
   If not for two consecutive quarters, the rational move is to shift the
   learning sleeve back to the core. This is the single most valuable number the
   dashboard produces, and it is deliberately unflattering.
2. **What is my real (inflation-adjusted) return?** Nominal 18% during 16%
   inflation is ~2% real. The dashboard shows real returns so nominal gains never
   flatter the picture.
3. **What has turnover cost me?** Every trade is ~0.05% stamp duty per side plus
   spread. The dashboard totals this so the cost of activity is visible.
4. **Is any position oversized** relative to the rules above?

## Step 6 — Sequencing (first 90 days)

| When | Action |
|---|---|
| Week 1 | Open the Telda investment account. Deposit a **small** amount only. |
| Week 1 | Place **one** minimal trade. **Record the exact contract note** — this replaces the estimated fees in `src/core/costs.ts` with real ones. |
| Week 2 | Move the core sleeve into the money-market fund so it starts earning. |
| Weeks 2–4 | Log every transaction in the dashboard. Build the habit before adding capital. |
| Month 2–3 | Add the learning sleeve gradually, not in one lump. |
| Month 3 | First honest review against the benchmark. |

## The uncomfortable summary

- The **default option pays ~22% risk-free**. It is genuinely hard to beat.
- Therefore start the equity portion **small** — 10–20% of investable capital.
- The first year's job is to **build tracked evidence** that your decisions add
  value. If they do, scale up with confidence. If not, you have saved yourself a
  great deal of money and learned it cheaply.
- **The dashboard is the point.** Untracked investing is indistinguishable from
  gambling, because you cannot tell skill from luck without a record.
