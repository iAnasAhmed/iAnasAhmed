import { test } from 'node:test';
import assert from 'node:assert/strict';
import { egp, format } from './money.ts';
import {
  tradeCosts, roundTripCosts, breakEvenMove, netDividend,
  TELDA_EGX, NO_COSTS, STAMP_DUTY_BPS, STAMP_DUTY_SAME_DAY_BPS,
} from './costs.ts';

test('stamp duty is 0.05% of transaction value', () => {
  // 10,000 EGP trade -> 5 EGP stamp duty
  const c = tradeCosts(egp(10_000), TELDA_EGX);
  assert.equal(c.stampDuty, egp(5));
});

test('Telda commission is zero', () => {
  assert.equal(tradeCosts(egp(10_000), TELDA_EGX).commission, 0);
});

test('same-day trades pay the reduced 0.025% duty', () => {
  const normal = tradeCosts(egp(10_000), TELDA_EGX);
  const sameDay = tradeCosts(egp(10_000), TELDA_EGX, { sameDay: true });
  assert.equal(sameDay.stampDuty, egp(2.5));
  assert.equal(normal.stampDuty, egp(5));
  assert.equal(STAMP_DUTY_SAME_DAY_BPS * 2, STAMP_DUTY_BPS);
});

test('total is the sum of its parts', () => {
  const c = tradeCosts(egp(10_000), TELDA_EGX);
  assert.equal(c.total, c.commission + c.stampDuty + c.otherFees);
  // 0 commission + 5 duty + 10 other = 15 EGP on 10k (0.15%)
  assert.equal(c.total, egp(15));
});

test('NO_COSTS yields exactly zero', () => {
  const c = tradeCosts(egp(10_000), NO_COSTS);
  assert.equal(c.total, 0);
});

test('round trip costs double a single leg', () => {
  const rt = roundTripCosts(egp(10_000), TELDA_EGX);
  assert.equal(rt, egp(30));
  assert.equal(format(rt), '30.00 EGP');
});

test('break-even move is the hurdle every trade must clear', () => {
  // 15 bps per leg, 30 bps round trip = 0.3%
  assert.equal(breakEvenMove(TELDA_EGX), 0.003);
  assert.equal(breakEvenMove(NO_COSTS), 0);
});

test('turnover is what makes low costs expensive', () => {
  // The discipline argument, expressed as a test: 50 round trips a year on a
  // 6,000 EGP sleeve costs 15% of the sleeve, before a single bad decision.
  const sleeve = egp(6_000);
  const perTrip = roundTripCosts(sleeve, TELDA_EGX);
  const annual = perTrip * 50;
  assert.equal(annual / sleeve, 0.15);
});

test('dividends are withheld at 5% for listed companies', () => {
  // 1,000 EGP gross -> 50 EGP tax -> 950 EGP net
  assert.equal(netDividend(egp(1_000)), egp(950));
  assert.equal(netDividend(egp(1_000), 0.10), egp(900));
});

test('costs scale linearly with trade size', () => {
  const small = tradeCosts(egp(1_000), TELDA_EGX).total;
  const big = tradeCosts(egp(10_000), TELDA_EGX).total;
  assert.equal(big, small * 10);
});
