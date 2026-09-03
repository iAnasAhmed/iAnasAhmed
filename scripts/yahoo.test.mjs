import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createYahooSession } from './yahoo.mjs';

/** Build a fake upstream `fetch` that records calls and scripts responses. */
function fakeUpstream(handlers) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers ?? {} });
    for (const [pattern, handler] of handlers) {
      if (String(url).includes(pattern)) return handler(String(url), init);
    }
    return new Response('not found', { status: 404 });
  };
  return { fetchImpl, calls };
}

const cookieResponse = () =>
  new Response('<html>ok</html>', { status: 200, headers: { 'set-cookie': 'A1=token; Path=/; Domain=.yahoo.com' } });

test('session fetches a cookie then a crumb, and caches both', async () => {
  const { fetchImpl, calls } = fakeUpstream([
    ['fc.yahoo.com', cookieResponse],
    ['/v1/test/getcrumb', () => new Response('the-crumb', { status: 200 })],
  ]);
  const yahoo = createYahooSession({ fetchImpl, base: 'https://fake', cookieUrl: 'https://fc.yahoo.com' });

  const s = await yahoo.ensure();
  assert.equal(s.crumb, 'the-crumb');
  assert.equal(s.cookie, 'A1=token');

  await yahoo.ensure(); // cached — no new crumb request
  const crumbCalls = calls.filter((c) => c.url.includes('getcrumb'));
  assert.equal(crumbCalls.length, 1);
});

test('quote sends the crumb and cookie, and hits the v7 endpoint', async () => {
  const { fetchImpl, calls } = fakeUpstream([
    ['fc.yahoo.com', cookieResponse],
    ['/v1/test/getcrumb', () => new Response('CR', { status: 200 })],
    ['/v7/finance/quote', () => new Response('{"quoteResponse":{"result":[]}}', { status: 200 })],
  ]);
  const yahoo = createYahooSession({ fetchImpl, base: 'https://fake', cookieUrl: 'https://fc.yahoo.com' });

  const resp = await yahoo.quote('COMI.CA,ETEL.CA');
  assert.equal(resp.status, 200);

  const quoteCall = calls.find((c) => c.url.includes('/v7/finance/quote'));
  assert.ok(quoteCall.url.includes('symbols=COMI.CA%2CETEL.CA'));
  assert.ok(quoteCall.url.includes('crumb=CR'));
  assert.equal(quoteCall.headers.cookie, 'A1=token');
});

test('a 401 triggers one crumb refresh and a retry that succeeds', async () => {
  let crumbCount = 0;
  let quoteCount = 0;
  const { fetchImpl } = fakeUpstream([
    ['fc.yahoo.com', cookieResponse],
    ['/v1/test/getcrumb', () => { crumbCount++; return new Response(`crumb${crumbCount}`, { status: 200 }); }],
    ['/v7/finance/quote', () => {
      quoteCount++;
      return quoteCount === 1
        ? new Response('unauthorized', { status: 401 })
        : new Response('{"quoteResponse":{"result":[{"symbol":"COMI.CA"}]}}', { status: 200 });
    }],
  ]);
  const yahoo = createYahooSession({ fetchImpl, base: 'https://fake', cookieUrl: 'https://fc.yahoo.com' });

  const resp = await yahoo.quote('COMI.CA');
  assert.equal(resp.status, 200);
  assert.equal(crumbCount, 2, 'crumb refreshed once after the 401');
  assert.equal(quoteCount, 2, 'quote retried once');
});

test('the chart endpoint is crumbless', async () => {
  const { fetchImpl, calls } = fakeUpstream([
    ['/v8/finance/chart/', () => new Response('{"chart":{"result":[]}}', { status: 200 })],
  ]);
  const yahoo = createYahooSession({ fetchImpl, base: 'https://fake', cookieUrl: 'https://fc.yahoo.com' });

  await yahoo.chart('COMI.CA');
  const chartCall = calls.find((c) => c.url.includes('/v8/finance/chart/'));
  assert.ok(chartCall);
  assert.ok(!chartCall.url.includes('crumb'), 'chart must not require a crumb');
  assert.equal(calls.filter((c) => c.url.includes('getcrumb')).length, 0);
});
