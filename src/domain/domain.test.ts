import { describe, expect, it } from 'vitest';
import {
  addDays,
  dateInZone,
  dateRange,
  firstEligibleWeek,
  isCivilDate,
  monthGrid,
  startOfWeek,
} from './dates';
import { evaluate } from './policies';
import { forecast } from './projection';
import { simulatedEntries, strategyLabel, suggest } from './planning';
import { policySchema, type Entry, type Policy } from './schema';

const start = '2026-01-05';
const today = '2026-03-30';
const rolling: Policy = {
  kind: 'rolling',
  x: 8,
  y: 12,
  n: 3,
  mode: 'qualifying',
  startDate: start,
  weekStart: 1,
  timeZone: 'America/Los_Angeles',
};
const entry = (date: string, override: Partial<Entry> = {}): Entry => ({
  date,
  type: 'office',
  status: 'actual',
  priority: 'normal',
  notes: '',
  revision: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...override,
});
function history(counts: number[], first = start): Entry[] {
  return counts.flatMap((count, week) =>
    Array.from({ length: count }, (_, day) => entry(addDays(first, week * 7 + day))),
  );
}
const weekly: Policy = {
  kind: 'weekly',
  n: 3,
  windowWeeks: 4,
  startDate: start,
  weekStart: 1,
  timeZone: 'UTC',
};

describe('civil dates and policy validation', () => {
  it('validates real Gregorian keys and IANA zones', () => {
    expect(isCivilDate('2024-02-29')).toBe(true);
    for (const bad of ['2025-02-29', '2026-04-31', '2026-1-05', '0000-01-01', 'March 24'])
      expect(isCivilDate(bad)).toBe(false);
    for (const changes of [
      { x: 0 },
      { x: 13 },
      { y: 53 },
      { n: 6 },
      { n: 1.5 },
      { timeZone: '+02:00' },
      { timeZone: 'Not/AZone' },
      { startDate: '2025-02-29' },
    ]) {
      expect(policySchema.safeParse({ ...rolling, ...changes }).success).toBe(false);
    }
    expect(
      policySchema.safeParse({ ...weekly, kind: 'weekdays', requiredDays: [2, 2], n: undefined })
        .success,
    ).toBe(false);
  });
  it('keeps civil dates independent of travel and DST', () => {
    expect(dateInZone('2026-03-25T01:00:00Z', 'America/Los_Angeles')).toBe('2026-03-24');
    expect(dateInZone('2026-03-25T01:00:00Z', 'Asia/Tokyo')).toBe('2026-03-25');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
    expect(entry('2026-03-24').date).toBe('2026-03-24');
  });
  it.each([1, 6, 7] as const)('paints inclusive reverse ranges for week start %s', (weekStart) => {
    expect(dateRange('2026-03-27', '2026-03-31', false)).toEqual([
      '2026-03-27',
      '2026-03-30',
      '2026-03-31',
    ]);
    expect(dateRange('2026-03-31', '2026-03-27', false)).toEqual([
      '2026-03-27',
      '2026-03-30',
      '2026-03-31',
    ]);
    expect(dateRange('2026-03-27', '2026-03-31')).toHaveLength(5);
    expect(monthGrid('2026-03-24', weekStart)).toHaveLength(42);
    expect(startOfWeek('2026-03-24', weekStart)).toBe(
      weekStart === 1 ? '2026-03-23' : weekStart === 7 ? '2026-03-22' : '2026-03-21',
    );
  });
});

