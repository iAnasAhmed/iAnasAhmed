import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMarketOpen, isTradingDay, marketStatus, cairoMoment } from './market-hours.ts';

// 2026-09-02 is a Wednesday. Cairo is UTC+3 in September (EEST).
const wednesday = (utcHour: number, utcMinute = 0): Date =>
  new Date(Date.UTC(2026, 8, 2, utcHour, utcMinute));

test('cairoMoment maps UTC onto Cairo wall-clock', () => {
  const m = cairoMoment(wednesday(9, 0)); // 12:00 Cairo
  assert.equal(m.weekday, 3); // Wednesday
  assert.equal(m.minutes, 12 * 60);
});

test('the market is open midday on a Wednesday', () => {
  assert.equal(isMarketOpen(wednesday(9, 0)), true);
  assert.equal(marketStatus(wednesday(9, 0)), 'open');
});

test('the market is shut before the open and after the close', () => {
  assert.equal(marketStatus(wednesday(6, 0)), 'pre-open');  // 09:00 Cairo
  assert.equal(marketStatus(wednesday(12, 0)), 'closed');   // 15:00 Cairo
  assert.equal(isMarketOpen(wednesday(12, 0)), false);
});

test('the open and close boundaries are exact', () => {
  assert.equal(isMarketOpen(wednesday(7, 0)), true);   // 10:00 Cairo — open
  assert.equal(isMarketOpen(wednesday(6, 59)), false); // 09:59
  assert.equal(isMarketOpen(wednesday(11, 14)), true); // 14:14
  assert.equal(isMarketOpen(wednesday(11, 15)), false); // 14:15 — closed
});

test('Friday and Saturday are the weekend; Sunday trades', () => {
  const friday = new Date(Date.UTC(2026, 8, 4, 9, 0));
  const saturday = new Date(Date.UTC(2026, 8, 5, 9, 0));
  const sunday = new Date(Date.UTC(2026, 8, 6, 9, 0));

  assert.equal(marketStatus(friday), 'weekend');
  assert.equal(marketStatus(saturday), 'weekend');
  assert.equal(isTradingDay(saturday), false);
  assert.equal(isTradingDay(sunday), true);
  assert.equal(isMarketOpen(sunday), true);
});
