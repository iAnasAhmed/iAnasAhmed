/**
 * Portfolio computation.
 *
 * Holdings are always DERIVED from the transaction log, never stored. The
 * transaction log is the single source of truth, so the portfolio can always be
 * rebuilt and reconciled against a broker statement.
 *
 * Cost basis uses the weighted-average-cost (WAC) method, which is what
 * Egyptian brokers report and what the (exempt) capital-gains treatment aligns
 * with. Buy-side costs are capitalised into the basis; sell-side costs reduce
 * proceeds. Both therefore flow correctly into realised P&L.
 */

import {
  type Money, type Price, ZERO, add, sub, valueOf, ratio, egp,
} from './money.ts';
import type {
  Holding, Instrument, PortfolioSummary, Quote, Transaction,
} from './types.ts';
import { tradeCosts, type CostConfig, TELDA_EGX } from './costs.ts';

/** Mutable accumulator used while folding the transaction log. */
interface Position {
  quantity: number;
  costBasis: Money;
  realisedPnl: Money;
  dividends: Money;
  totalCosts: Money;
}

function emptyPosition(): Position {
  return {
    quantity: 0,
    costBasis: ZERO,
    realisedPnl: ZERO,
    dividends: ZERO,
    totalCosts: ZERO,
  };
}

/** Chronological order, with a stable tie-break so results are deterministic. */
export function sortTransactions(txs: readonly Transaction[]): Transaction[] {
  return [...txs].sort((a, b) =>
    a.date === b.date ? a.id.localeCompare(b.id) : a.date.localeCompare(b.date),
  );
}

/** Gross value of a trade leg, from quantity and price. */
export function grossValue(tx: Transaction): Money {
  if (tx.quantity === undefined || tx.price === undefined) return ZERO;
  return valueOf(tx.quantity, tx.price);
}

/**
 * Costs charged on a transaction: the recorded figure when the owner has
 * entered the real one from a contract note, otherwise the modelled estimate.
 *
 * Recorded values always win — reality beats the model.
 */
export function costsFor(tx: Transaction, config: CostConfig = TELDA_EGX): Money {
  if (tx.costs !== undefined) return tx.costs;
  if (tx.kind === 'buy' || tx.kind === 'sell') {
    return tradeCosts(grossValue(tx), config).total;
  }
  return ZERO;
}

export interface BuildOptions {
  readonly costConfig?: CostConfig;
  /** Latest quotes by symbol. Missing quotes fall back to average cost. */
  readonly quotes?: ReadonlyMap<string, Quote>;
  /** Instrument metadata by symbol. */
  readonly instruments?: ReadonlyMap<string, Instrument>;
}

function instrumentFor(
  symbol: string,
  instruments: ReadonlyMap<string, Instrument> | undefined,
): Instrument {
  return (
    instruments?.get(symbol) ?? {
      symbol,
      name: symbol,
      assetClass: 'equity',
    }
  );
}

/**
 * Fold the transaction log into a complete portfolio snapshot.
 *
 * Pure and total: any transaction list produces a valid summary. Sells beyond
 * the held quantity are clamped rather than throwing, so a typo in the log
 * never crashes the dashboard — it shows an obviously wrong number instead,
 * which is easier to spot and fix.
 */
