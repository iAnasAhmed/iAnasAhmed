import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockFundamentalsProvider, YahooFundamentalsProvider } from './fundamentals.ts';
import { runScreen } from '../core/screener.ts';

test('mock fundamentals are deterministic and cover equities only', async () => {
  const p = new MockFundamentalsProvider();
  const a = await p.getFundamentals(['COMI', 'ETEL', 'MMF']);
  const b = await p.getFundamentals(['COMI', 'ETEL', 'MMF']);

  assert.equal(a.get('COMI')!.peRatio, b.get('COMI')!.peRatio); // stable
  assert.ok(a.has('COMI'));
  assert.equal(a.has('MMF'), false); // money-market fund is not a screenable equity
});

test('mock fundamentals are internally plausible', async () => {
  const all = await new MockFundamentalsProvider().getFundamentals(
    ['COMI', 'CIEB', 'FWRY', 'SWDY', 'TMGH'],
  );
  for (const metric of all.values()) {
    assert.ok(metric.peRatio! > 0 && metric.peRatio! < 60);
    assert.ok(metric.dividendYield! >= 0 && metric.dividendYield! < 0.15);
    assert.ok(metric.avgDailyValue! > 0);
  }
  // Banks get cheaper multiples than tech in the demo model.
  assert.ok(all.get('COMI')!.peRatio! < all.get('FWRY')!.peRatio!);
});

test('the mock set feeds a working screen', async () => {
  const metrics = [...(await new MockFundamentalsProvider().getFundamentals(
    ['COMI', 'ETEL', 'HRHO', 'SWDY', 'FWRY'],
  )).values()];
  const results = runScreen(metrics);
  assert.equal(results.length, 5);
  assert.ok(results[0]!.score >= results[results.length - 1]!.score);
});

test('yahoo fundamentals parse a well-formed payload', async () => {
  const body = JSON.stringify({
    quoteSummary: { result: [{
      price: { symbol: 'COMI.CA', regularMarketPrice: { raw: 96.4 }, marketCap: { raw: 290_000_000_000 } },
      summaryDetail: {
        trailingPE: { raw: 7.8 }, priceToBook: { raw: 1.3 },
        dividendYield: { raw: 0.052 }, averageDailyVolume10Day: { raw: 1_200_000 },
      },
      defaultKeyStatistics: { '52WeekChange': { raw: 0.44 } },
    }] },
  });
  const p = new YahooFundamentalsProvider({
    fetchImpl: (async () => new Response(body, { status: 200 })) as typeof fetch,
  });
  const metric = (await p.getFundamentals(['COMI'])).get('COMI')!;
  assert.equal(metric.peRatio, 7.8);
  assert.equal(metric.pbRatio, 1.3);
  assert.equal(metric.dividendYield, 0.052);
  assert.equal(metric.yearChange, 0.44);
  // avgDailyValue ≈ volume × price = 1.2M × 96.4
  assert.ok(metric.avgDailyValue! > 0);
});

test('yahoo fundamentals degrade to empty on failure, never throw', async () => {
  const p = new YahooFundamentalsProvider({
    fetchImpl: (async () => { throw new Error('offline'); }) as typeof fetch,
  });
  assert.equal((await p.getFundamentals(['COMI'])).size, 0);
});

test('a partial yahoo payload keeps what it has and omits the rest', async () => {
  const body = JSON.stringify({
    quoteSummary: { result: [{ price: { symbol: 'ETEL.CA', regularMarketPrice: { raw: 45 } } }] },
  });
  const p = new YahooFundamentalsProvider({
    fetchImpl: (async () => new Response(body)) as typeof fetch,
  });
  const metric = (await p.getFundamentals(['ETEL'])).get('ETEL')!;
  assert.equal(metric.peRatio, undefined);
  assert.equal(metric.dividendYield, undefined);
  assert.ok(metric.price! > 0);
});

test('no symbols means no fetch', async () => {
  let called = false;
  const p = new YahooFundamentalsProvider({
    fetchImpl: (async () => { called = true; return new Response('{}'); }) as typeof fetch,
  });
  assert.equal((await p.getFundamentals([])).size, 0);
  assert.equal(called, false);
});