describe('completed-week policy evaluation', () => {
  it('passes eight qualifying weeks, fails seven, and forbids surplus substitution', () => {
    expect(evaluate(rolling, history([3, 3, 3, 3, 3, 3, 3, 3, 0, 0, 0, 0]), today).state).toBe(
      'compliant',
    );
    expect(evaluate(rolling, history([4, 3, 3, 3, 3, 3, 3, 0, 0, 0, 0, 0]), today).state).toBe(
      'shortfall',
    );
  });
  it('evaluates average mode independently', () => {
    const records = history([5, 5, 5, 5, 4, 0, 0, 0, 0, 0, 0, 0]);
    expect(evaluate({ ...rolling, mode: 'average' }, records, today).score).toMatchObject({
      achieved: 24,
      target: 24,
      met: true,
    });
    expect(evaluate(rolling, records, today).state).toBe('shortfall');
  });
  it('discloses future enforcement, partial first weeks, empty history and scaled initialization', () => {
    expect(evaluate({ ...rolling, startDate: '2026-04-01' }, [], today).state).toBe('not-started');
    expect(firstEligibleWeek('2026-01-07', 1)).toBe('2026-01-12');
    expect(
      evaluate({ ...rolling, startDate: '2026-01-07' }, history([5]), '2026-01-12').state,
    ).toBe('gathering');
    expect(evaluate(rolling, [], start).score).toBeNull();
    const partial = evaluate(rolling, [], '2026-02-02');
    expect(partial.state).toBe('initializing');
    expect(partial.score?.target).toBe(3);
    expect(evaluate({ ...rolling, mode: 'average' }, [], '2026-02-02').score?.target).toBe(9);
  });
  it('ends weekly initialization after one completed week', () => {
    expect(evaluate(weekly, [], '2026-01-11').state).toBe('gathering');
    expect(evaluate(weekly, [], '2026-01-12').state).toBe('shortfall');
    expect(evaluate(weekly, history([5, 1]), '2026-01-19').state).toBe('shortfall');
  });
  it('excludes unfinished weeks, pre-enforcement dates, weekends, plans and future actuals', () => {
    const records = [
      entry('2026-01-04'),
      entry('2026-01-05', { status: 'planned' }),
      entry('2026-01-10'),
      entry('2026-01-11'),
      entry('2026-01-12'),
    ];
    expect(evaluate(weekly, records, '2026-01-12').weeks[0].count).toBe(0);
    expect(evaluate(weekly, records, '2026-01-09').weeks).toHaveLength(0);
  });
  it.each([1, 6, 7] as const)('completes weeks correctly for start %s', (weekStart) => {
    const policy = { ...weekly, weekStart, startDate: '2026-01-03' };
    const first = firstEligibleWeek(policy.startDate, weekStart);
    expect(evaluate(policy, [], addDays(first, 6)).state).toBe('gathering');
    expect(evaluate(policy, [], addDays(first, 7)).state).toBe('shortfall');
  });
  it('cannot substitute another weekday for a mandated day', () => {
    const required: Policy = {
      kind: 'weekdays',
      requiredDays: [2, 4],
      startDate: start,
      weekStart: 1,
      timeZone: 'UTC',
      windowWeeks: 4,
    };
    expect(evaluate(required, [entry('2026-01-05'), entry('2026-01-07')], '2026-01-12').state).toBe(
      'shortfall',
    );
    expect(evaluate(required, [entry('2026-01-06'), entry('2026-01-08')], '2026-01-12').state).toBe(
      'compliant',
    );
  });
});

