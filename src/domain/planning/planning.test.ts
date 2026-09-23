import { describe, expect, it } from 'vitest';
import { addDays, dateRange, startOfWeek, weekday } from '../dates';
import { forecast, type Forecast } from '../projection';
import { type Entry, type Policy } from '../schema';
import { recommendWeeks, simulatedEntries } from './index';

type CountPolicy = Extract<Policy, { kind: 'weekly' | 'rolling' }>;

function meetsPolicy(policy: CountPolicy, outlook: Forecast, totals: ReadonlyMap<string, number>) {
  return outlook.checkpoints.every((point) => {
    const counts = point.capacity.weeks.map((week) => totals.get(week.start) ?? week.count);
    if (policy.kind === 'weekly') return counts.every((count) => count >= policy.n);
    const needed = Math.ceil(
      (policy.x * Math.min(point.capacity.eligibleCompleted, policy.y)) / policy.y,
    );
    if (policy.mode === 'qualifying')
      return counts.filter((count) => count >= policy.n).length >= needed;
    return (
      counts
        .toSorted((a, b) => b - a)
        .slice(0, needed)
        .reduce((sum, count) => sum + count, 0) >=
      needed * policy.n
    );
  });
}

function attendance(
  date: string,
  type: Entry['type'] = 'office',
  status: Entry['status'] = 'planned',
): Entry {
  return {
    date,
    type,
    status,
    priority: 'normal',
    notes: '',
    revision: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('future-week count guidance against independent policy arithmetic', () => {
  const policies = [
    { kind: 'weekly', n: 2, windowWeeks: 4 },
    { kind: 'rolling', mode: 'qualifying', x: 1, y: 2, n: 2 },
    { kind: 'rolling', mode: 'qualifying', x: 2, y: 3, n: 3 },
    { kind: 'rolling', mode: 'average', x: 2, y: 3, n: 2 },
  ] as const;
  const scenarios = [
    { todayOffset: 3, history: false, entries: [] },
    {
      todayOffset: 3,
      history: false,
      entries: [
        [0, 'office', 'actual'],
        [4, 'office', 'planned'],
        [7, 'remote', 'planned'],
        [9, 'vacation', 'planned'],
        [15, 'office', 'planned'],
      ],
    },
    {
      todayOffset: 3,
      history: false,
      entries: [
        [0, 'office', 'planned'],
        [1, 'office', 'actual'],
        [7, 'office', 'planned'],
        [8, 'remote', 'planned'],
        [15, 'office', 'actual'],
      ],
    },
    { todayOffset: 5, history: false, entries: [] },
    {
      todayOffset: 3,
      history: true,
      entries: [
        [-7, 'office', 'actual'],
        [-6, 'office', 'actual'],
        [3, 'remote', 'planned'],
        [10, 'office', 'planned'],
      ],
    },
  ] satisfies {
    todayOffset: number;
    history: boolean;
    entries: (readonly [number, Entry['type'], Entry['status']])[];
  }[];

  it.each([1, 6, 7] as const)(
    'verifies feasibility, the smallest weekly cap, and exact minima with week start %s',
    (weekStart) => {
      const first = startOfWeek('2026-03-30', weekStart);
      for (const settings of policies) {
        for (const scenario of scenarios) {
          const policy: CountPolicy = {
            ...settings,
            startDate: addDays(first, scenario.history ? -7 : 0),
            weekStart,
            timeZone: 'UTC',
          };
          const snapshot = {
            policy,
            today: addDays(first, scenario.todayOffset),
            records: scenario.entries.map(([offset, type, status]) =>
              attendance(addDays(first, offset), type, status),
            ),
          };
          const outlook = forecast(snapshot);
          const committed = new Map(
            outlook.checkpoints.map((point) => [point.weekStart, point.committedDates.length]),
          );
          const capacity = new Map(
            outlook.checkpoints.map((point) => [
              point.weekStart,
              point.committedDates.length + point.availableDates.length,
            ]),
          );
          const result = recommendWeeks(snapshot);
          const label = `${policy.kind} ${'mode' in policy ? policy.mode : ''}, start ${weekStart}, scenario ${scenarios.indexOf(scenario)}`;
          if (!meetsPolicy(policy, outlook, capacity)) {
            expect(result, label).toEqual({ state: 'conflict', weeks: [] });
            continue;
          }

          const covered = meetsPolicy(policy, outlook, committed);
          expect(result.state, label).toBe(covered ? 'unnecessary' : 'ready');
          expect(
            result.weeks.map((week) => week.weekStart),
            label,
          ).toEqual(outlook.checkpoints.map((point) => point.weekStart));
          const cap = covered
            ? policy.n
            : Array.from({ length: 8 - policy.n }, (_, index) => policy.n + index).find((limit) =>
                meetsPolicy(
                  policy,
                  outlook,
                  new Map(
                    [...capacity].map(([week, available]) => [
                      week,
                      Math.max(committed.get(week)!, Math.min(available, limit)),
                    ]),
                  ),
                ),
              );
          expect(cap, label).toBeDefined();
          const suggested = new Map(result.weeks.map((week) => [week.weekStart, week.officeDays]));
          const baseline = new Map(result.weeks.map((week) => [week.weekStart, week.baselineDays]));
          expect(meetsPolicy(policy, outlook, suggested), label).toBe(true);
          expect(meetsPolicy(policy, outlook, baseline), label).toBe(true);
          const plannedDates = result.weeks.flatMap((week) => {
            const checkpoint = outlook.checkpoints.find(
              (point) => point.weekStart === week.weekStart,
            )!;
            return checkpoint.availableDates
              .slice(0, week.additionalDays)
              .map((date) => attendance(date));
          });
          const verified = forecast({
            ...snapshot,
            records: [...snapshot.records, ...plannedDates],
          });
          expect(
            verified.checkpoints.every((point) => point.committed.score?.met),
            label,
          ).toBe(true);
          for (const week of result.weeks) {
            const saved = committed.get(week.weekStart)!;
            expect(week.officeDays, label).toBe(saved + week.additionalDays);
            expect(week.officeDays, label).toBeLessThanOrEqual(capacity.get(week.weekStart)!);
            expect(week.officeDays, label).toBeLessThanOrEqual(Math.max(saved, cap!));
            expect(week.baselineDays, label).toBe(
              Math.max(week.officeDays, Math.min(policy.n, capacity.get(week.weekStart)!)),
            );
            expect(week.baselineAdditionalDays, label).toBe(week.baselineDays - saved);
            expect(week.flexibleMinimumDays, label).toBe(
              Array.from({ length: 8 }, (_, count) => count).find((count) =>
                meetsPolicy(policy, outlook, new Map([...baseline, [week.weekStart, count]])),
              ),
            );
            expect(week.flexibleMinimumDays, label).toBeLessThanOrEqual(week.baselineDays);
            expect(
              verified.checkpoints.find((point) => point.weekStart === week.weekStart)
                ?.committedDates.length,
              label,
            ).toBe(week.officeDays);
            const minimum = Array.from({ length: 8 }, (_, count) => count).find((count) =>
              meetsPolicy(policy, outlook, new Map([...capacity, [week.weekStart, count]])),
            );
            expect(week.minimumDays, label).toBe(minimum);
            expect(week.minimumDays, label).toBeLessThanOrEqual(week.officeDays);
            if (week.additionalDays > 0) {
              expect(
                meetsPolicy(
                  policy,
                  outlook,
                  new Map([...suggested, [week.weekStart, week.officeDays - 1]]),
                ),
                label,
              ).toBe(false);
            }
          }
        }
      }
    },
  );
});

describe('specific-weekday guidance', () => {
  function dateFor(start: string, index: number, requiredDay: number): string {
    const week = addDays(start, index * 7);
    return dateRange(week, addDays(week, 6)).find((date) => weekday(date) === requiredDay)!;
  }

  it.each([1, 6, 7] as const)(
    'plans only missing mandated days while preserving extra office plans with week start %s',
    (weekStart) => {
      const first = startOfWeek('2026-03-30', weekStart);
      const policy: Policy = {
        kind: 'weekdays',
        requiredDays: [2, 4],
        windowWeeks: 4,
        startDate: first,
        weekStart,
        timeZone: 'UTC',
      };
      const snapshot = {
        policy,
        today: first,
        records: [
          attendance(first, 'office', 'actual'),
          attendance(dateFor(first, 1, 2), 'office'),
          attendance(dateFor(first, 1, 3), 'office'),
        ],
      };
      const before = JSON.stringify(snapshot);
      const result = recommendWeeks(snapshot);
      expect(result.state).toBe('ready');
      expect(result.weeks[0]).toMatchObject({
        officeDays: 3,
        additionalDays: 2,
        minimumDays: 2,
        baselineDays: 3,
        baselineAdditionalDays: 2,
        flexibleMinimumDays: 2,
      });
      expect(result.weeks[1]).toMatchObject({
        officeDays: 3,
        additionalDays: 1,
        minimumDays: 2,
        baselineDays: 3,
        baselineAdditionalDays: 1,
        flexibleMinimumDays: 2,
      });
      const added = result.weeks.flatMap((_, index) =>
        policy.requiredDays
          .map((day) => dateFor(first, index, day))
          .filter((date) => !snapshot.records.some((record) => record.date === date)),
      );
      const verified = forecast({
        ...snapshot,
        records: [...snapshot.records, ...simulatedEntries(added)],
      });
      expect(verified.checkpoints.every((point) => point.committed.score?.met)).toBe(true);
      expect(
        result.weeks.every(
          (week, index) =>
            week.weekStart === verified.checkpoints[index].weekStart &&
            week.additionalDays ===
              added.filter(
                (date) => date >= week.weekStart && date <= verified.checkpoints[index].end,
              ).length &&
            week.minimumDays === policy.requiredDays.length,
        ),
      ).toBe(true);
      expect(JSON.stringify(snapshot)).toBe(before);
      expect(recommendWeeks(snapshot)).toEqual(result);
    },
  );

  it.each(['remote', 'vacation', 'sick', 'holiday'] as const)(
    'reports a conflict rather than substituting another day for a planned %s',
    (type) => {
      const policy: Policy = {
        kind: 'weekdays',
        requiredDays: [2, 4],
        windowWeeks: 4,
        startDate: '2026-03-29',
        weekStart: 7,
        timeZone: 'UTC',
      };
      const blocked = attendance('2026-03-31', type);
      const result = recommendWeeks({
        policy,
        today: '2026-03-29',
        records: [blocked, ...simulatedEntries(['2026-03-30', '2026-04-01', '2026-04-02'])],
      });
      expect(result).toEqual({ state: 'conflict', weeks: [] });
    },
  );
});
