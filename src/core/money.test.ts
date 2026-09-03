import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  egp, piastres, price, add, sub, scale, applyBps, valueOf,
  toEgp, format, formatPct, formatShare, formatPrice, abs, neg, ratio, ZERO,
} from './money.ts';

test('egp() converts decimals to exact integer piastres', () => {
  assert.equal(egp(12.34), 1234);
  assert.equal(egp(0.01), 1);
  assert.equal(egp(0), 0);
  assert.equal(egp(-5.5), -550);
});

test('egp() rounds half away from zero, symmetrically', () => {
  assert.equal(egp(0.005), 1);
  assert.equal(egp(-0.005), -1);
});

test('float error is eliminated — the whole reason for integer money', () => {
  // 0.1 + 0.2 !== 0.3 in floating point. In piastres it is exact.
  assert.equal(add(egp(0.1), egp(0.2)), egp(0.3));
  assert.equal(add(egp(0.1), egp(0.2)), 30);

  // A thousand small additions must not drift by even one piastre.
  let total = ZERO;
  for (let i = 0; i < 1000; i++) total = add(total, egp(0.07));
  assert.equal(total, egp(70));
});

test('piastres() rejects non-integers', () => {
  assert.throws(() => piastres(1.5), RangeError);
  assert.equal(piastres(150), 150);
});

test('egp() rejects non-finite input', () => {
  assert.throws(() => egp(NaN), RangeError);
  assert.throws(() => egp(Infinity), RangeError);
});

test('price() stores 3 decimal places as mills', () => {
  assert.equal(price(85.5), 85500);
  assert.equal(price(85.125), 85125);
  assert.equal(price(0), 0);
  assert.throws(() => price(-1), RangeError);
});

test('valueOf() computes market value exactly', () => {
  // 100 shares @ 85.500 EGP = 8,550.00 EGP = 855,000 piastres
  assert.equal(valueOf(100, price(85.5)), egp(8550));
  // 3 shares @ 12.345 = 37.035 -> 3703.5 piastres -> rounds to 3704
  assert.equal(valueOf(3, price(12.345)), 3704);
  assert.equal(valueOf(0, price(99)), 0);
});

test('valueOf() supports fractional units for mutual funds', () => {
  // 10.5 units @ 20.000 = 210.00 EGP
  assert.equal(valueOf(10.5, price(20)), egp(210));
});

test('applyBps() models regulatory rates', () => {
  // EGX stamp duty: 0.05% = 5 bps on 10,000 EGP = 5 EGP
  assert.equal(applyBps(egp(10_000), 5), egp(5));
  // Same-day reduced rate: 0.025% = 2.5 bps = 2.50 EGP
  assert.equal(applyBps(egp(10_000), 2.5), egp(2.5));
  assert.equal(applyBps(egp(10_000), 0), 0);
});

test('sub, neg, abs, scale', () => {
  assert.equal(sub(egp(100), egp(30)), egp(70));
  assert.equal(neg(egp(100)), egp(-100));
  assert.equal(abs(egp(-100)), egp(100));
  assert.equal(scale(egp(100), 0.5), egp(50));
});

test('ratio() guards division by zero', () => {
  assert.equal(ratio(egp(50), egp(200)), 0.25);
  assert.equal(ratio(egp(50), ZERO), 0);
});

test('format() renders grouped EGP', () => {
  assert.equal(format(egp(1234.5)), '1,234.50 EGP');
  assert.equal(format(egp(1234.5), { currency: false }), '1,234.50');
  assert.equal(format(egp(1234.5), { signed: true }), '+1,234.50 EGP');
  assert.equal(format(egp(-1234.5), { signed: true }), '-1,234.50 EGP');
  assert.equal(format(egp(0), { signed: true }), '0.00 EGP');
});

test('format() compact mode', () => {
  assert.equal(format(egp(12_340), { compact: true, currency: false }), '12.3k');
  assert.equal(format(egp(1_200_000), { compact: true, currency: false }), '1.2M');
  assert.equal(format(egp(999), { compact: true, currency: false }), '999.00');
});

test('formatPct() and formatPrice()', () => {
  assert.equal(formatPct(0.1234), '+12.34%');
  assert.equal(formatPct(-0.05), '-5.00%');
  assert.equal(formatPct(NaN), '—');
  assert.equal(formatPrice(price(85.5)), '85.500');
});

test('toEgp() round-trips', () => {
  assert.equal(toEgp(egp(1234.56)), 1234.56);
});

test('formatShare has no sign — a weight has no direction', () => {
  assert.equal(formatShare(0.79), '79%');
  assert.equal(formatShare(0.1234, 1), '12.3%');
  assert.equal(formatShare(NaN), '—');
  // and it differs from the signed variant used for returns
  assert.equal(formatPct(0.79), '+79.00%');
});
