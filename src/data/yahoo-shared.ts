/**
 * Shared Yahoo Finance parsing for the live data path.
 *
 * Both the price provider and the fundamentals provider read from Yahoo's v7
 * `quote` endpoint, batched: one request returns price, previous close, market
 * cap, P/E, P/B, dividend yield, 52-week change, and average volume for many
 * symbols at once. The browser calls it through the local server proxy
 * (`/api/quotes`), which handles Yahoo's crumb/cookie auth — see scripts/yahoo.mjs.
 *
 * Parsing is defensive: missing or malformed fields are simply absent, so a
 * partial payload still yields whatever it does contain. EGX coverage on Yahoo
 * is uneven, so partial is the normal case, not the exception.
 */

export interface YahooRow {
  /** Vendor symbol as returned (e.g. "COMI.CA"). */
  readonly symbol: string;
  readonly price?: number;          // EGP
  readonly previousClose?: number;  // EGP
  readonly marketCap?: number;      // EGP
  readonly peRatio?: number;
  readonly pbRatio?: number;
  readonly dividendYield?: number;  // ratio, 0.043 = 4.3%
  readonly yearChange?: number;     // ratio, 0.45 = +45%
  readonly avgDailyValue?: number;  // EGP/day (volume × price)
}

export interface YahooFetchOptions {
  /** Endpoint that returns a Yahoo v7 quote payload. Default '/api/quotes'. */
  readonly endpoint?: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Parse a Yahoo v7 `quote` response into rows, skipping anything unusable. */
export function parseYahooQuoteJson(json: unknown): YahooRow[] {
  const result = (json as { quoteResponse?: { result?: unknown } })?.quoteResponse?.result;
  if (!Array.isArray(result)) return [];
  return result
    .map((row) => parseRow(row as Record<string, unknown>))
    .filter((row): row is YahooRow => row !== undefined);
}

function parseRow(q: Record<string, unknown>): YahooRow | undefined {
  const symbol = typeof q['symbol'] === 'string' ? q['symbol'] : undefined;
  if (!symbol) return undefined;

  const price = num(q['regularMarketPrice']);

  // Dividend yield: prefer the ratio field; the percent field needs /100.
  let dividendYield = num(q['trailingAnnualDividendYield']);
  if (dividendYield === undefined) {
    const dy = num(q['dividendYield']);
    if (dy !== undefined) dividendYield = dy > 1 ? dy / 100 : dy;
  }

  // 52-week change: a ratio if present, else the percent field / 100.
  let yearChange = num(q['fiftyTwoWeekChange']);
  if (yearChange === undefined) {
    const pct = num(q['fiftyTwoWeekChangePercent']);
    if (pct !== undefined) yearChange = pct / 100;
  }

  // Liquidity as traded value ≈ average share volume × price.
  const volume = num(q['averageDailyVolume3Month']) ?? num(q['averageDailyVolume10Day']);
  const avgDailyValue = volume !== undefined && price !== undefined ? volume * price : undefined;

  const previousClose = num(q['regularMarketPreviousClose']);
  const marketCap = num(q['marketCap']);
  const peRatio = num(q['trailingPE']);
  const pbRatio = num(q['priceToBook']);

  const row: YahooRow = {
    symbol,
    ...(price !== undefined && price >= 0 ? { price } : {}),
    ...(previousClose !== undefined ? { previousClose } : {}),
    ...(marketCap !== undefined ? { marketCap } : {}),
    ...(peRatio !== undefined ? { peRatio } : {}),
    ...(pbRatio !== undefined ? { pbRatio } : {}),
    ...(dividendYield !== undefined ? { dividendYield } : {}),
    ...(yearChange !== undefined ? { yearChange } : {}),
    ...(avgDailyValue !== undefined ? { avgDailyValue } : {}),
  };
  return row;
}

/**
 * Fetch and parse Yahoo quotes for a batch of vendor symbols.
 *
 * Never throws: any network or shape failure yields an empty array, so a dead
 * source degrades gracefully instead of breaking the page.
 */
export async function fetchYahooQuotes(
  vendorSymbols: readonly string[],
  options: YahooFetchOptions = {},
): Promise<YahooRow[]> {
  if (vendorSymbols.length === 0) return [];

  const endpoint = options.endpoint ?? '/api/quotes';
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 8_000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `${endpoint}?symbols=${encodeURIComponent(vendorSymbols.join(','))}`;
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) return [];
    return parseYahooQuoteJson(await response.json());
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}
