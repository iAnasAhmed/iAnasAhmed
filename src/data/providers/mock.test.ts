import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockProvider } from './mock.ts';
import { EGX_REFERENCE } from '../reference-egx.ts';
import { YahooProvider } from './yahoo.ts';
import { toProviderSymbol, fromProviderSymbol, searchInstruments, lookup, instrumentMap } from '../symbols.ts';

const at = () => new Date('2026-09-02T12:00:00Z');

test('mock provider returns deterministic quotes', async () => {
  const p = new MockProvider(at);
  const a = await p.getQuotes(['COMI', 'ETEL']);
  const b = await p.getQuotes(['COMI', 'ETEL']);
  assert.equal(a.get('COMI')!.price, b.get('COMI')!.price);
  assert.equal(a.size, 2);
});

test('mock provider drifts at most 3% from the reference base', async () => {
  const quotes = await new MockProvider(at).getQuotes(['COMI']);
  const p = quotes.get('COMI')!.price / 1000;
  const base = EGX_REFERENCE['COMI']!.price;
  assert.ok(p > base * 0.97 && p < base * 1.03, `got ${p} vs base ${base}`);
});

test('money-market units do not fluctuate', async () => {
  const q = (await new MockProvider(at).getQuotes(['MMF'])).get('MMF')!;
  assert.equal(q.price, q.previousClose);
});

test('unknown symbols are omitted, not faked', async () => {
  const quotes = await new MockProvider(at).getQuotes(['NOPE']);
  assert.equal(quotes.size, 0);
});

test('symbol mapping translates to and from Yahoo dialect', () => {
  assert.equal(toProviderSymbol('COMI', 'yahoo'), 'COMI.CA');
  assert.equal(toProviderSymbol('comi', 'yahoo'), 'COMI.CA');
  assert.equal(toProviderSymbol('COMI', 'egx'), 'COMI');
  assert.equal(fromProviderSymbol('COMI.CA'), 'COMI');
  // An unknown ticker still gets the Cairo suffix.
  assert.equal(toProviderSymbol('ZZZZ', 'yahoo'), 'ZZZZ.CA');
});

test('instrument lookup and search', () => {
  assert.equal(lookup('comi')!.name, 'Commercial International Bank');
  assert.equal(lookup('NOPE'), undefined);
  assert.ok(searchInstruments('CO').some((i) => i.symbol === 'COMI'));
  assert.ok(searchInstruments('bank').length > 0); // matches by name too
  assert.deepEqual(searchInstruments(''), []);
  assert.ok(instrumentMap().has('COMI'));
});

test('yahoo provider returns an empty map for no symbols without fetching', async () => {
  let called = false;
  const p = new YahooProvider({
    fetchImpl: (async () => { called = true; return new Response('{}'); }) as typeof fetch,
  });
  assert.equal((await p.getQuotes([])).size, 0);
  assert.equal(called, false);
});

test('yahoo provider parses a well-formed payload', async () => {
  const body = JSON.stringify({
    chart: { result: [{ meta: { symbol: 'COMI.CA', regularMarketPrice: 96.4, chartPreviousClose: 95.1 } }] },
  });
  const p = new YahooProvider({
    fetchImpl: (async () => new Response(body, { status: 200 })) as typeof fetch,
  });
  const q = (await p.getQuotes(['COMI'])).get('COMI')!;
  assert.equal(q.price, 96_400);
  assert.equal(q.previousClose, 95_100);
});

test('a failing provider degrades to an empty map, never throws', async () => {
  const p = new YahooProvider({
    fetchImpl: (async () => { throw new Error('network down'); }) as typeof fetch,
  });
  assert.equal((await p.getQuotes(['COMI'])).size, 0);
});

test('a malformed payload is ignored rather than trusted', async () => {
  const p = new YahooProvider({
    fetchImpl: (async () => new Response('{"chart":{"result":[{}]}}')) as typeof fetch,
  });
  assert.equal((await p.getQuotes(['COMI'])).size, 0);
});
