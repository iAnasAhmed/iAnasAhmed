# EGX trading costs & tax — verified

**Last verified:** 2026-09-02 · These constants drive `src/core/costs.ts`.

## The headline that matters most

> **Capital gains on EGX-listed securities are EXEMPT from income tax.**

Confirmed by the Egyptian Tax Authority (July 2026) under the income-tax
amendments of **Law No. 151 of 2026**, effective **29 July 2026**. Listed-share
capital gains are subject only to proportional **stamp duty**.

This is unusually favourable and materially changes the maths: gains compound
untaxed. Unlisted shares are *not* exempt (progressive PIT up to 27.5%).

## Stamp duty — the cost that replaced capital gains tax

Effective for settlements from **3 August 2026**, MCDR withholds stamp duty on
EGX trades:

| Transaction | Rate per side | Who pays |
|---|---|---|
| Standard buy or sell | **0.05%** (0.5 per thousand) | **Both** buyer and seller |
| Same-day buy *and* sell (day trade) | **0.025%** (0.25 per thousand) | Both sides |

**Critical properties:**
- Charged **regardless of profit or loss** — it is a transaction tax, not a gains tax.
- Charged on **both legs**, so a full round trip costs ~**0.10%** of value.
- Market makers and listed investment instruments are exempt.

## Dividend withholding tax

| Issuer | Resident individual WHT |
|---|---|
| **EGX-listed** company | **5%** |
| Unlisted company | 10% |

Dividends are withheld at source — the dashboard must model dividends **net**.

## Other regulatory charges

EGX/MCDR/FRA levy small trading, clearing, and settlement fees. Published
schedules vary by instrument and change periodically. **Not hard-coded as
verified.** `costs.ts` exposes them as a configurable `otherFeesBps` defaulting
to a conservative estimate, flagged `UNVERIFIED`.

> **Owner action:** after your first real Telda trade, read the contract note and
> replace the estimate with observed values. One trade removes all uncertainty.

## Total round-trip cost estimate

With Telda's zero commission, a buy-then-sell round trip costs roughly:

```
stamp duty  0.05% (buy) + 0.05% (sell)      = 0.10%
other regulatory fees (estimate, unverified) ≈ 0.05–0.15%
------------------------------------------------------
total round trip                             ≈ 0.15–0.25%
```

**Implication:** costs are low but *per trade*. Frequent trading compounds them
against you while the tax code rewards holding (gains untaxed). The cost
structure favours **low turnover**.

## Sources

- [Daily News Egypt — Capital gains on EGX-listed securities exempt from income tax (2026-07-26)](https://www.dailynewsegypt.com/2026/07/26/capital-gains-on-egx-listed-securities-exempt-from-income-tax-subject-only-to-proportional-stamp-duty-eta-chief/)
- [Arab Finance — MCDR begins implementing stamp duty withholding on EGX trades](https://www.arabfinance.com/en/news/newdetails/mcdr-begins-implementing-stamp-duty-withholding-on-egx-trades-after-tax-law-amendments)
- [Zawya — MCDR begins implementing stamp duty withholding](https://www.zawya.com/en/economy/north-africa/mcdr-begins-implementing-stamp-duty-withholding-on-the-egyptian-exchange-trades-after-tax-law-amendments-418042)
- [PwC Tax Summaries — Egypt, individual income determination](https://taxsummaries.pwc.com/egypt/individual/income-determination)
- [PwC Tax Summaries — Egypt, withholding taxes](https://taxsummaries.pwc.com/egypt/corporate/withholding-taxes)
- [RegFollower — Egypt updates income tax law (Law 151 of 2026)](https://regfollower.com/egypt-updates-income-tax-law-with-capital-gains-listing-changes/)
