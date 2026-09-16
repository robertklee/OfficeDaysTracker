import { Temporal } from '@js-temporal/polyfill';

export type CivilDate = string;
export type WeekStart = 1 | 6 | 7;

export function isCivilDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  try {
    return Temporal.PlainDate.from(value, { overflow: 'reject' }).toString() === value;
  } catch {
    return false;
  }
}

export function isTimeZone(value: string): boolean {
  if (value !== 'UTC' && !value.includes('/')) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

export const addDays = (date: CivilDate, days: number): CivilDate =>
  Temporal.PlainDate.from(date).add({ days }).toString();
export const daysBetween = (a: CivilDate, b: CivilDate): number =>
  Temporal.PlainDate.from(a).until(Temporal.PlainDate.from(b), { largestUnit: 'days' }).days;
export const weekday = (date: CivilDate): number => Temporal.PlainDate.from(date).dayOfWeek;
export const isWeekend = (date: CivilDate): boolean => weekday(date) > 5;
export const startOfWeek = (date: CivilDate, start: WeekStart): CivilDate =>
  addDays(date, -((weekday(date) - start + 7) % 7));
export const endOfWeek = (date: CivilDate, start: WeekStart): CivilDate =>
  addDays(startOfWeek(date, start), 6);

export function dateRange(a: CivilDate, b: CivilDate, includeWeekends = true): CivilDate[] {
  const [first, last] = a < b ? [a, b] : [b, a];
  const result: CivilDate[] = [];
  for (let date = first; date <= last; date = addDays(date, 1)) {
    if (includeWeekends || !isWeekend(date)) result.push(date);
  }
  return result;
}

export function firstEligibleWeek(startDate: CivilDate, weekStart: WeekStart): CivilDate {
  const week = startOfWeek(startDate, weekStart);
  return week === startDate ? week : addDays(week, 7);
}

export function monthGrid(month: CivilDate, weekStart: WeekStart): CivilDate[] {
  const first = Temporal.PlainDate.from(month).with({ day: 1 }).toString();
  const start = startOfWeek(first, weekStart);
  return dateRange(start, addDays(start, 41));
}

export const shiftMonth = (month: CivilDate, amount: number): CivilDate =>
  Temporal.PlainDate.from(month).with({ day: 1 }).add({ months: amount }).toString();

export function formatDate(date: CivilDate, long = false): string {
  return Temporal.PlainDate.from(date).toLocaleString(
    'en-US',
    long
      ? { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }
      : { month: 'short', day: 'numeric', year: 'numeric' },
  );
}

export const monthLabel = (date: CivilDate): string =>
  Temporal.PlainDate.from(date).toLocaleString('en-US', { month: 'long', year: 'numeric' });

export function dateInZone(instant: string, timeZone: string): CivilDate {
  return Temporal.Instant.from(instant).toZonedDateTimeISO(timeZone).toPlainDate().toString();
}
