import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseYahooQuoteJson, fetchYahooQuotes } from './yahoo-shared.ts';

const v7 = (rows: unknown[]) => ({ quoteResponse: { result: rows } });

test('parses a full v7 quote row', () => {
  const [row] = parseYahooQuoteJson(v7([{
    symbol: 'COMI.CA',
    regularMarketPrice: 138.11,
    regularMarketPreviousClose: 137.0,
    marketCap: 471_750_000_000,
    trailingPE: 6.0,
    priceToBook: 1.6,
    trailingAnnualDividendYield: 0.043,
    fiftyTwoWeekChangePercent: 45.0,
    averageDailyVolume3Month: 4_000_000,
  }]));
  assert.equal(row!.symbol, 'COMI.CA');
  assert.equal(row!.price, 138.11);
  assert.equal(row!.previousClose, 137.0);
  assert.equal(row!.marketCap, 471_750_000_000);
  assert.equal(row!.peRatio, 6.0);
  assert.equal(row!.pbRatio, 1.6);
  assert.equal(row!.dividendYield, 0.043);
  assert.equal(row!.yearChange, 0.45); // percent field converted to a ratio
  assert.equal(row!.avgDailyValue, 4_000_000 * 138.11); // volume × price
});

test('a percent dividend-yield field is converted to a ratio', () => {
  const [row] = parseYahooQuoteJson(v7([
    { symbol: 'X.CA', regularMarketPrice: 10, dividendYield: 8.5 }, // percent
  ]));
  assert.equal(row!.dividendYield, 0.085);
});

test('a ratio dividend-yield below 1 is left as-is', () => {
  const [row] = parseYahooQuoteJson(v7([
    { symbol: 'X.CA', regularMarketPrice: 10, dividendYield: 0.06 },
  ]));
  assert.equal(row!.dividendYield, 0.06);
});

test('missing fields are simply absent', () => {
  const [row] = parseYahooQuoteJson(v7([{ symbol: 'Y.CA', regularMarketPrice: 20 }]));
  assert.equal(row!.price, 20);
  assert.equal(row!.peRatio, undefined);
  assert.equal(row!.dividendYield, undefined);
  assert.equal(row!.avgDailyValue, undefined); // no volume -> can't derive value
});

test('rows without a symbol, and non-quote payloads, are dropped', () => {
  assert.equal(parseYahooQuoteJson(v7([{ regularMarketPrice: 5 }])).length, 0);
  assert.equal(parseYahooQuoteJson('garbage').length, 0);
  assert.equal(parseYahooQuoteJson({}).length, 0);
});

test('fetchYahooQuotes builds a batched URL and parses the response', async () => {
  let seenUrl = '';
  const rows = await fetchYahooQuotes(['COMI.CA', 'ETEL.CA'], {
    endpoint: '/api/quotes',
    fetchImpl: (async (url: string) => {
      seenUrl = url;
      return new Response(JSON.stringify(v7([{ symbol: 'COMI.CA', regularMarketPrice: 138 }])));
    }) as unknown as typeof fetch,
  });
  assert.ok(seenUrl.includes('/api/quotes?symbols=COMI.CA%2CETEL.CA'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.price, 138);
});

test('fetchYahooQuotes returns empty on a non-ok response or an error', async () => {
  const bad = await fetchYahooQuotes(['COMI.CA'], {
    fetchImpl: (async () => new Response('nope', { status: 500 })) as typeof fetch,
  });
  assert.deepEqual(bad, []);

  const thrown = await fetchYahooQuotes(['COMI.CA'], {
    fetchImpl: (async () => { throw new Error('offline'); }) as typeof fetch,
  });
  assert.deepEqual(thrown, []);

  assert.deepEqual(await fetchYahooQuotes([], {}), []); // no symbols, no fetch
});
