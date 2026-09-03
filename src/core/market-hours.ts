/**
 * EGX trading calendar.
 *
 * The Egyptian Exchange trades Sunday–Thursday, 10:00–14:15 local time.
 * Friday and Saturday are the weekend. Source: EGX trading system page,
 * corroborated by Twelve Data's XCAI listing. Verified 2026-09-02.
 *
 * Used to avoid polling market data when the market is closed — see
 * docs/research/04-data-providers.md.
 */

/** Egypt observes EET (UTC+2) and EEST (UTC+3) in summer. */
const CAIRO_TIME_ZONE = 'Africa/Cairo';

export const EGX_OPEN_MINUTES = 10 * 60;      // 10:00
export const EGX_CLOSE_MINUTES = 14 * 60 + 15; // 14:15

/** Sunday=0 … Thursday=4 trade; Friday=5 and Saturday=6 do not. */
const TRADING_WEEKDAYS = new Set([0, 1, 2, 3, 4]);

export interface CairoMoment {
  /** 0 = Sunday. */
  readonly weekday: number;
  /** Minutes since local midnight. */
  readonly minutes: number;
}

/**
 * Project an instant onto Cairo wall-clock time.
 *
 * `Intl` does the timezone arithmetic, so DST transitions are handled by the
 * platform's tz database rather than a hand-rolled offset that would silently
 * drift twice a year.
 */
export function cairoMoment(at: Date = new Date()): CairoMoment {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CAIRO_TIME_ZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(at);

  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? '0';

  const weekdays: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };

  // Intl can render midnight as "24" in hour12:false mode.
  const hour = Number(get('hour')) % 24;

  return {
    weekday: weekdays[get('weekday')] ?? 0,
    minutes: hour * 60 + Number(get('minute')),
  };
}

export function isTradingDay(at: Date = new Date()): boolean {
  return TRADING_WEEKDAYS.has(cairoMoment(at).weekday);
}

export function isMarketOpen(at: Date = new Date()): boolean {
  const { weekday, minutes } = cairoMoment(at);
  if (!TRADING_WEEKDAYS.has(weekday)) return false;
  return minutes >= EGX_OPEN_MINUTES && minutes < EGX_CLOSE_MINUTES;
}

export type MarketStatus = 'open' | 'pre-open' | 'closed' | 'weekend';

export function marketStatus(at: Date = new Date()): MarketStatus {
  const { weekday, minutes } = cairoMoment(at);
  if (!TRADING_WEEKDAYS.has(weekday)) return 'weekend';
  if (minutes < EGX_OPEN_MINUTES) return 'pre-open';
  if (minutes < EGX_CLOSE_MINUTES) return 'open';
  return 'closed';
}

export function describeMarketStatus(status: MarketStatus): string {
  switch (status) {
    case 'open': return 'EGX open · closes 14:15 Cairo';
    case 'pre-open': return 'EGX opens 10:00 Cairo';
    case 'closed': return 'EGX closed for the day';
    case 'weekend': return 'EGX closed · weekend';
  }
}