export function buildPortfolio(
  transactions: readonly Transaction[],
  options: BuildOptions = {},
): PortfolioSummary {
  const config = options.costConfig ?? TELDA_EGX;
  const positions = new Map<string, Position>();

  let cash = ZERO;
  let deposits = ZERO;
  let withdrawals = ZERO;
  let totalRealised = ZERO;
  let totalDividends = ZERO;
  let totalCosts = ZERO;

  const positionFor = (symbol: string): Position => {
    let p = positions.get(symbol);
    if (!p) {
      p = emptyPosition();
      positions.set(symbol, p);
    }
    return p;
  };

  for (const tx of sortTransactions(transactions)) {
    let costs = costsFor(tx, config);

    switch (tx.kind) {
      case 'deposit': {
        const amount = tx.amount ?? ZERO;
        cash = add(cash, amount);
        deposits = add(deposits, amount);
        break;
      }

      case 'withdrawal': {
        const amount = tx.amount ?? ZERO;
        cash = sub(cash, amount);
        withdrawals = add(withdrawals, amount);
        break;
      }

      case 'buy': {
        if (!tx.symbol || tx.quantity === undefined) break;
        const gross = grossValue(tx);
        const position = positionFor(tx.symbol);

        // Buy costs are capitalised into the basis.
        position.quantity += tx.quantity;
        position.costBasis = add(position.costBasis, gross, costs);
        position.totalCosts = add(position.totalCosts, costs);

        cash = sub(cash, add(gross, costs));
        totalCosts = add(totalCosts, costs);
        break;
      }

      case 'sell': {
        if (!tx.symbol || tx.quantity === undefined) break;
        const position = positionFor(tx.symbol);

        // Clamp to what is actually held; never sell into a negative position.
        // Proceeds and costs must both follow the CLAMPED quantity — using the
        // requested quantity here would book proceeds for shares never owned.
        const sold = Math.min(tx.quantity, position.quantity);
        const gross = tx.price === undefined ? ZERO : valueOf(sold, tx.price);
        const fraction = position.quantity > 0 ? sold / position.quantity : 0;

        // Proportional share of basis leaves with the shares sold.
        // Recompute modelled costs on the clamped gross; a recorded real cost
        // from a contract note always wins.
        if (tx.costs === undefined) costs = tradeCosts(gross, config).total;

        const basisSold = Math.round(position.costBasis * fraction) as Money;
        const netProceeds = sub(gross, costs);

        position.realisedPnl = add(position.realisedPnl, sub(netProceeds, basisSold));
        position.costBasis = sub(position.costBasis, basisSold);
        position.quantity -= sold;
        position.totalCosts = add(position.totalCosts, costs);

        // Floating-point residue on a fully closed position would otherwise
        // leave a few stray piastres of basis behind.
        if (position.quantity <= 1e-9) {
          position.quantity = 0;
          position.costBasis = ZERO;
        }

        cash = add(cash, netProceeds);
        totalRealised = add(totalRealised, sub(netProceeds, basisSold));
        totalCosts = add(totalCosts, costs);
        break;
      }

      case 'dividend': {
        const amount = tx.amount ?? ZERO;
        if (tx.symbol) {
          const position = positionFor(tx.symbol);
          position.dividends = add(position.dividends, amount);
        }
        cash = add(cash, amount);
        totalDividends = add(totalDividends, amount);
        break;
      }

      case 'fee': {
        const amount = tx.amount ?? ZERO;
        if (tx.symbol) {
          const position = positionFor(tx.symbol);
          position.totalCosts = add(position.totalCosts, amount);
        }
        cash = sub(cash, amount);
        totalCosts = add(totalCosts, amount);
        break;
      }
    }
  }

  // ---- Materialise holdings ------------------------------------------------

  const open: { symbol: string; position: Position; marketValue: Money; lastPrice?: Price }[] = [];

  for (const [symbol, position] of positions) {
    if (position.quantity <= 0) continue;

    const averageCostMills = Math.round((position.costBasis * 10) / position.quantity);
    const quote = options.quotes?.get(symbol);
    const lastPrice = quote?.price ?? (averageCostMills as Price);
    const marketValue = valueOf(position.quantity, lastPrice);

    open.push(
      quote
        ? { symbol, position, marketValue, lastPrice }
        : { symbol, position, marketValue },
    );
  }

  const invested = add(...open.map((o) => o.marketValue));

  const holdings: Holding[] = open
    .map(({ symbol, position, marketValue, lastPrice }) => {
      const averageCost = Math.round((position.costBasis * 10) / position.quantity) as Price;
      const unrealisedPnl = sub(marketValue, position.costBasis);

      const base = {
        symbol,
        instrument: instrumentFor(symbol, options.instruments),
        quantity: position.quantity,
        costBasis: position.costBasis,
        averageCost,
        marketValue,
        unrealisedPnl,
        unrealisedPnlPct: ratio(unrealisedPnl, position.costBasis),
        realisedPnl: position.realisedPnl,
        dividends: position.dividends,
        totalCosts: position.totalCosts,
        weight: ratio(marketValue, invested),
      };

      return lastPrice === undefined ? base : { ...base, lastPrice };
    })
    .sort((a, b) => b.marketValue - a.marketValue);

  const costBasis = add(...holdings.map((h) => h.costBasis));
  const unrealisedPnl = add(...holdings.map((h) => h.unrealisedPnl));
  const totalValue = add(cash, invested);
  const netContributions = sub(deposits, withdrawals);
  const totalPnl = add(unrealisedPnl, totalRealised, totalDividends);

  return {
    cash,
    invested,
    totalValue,
    costBasis,
    unrealisedPnl,
    realisedPnl: totalRealised,
    dividends: totalDividends,
    totalCosts,
    totalPnl,
    netContributions,
    totalReturnPct: ratio(totalPnl, netContributions),
    holdings,
  };
}

/** Concentration check against the framework's position-size rules. */
export interface ConcentrationWarning {
  readonly symbol: string;
  readonly weight: number;
  readonly limit: number;
}

/**
 * Flag oversized *risk* positions. Default 40%, matching
 * docs/allocation-framework.md Step 4.
 *
 * Money-market and cash holdings are excluded deliberately: the framework wants
 * the core sleeve to be ~70%, so warning about it would train the owner to
 * ignore the warning that matters.
 */
export function concentrationWarnings(
  summary: PortfolioSummary,
  limit = 0.4,
): ConcentrationWarning[] {
  return summary.holdings
    .filter((h) => h.instrument.assetClass !== 'money_market' && h.instrument.assetClass !== 'cash')
    .filter((h) => h.weight > limit)
    .map((h) => ({ symbol: h.symbol, weight: h.weight, limit }));
}

/** Total value grouped by asset class — the allocation view. */
export function allocationByClass(summary: PortfolioSummary): Map<string, Money> {
  const buckets = new Map<string, Money>();
  const bump = (key: string, amount: Money): void => {
    buckets.set(key, add(buckets.get(key) ?? ZERO, amount));
  };

  for (const h of summary.holdings) bump(h.instrument.assetClass, h.marketValue);
  if (summary.cash > 0) bump('cash', summary.cash);

  return buckets;
}

export { egp };
