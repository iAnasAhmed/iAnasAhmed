/** GET /api/fundamentals/:symbol — v10 quoteSummary (secondary source). */
import { session, validators, json, relay } from '../../_yahoo.js';

export async function onRequestGet({ request, params, env }) {
  const symbol = String(params.symbol ?? '');
  if (!validators.SYMBOL_RE.test(symbol)) return json(400, { error: 'bad symbol' });
  const modules = new URL(request.url).searchParams.get('modules')
    ?? 'price,summaryDetail,defaultKeyStatistics';
  if (!/^[A-Za-z,]{1,120}$/.test(modules)) return json(400, { error: 'bad modules' });
  return relay(session(env).summary(symbol, modules));
}