describe('snapshot projection and deterministic plans', () => {
  it('identifies the exact expiring week and includes intervening planned office days without mutation', () => {
    const records = history([3, 3, 3, 3, 3, 3, 3, 3]);
    const initial = forecast({ policy: rolling, records, today });
    expect(initial.firstAffected?.end).toBe('2026-04-05');
    expect(initial.firstAffected?.expiringWeeks).toEqual(['2026-01-05']);
    const planned = [...records, ...simulatedEntries(['2026-03-30', '2026-03-31', '2026-04-01'])];
    const copy = JSON.stringify(planned);
    expect(forecast({ policy: rolling, records: planned, today }).firstAffected?.end).toBe(
      '2026-04-12',
    );
    expect(JSON.stringify(planned)).toBe(copy);
  });
  it('treats unknown as capacity, not a commitment, and non-office plans as constraints', () => {
    const policy = { ...weekly, startDate: today };
    expect(forecast({ policy, records: [], today }).state).toBe('planning');
    const records = dateRange(today, '2026-04-03').map((date) =>
      entry(date, { type: 'remote', status: 'planned' }),
    );
    expect(forecast({ policy, records, today }).state).toBe('conflict');
    expect(forecast({ policy: { ...policy, n: 9 }, records: [], today }).state).toBe('invalid');
  });
  it('does not hide upcoming risk during initialization', () => {
    expect(evaluate(rolling, [], start).state).toBe('gathering');
    expect(forecast({ policy: rolling, records: [], today: start }).state).toBe('planning');
    expect(
      forecast({ policy: { ...rolling, startDate: '2027-01-01' }, records: [], today: start })
        .state,
    ).toBe('gathering');
  });
  it('does not treat past plans or future actuals as simulated attendance', () => {
    const policy = { ...weekly, n: 1 };
    const records = [entry('2026-01-05', { status: 'planned' }), entry('2026-01-13')];
    const result = forecast({ policy, records, today: '2026-01-12' });
    expect(result.checkpoints[0].committed.weeks[0].count).toBe(0);
    expect(result.checkpoints[0].committedDates).toEqual([]);
    expect(result.state).toBe('conflict');
  });
  it.each([1, 6, 7] as const)('derives future checkpoint ends for week start %s', (weekStart) => {
    const result = forecast({ policy: { ...weekly, weekStart }, records: [], today: '2026-03-24' });
    expect(result.checkpoints[0].end).toBe(
      weekStart === 1 ? '2026-03-29' : weekStart === 7 ? '2026-03-28' : '2026-03-27',
    );
  });
  it('builds a full-horizon verified plan, preserving commitments and choosing earlier dates', () => {
    const policy = { ...weekly, startDate: today };
    const records = [
      entry('2026-03-30', { type: 'remote', status: 'planned', priority: 'must' }),
      entry('2026-04-03', { type: 'vacation', status: 'planned' }),
    ];
    const snapshot = { policy, records, today };
    const result = suggest(snapshot);
    expect(result.state).toBe('ready');
    expect(result.dates.slice(0, 3)).toEqual(['2026-03-31', '2026-04-01', '2026-04-02']);
    expect(result.dates).not.toContain('2026-03-30');
    expect(result.dates).not.toContain('2026-04-03');
    const verified = forecast({
      ...snapshot,
      records: [...records, ...simulatedEntries(result.dates)],
    });
    expect(verified.checkpoints.every((point) => point.committed.score?.met)).toBe(true);
    expect(result).toEqual(suggest(snapshot));
  });
  it('does not propose protected/leave conversions or claim historical repair', () => {
    const policy: Policy = {
      kind: 'weekdays',
      requiredDays: [2],
      startDate: today,
      weekStart: 1,
      timeZone: 'UTC',
      windowWeeks: 4,
    };
    const records = [entry('2026-03-31', { type: 'remote', status: 'planned', priority: 'must' })];
    expect(suggest({ policy, records, today })).toMatchObject({
      state: 'conflict',
      dates: [],
      alternatives: [],
    });
    expect(suggest({ policy: weekly, records: [], today: '2026-01-16' }).explanation).toContain(
      'Historical deficits cannot be repaired',
    );
  });
  it('only calls surplus an average-mode Load when it demonstrates improvement', () => {
    const policy = { ...rolling, mode: 'average' as const, startDate: today };
    const added = dateRange(today, '2026-04-03');
    expect(strategyLabel({ policy, records: [], today }, today, added)).toBe('Load');
    expect(
      strategyLabel(
        { policy: { ...policy, mode: 'qualifying' }, records: [], today },
        today,
        added,
      ),
    ).toBe('Standard');
  });
  it('recalculates count-preserving edits and stays under the forecast budget on five years / 52 weeks', () => {
    const policy = { ...rolling, y: 52, x: 35, startDate: '2021-03-29' };
    const records = dateRange('2021-03-29', '2026-03-29').map((date) => entry(date));
    const before = performance.now();
    const result = forecast({ policy, records, today });
    const elapsed = performance.now() - before;
    expect(result.horizonWeeks).toBe(52);
    expect(elapsed).toBeLessThan(500);
    const small = { ...weekly, startDate: today, n: 1 };
    const office = forecast({ policy: small, records: simulatedEntries([today]), today });
    const remote = forecast({
      policy: small,
      records: [entry(today, { type: 'remote', status: 'planned' })],
      today,
    });
    expect(office.checkpoints[0].committed.score?.met).toBe(true);
    expect(remote.checkpoints[0].committed.score?.met).toBe(false);
  });
});
