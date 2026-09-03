/**
 * Egyptian Exchange trading cost model.
 *
 * Every constant here cites a source and an effective date, per CLAUDE.md §4.
 * See docs/research/02-egx-costs-and-tax.md for the full evidence.
 */

import { type Money, ZERO, add, applyBps } from './money.ts';

/**
 * Stamp duty on EGX transactions.
 *
 * 0.5 per thousand (0.05% = 5 bps) of transaction value, charged to BOTH the
 * buyer and the seller, regardless of profit or loss.
 *
 * Source: MCDR implementation of the Law 151/2026 amendments.
 * Effective: settlements from 2026-08-03.
 * Verified: 2026-09-02.
 */
export const STAMP_DUTY_BPS = 5;

/**
 * Reduced stamp duty for same-day buy-and-sell (day trading): 0.25 per thousand
 * (0.025% = 2.5 bps) per side. Same source and effective date.
 */
export const STAMP_DUTY_SAME_DAY_BPS = 2.5;

/**
 * Telda's own brokerage commission.
 *
 * Advertised as zero commission and zero subscription at launch (2026-03-29).
 * Source: Telda launch announcement. Verified: 2026-09-02.
 */
export const TELDA_COMMISSION_BPS = 0;

/**
 * Other EGX / MCDR / FRA trading, clearing and settlement charges.
 *
 * ⚠️ UNVERIFIED ESTIMATE. Published schedules vary by instrument and change.
 * A single real contract note replaces this with an exact figure — see
 * docs/allocation-framework.md, Step 6.
 */
export const OTHER_FEES_BPS_ESTIMATE = 10;

/**
 * Withholding tax on dividends from EGX-listed companies, for residents: 5%.
 * Source: PwC Tax Summaries — Egypt. Verified: 2026-09-02.
 */
export const DIVIDEND_WHT_LISTED = 0.05;

export interface CostConfig {
  readonly commissionBps: number;
  readonly stampDutyBps: number;
  readonly otherFeesBps: number;
}

/** Default configuration: Telda on the EGX, with fees still estimated. */
export const TELDA_EGX: CostConfig = {
  commissionBps: TELDA_COMMISSION_BPS,
  stampDutyBps: STAMP_DUTY_BPS,
  otherFeesBps: OTHER_FEES_BPS_ESTIMATE,
};

/** Zero-cost config, for isolating cost effects in tests and what-ifs. */
export const NO_COSTS: CostConfig = {
  commissionBps: 0,
  stampDutyBps: 0,
  otherFeesBps: 0,
};

export interface CostBreakdown {
  readonly commission: Money;
  readonly stampDuty: Money;
  readonly otherFees: Money;
  readonly total: Money;
}

/** Cost of one leg of a trade on `grossValue`. */
export function tradeCosts(
  grossValue: Money,
  config: CostConfig = TELDA_EGX,
  options: { readonly sameDay?: boolean } = {},
): CostBreakdown {
  const dutyBps = options.sameDay ? STAMP_DUTY_SAME_DAY_BPS : config.stampDutyBps;

  const commission = applyBps(grossValue, config.commissionBps);
  const stampDuty = applyBps(grossValue, dutyBps);
  const otherFees = applyBps(grossValue, config.otherFeesBps);

  return {
    commission,
    stampDuty,
    otherFees,
    total: add(commission, stampDuty, otherFees),
  };
}

/**
 * Total cost of a full round trip (buy then sell) at the same value.
 *
 * The number that matters for turnover discipline: this is what every
 * round trip must overcome before it earns anything.
 */
export function roundTripCosts(
  grossValue: Money,
  config: CostConfig = TELDA_EGX,
  options: { readonly sameDay?: boolean } = {},
): Money {
  const leg = tradeCosts(grossValue, config, options);
  return add(leg.total, leg.total);
}

/**
 * Break-even price move, as a plain ratio, needed to cover a round trip.
 * `0.002` means the price must rise 0.2% before a trade breaks even.
 */
export function breakEvenMove(config: CostConfig = TELDA_EGX): number {
  const perLegBps = config.commissionBps + config.stampDutyBps + config.otherFeesBps;
  return (perLegBps * 2) / 10_000;
}

/** Net dividend after withholding, from a gross amount. */
export function netDividend(gross: Money, whtRate: number = DIVIDEND_WHT_LISTED): Money {
  const tax = applyBps(gross, whtRate * 10_000);
  return (gross - tax) as Money;
}

export { ZERO };
