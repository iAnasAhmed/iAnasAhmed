/** GET /api/quote/:symbol — crumbless v8 chart (price fallback). */
import { session, validators, json, relay } from '../../_yahoo.js';

export async function onRequestGet({ params, env }) {
  const symbol = String(params.symbol ?? '');
  if (!validators.SYMBOL_RE.test(symbol)) return json(400, { error: 'bad symbol' });
  return relay(session(env).chart(symbol));
}
