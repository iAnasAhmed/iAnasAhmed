/** Core domain types. Pure data — no behaviour, no dependencies. */

import type { Money, Price } from './money.ts';

/** ISO calendar date, `YYYY-MM-DD`. */
export type IsoDate = string;

/** Stable identifier for a stored record. */
export type Id = string;

export type AssetClass =
  | 'equity'        // EGX-listed share
  | 'fund'          // mutual fund units (e.g. Beltone via Telda)
  | 'money_market'  // EGP money-market / fixed-income fund — the benchmark
  | 'cash';         // uninvested balance

export interface Instrument {
  /** Exchange ticker as shown by the broker, e.g. "COMI". */
  readonly symbol: string;
  readonly name: string;
  readonly assetClass: AssetClass;
  /** EGX sector, when known. Used for concentration analysis. */
  readonly sector?: string;
  /**
   * Annual yield for money-market instruments, as a plain ratio (0.22 = 22%).
   * Only meaningful for `money_market`.
   */
  readonly annualYield?: number;
}

export type TransactionKind =
  | 'buy'
  | 'sell'
  | 'dividend'   // cash dividend received (record the NET amount after 5% WHT)
  | 'deposit'    // cash into the investment account
  | 'withdrawal' // cash out of the investment account
  | 'fee';       // standalone charge not attached to a trade

export interface Transaction {
  readonly id: Id;
  readonly date: IsoDate;
  readonly kind: TransactionKind;
  /** Required for buy/sell/dividend. Omitted for deposits and withdrawals. */
  readonly symbol?: string;
  /** Share or unit count. Required for buy/sell. */
  readonly quantity?: number;
  /** Execution price per share. Required for buy/sell. */
  readonly price?: Price;
  /**
   * Cash amount. For buy/sell this is derived and stored for reconciliation;
   * for deposit/withdrawal/dividend/fee it is the primary figure.
   */
  readonly amount?: Money;
  /** Total costs charged on this transaction (commission + duty + fees). */
  readonly costs?: Money;
  readonly note?: string;
}

/** An aggregated position, computed — never stored. */
export interface Holding {
  readonly symbol: string;
  readonly instrument: Instrument;
  readonly quantity: number;
  /** Total cost basis of the shares still held, including buy costs. */
  readonly costBasis: Money;
  /** costBasis / quantity, as a Price. */
  readonly averageCost: Price;
  /** Latest known price, when a quote is available. */
  readonly lastPrice?: Price;
  readonly marketValue: Money;
  readonly unrealisedPnl: Money;
  /** unrealisedPnl / costBasis. */
  readonly unrealisedPnlPct: number;
  /** Realised P&L from sales of this symbol, net of costs. */
  readonly realisedPnl: Money;
  /** Dividends received, net of withholding. */
  readonly dividends: Money;
  /** All costs ever paid on this symbol. */
  readonly totalCosts: Money;
  /** Share of total portfolio market value, 0–1. */
  readonly weight: number;
}

export interface PortfolioSummary {
  readonly cash: Money;
  readonly invested: Money;        // market value of holdings
  readonly totalValue: Money;      // cash + invested
  readonly costBasis: Money;
  readonly unrealisedPnl: Money;
  readonly realisedPnl: Money;
  readonly dividends: Money;
  readonly totalCosts: Money;
  /** Total P&L including realised, unrealised, dividends, net of costs. */
  readonly totalPnl: Money;
  /** Net capital the owner has put in (deposits - withdrawals). */
  readonly netContributions: Money;
  /** totalPnl / netContributions — simple return on money put in. */
  readonly totalReturnPct: number;
  readonly holdings: readonly Holding[];
}

export type Quote = {
  readonly symbol: string;
  readonly price: Price;
  /** Previous close, for the day-change figure. */
  readonly previousClose?: Price;
  /** ISO timestamp of the quote. */
  readonly asOf: string;
};
