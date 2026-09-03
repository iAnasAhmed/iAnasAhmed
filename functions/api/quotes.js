/** GET /api/quotes?symbols=A.CA,B.CA — batched v7 quote (price + fundamentals). */
import { session, validators, json, relay } from '../_yahoo.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const symbols = url.searchParams.get('symbols') ?? '';
  if (!validators.SYMBOL_LIST_RE.test(symbols)) return json(400, { error: 'bad symbols' });
  return relay(session(env).quote(symbols));
}
