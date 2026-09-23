import { addDays, startOfWeek, weekday } from '../dates';
import { formulas } from '../policies';
import { forecast, type Forecast, type Snapshot } from '../projection';
import { type Entry, policySchema, type Policy } from '../schema';

export type Suggestion = {
  state: 'ready' | 'unnecessary' | 'conflict' | 'limited' | 'invalid';
  dates: string[];
  explanation: string;
  alternatives: string[];
};

export type WeeklyRecommendation = {
  weekStart: string;
  officeDays: number;
  additionalDays: number;
  minimumDays: number;
  baselineDays: number;
  baselineAdditionalDays: number;
  flexibleMinimumDays: number;
  withMoreThisWeek?: { minimumDays: number; currentWeekDays: number };
};
export type WeeklyRecommendations = {
  state: Suggestion['state'];
  weeks: WeeklyRecommendation[];
};

export function recommendWeeks(snapshot: Snapshot): WeeklyRecommendations {
  const parsed = policySchema.safeParse(snapshot.policy);
  const initial = forecast(snapshot);
  if (!parsed.success || initial.state === 'invalid') return { state: 'invalid', weeks: [] };
  if (initial.checkpoints.some((point) => !point.capacity.score?.met))
    return { state: 'conflict', weeks: [] };
  const policy = parsed.data;
  const alreadyCovered = meetsAllCheckpoints(snapshot, []);
  let additions: string[] = [];
  if (!alreadyCovered) {
    const requiredWeekdays =
      policy.kind === 'weekdays' ? new Set<number>(policy.requiredDays) : null;
    const committed = new Map(
      initial.checkpoints.map((point) => [point.weekStart, point.committedDates.length]),
    );
    const eligibleDates = initial.availableDates.filter(
      (date) => !requiredWeekdays || requiredWeekdays.has(weekday(date)),
    );
    const startCap = policy.kind === 'weekdays' ? policy.requiredDays.length : policy.n;
    let feasible: string[] | null = null;
    for (let cap = startCap; cap <= 7; cap++) {
      const selected = new Map<string, number>();
      const candidate = requiredWeekdays
        ? eligibleDates
        : eligibleDates.filter((date) => {
            const start = startOfWeek(date, policy.weekStart);
            const count = selected.get(start) ?? 0;
            if (count >= Math.max(0, cap - (committed.get(start) ?? 0))) return false;
            selected.set(start, count + 1);
            return true;
          });
      if (meetsAllCheckpoints(snapshot, candidate)) {
        feasible = candidate;
        break;
      }
      if (requiredWeekdays) break;
    }
    if (!feasible) return { state: 'limited', weeks: [] };
    additions = minimizeDates(snapshot, feasible);
  }
  const weeks = initial.checkpoints.map((point) => {
    const additionalDays = additions.filter(
      (date) => date >= point.weekStart && date <= point.end,
    ).length;
    return {
      weekStart: point.weekStart,
      officeDays: point.committedDates.length + additionalDays,
      additionalDays,
      minimumDays: minimumDaysForWeek(policy, initial, point.weekStart),
    };
  });
  const frequency = policy.kind === 'weekdays' ? policy.requiredDays.length : policy.n;
  const baseline = new Map(
    weeks.map((week, index) => [
      week.weekStart,
      Math.max(
        week.officeDays,
        Math.min(
          frequency,
          initial.checkpoints[index].committedDates.length +
            initial.checkpoints[index].availableDates.length,
        ),
      ),
    ]),
  );
  const currentStart = startOfWeek(snapshot.today, policy.weekStart);
  const currentWeek = weeks.find((week) => week.weekStart === currentStart);
  const currentBaseline = baseline.get(currentStart);
  const expected = new Map(baseline);
  if (currentWeek) expected.set(currentStart, currentWeek.officeDays);
  return {
    state: alreadyCovered ? 'unnecessary' : 'ready',
    weeks: weeks.map((week) => {
      const baselineDays = baseline.get(week.weekStart)!;
      const flexibleMinimumDays = minimumDaysForWeek(policy, initial, week.weekStart, expected);
      let withMoreThisWeek: WeeklyRecommendation['withMoreThisWeek'];
      if (
        currentWeek &&
        currentBaseline !== undefined &&
        week.weekStart > currentStart &&
        currentWeek.officeDays < currentBaseline
      ) {
        const minimumWithBaseline = minimumDaysForWeek(policy, initial, week.weekStart, baseline);
        if (minimumWithBaseline < flexibleMinimumDays) {
          for (let count = currentWeek.officeDays + 1; count <= currentBaseline; count++) {
            const alternative = new Map(expected).set(currentStart, count);
            if (
              minimumDaysForWeek(policy, initial, week.weekStart, alternative) <=
              minimumWithBaseline
            ) {
              withMoreThisWeek = { minimumDays: minimumWithBaseline, currentWeekDays: count };
              break;
            }
          }
          if (!withMoreThisWeek) throw new Error('Unable to determine the current-week trade-off.');
        }
      }
      return {
        ...week,
        baselineDays,
        baselineAdditionalDays: baselineDays - (week.officeDays - week.additionalDays),
        flexibleMinimumDays,
        ...(withMoreThisWeek && { withMoreThisWeek }),
      };
    }),
  };
}

function minimumDaysForWeek(
  policy: Policy,
  outlook: Forecast,
  start: string,
  baseline?: ReadonlyMap<string, number>,
): number {
  const affected = outlook.checkpoints.filter((point) =>
    point.capacity.weeks.some((week) => week.start === start),
  );
  for (let count = 0; count <= 7; count++) {
    if (
      affected.every(
        (point) =>
          formulas[policy.kind].evaluate(
            policy,
            point.capacity.weeks.map((week) => {
              if (week.start === start)
                return {
                  ...week,
                  count,
                  missingDays: policy.kind === 'weekdays' ? policy.requiredDays.slice(count) : [],
                };
              const expected = policy.kind === 'weekdays' ? undefined : baseline?.get(week.start);
              return expected === undefined ? week : { ...week, count: expected };
            }),
            point.capacity.eligibleCompleted,
          ).met,
      )
    )
      return count;
  }
  throw new Error('Unable to determine the minimum attendance for this week.');
}

function meetsAllCheckpoints(snapshot: Snapshot, dates: string[]): boolean {
  return forecast({
    ...snapshot,
    records: [...snapshot.records, ...simulatedEntries(dates)],
  }).checkpoints.every((point) => point.committed.score?.met);
}

function minimizeDates(snapshot: Snapshot, dates: string[]): string[] {
  let remaining = dates;
  for (let index = remaining.length - 1; index >= 0; index--) {
    const candidate = remaining.filter((_, position) => position !== index);
    if (meetsAllCheckpoints(snapshot, candidate)) remaining = candidate;
  }
  return remaining;
}

export function simulatedEntries(dates: readonly string[]): Entry[] {
  return dates.map((date) => ({
    date,
    type: 'office',
    status: 'planned',
    priority: 'normal',
    notes: '',
    revision: 1,
    createdAt: '2000-01-01T00:00:00.000Z',
    updatedAt: '2000-01-01T00:00:00.000Z',
  }));
}

export function suggest(snapshot: Snapshot): Suggestion {
  const parsed = policySchema.safeParse(snapshot.policy);
  const initial = forecast(snapshot);
  if (!parsed.success || initial.state === 'invalid')
    return {
      state: 'invalid',
      dates: [],
      alternatives: [],
      explanation: 'Unable to evaluate the policy.',
    };
  if (meetsAllCheckpoints(snapshot, []))
    return {
      state: 'unnecessary',
      dates: [],
      alternatives: [],
      explanation: 'No additional dates are needed within this horizon.',
    };
  if (initial.checkpoints.some((point) => !point.capacity.score?.met)) {
    const alternatives = snapshot.records
      .filter(
        (entry) =>
          entry.date >= snapshot.today &&
          entry.date <= initial.end &&
          entry.type === 'remote' &&
          entry.status === 'planned' &&
          entry.priority !== 'must',
      )
      .map((entry) => entry.date)
      .sort();
    return {
      state: 'conflict',
      dates: [],
      alternatives,
      explanation:
        'Available capacity cannot satisfy every checkpoint. Historical deficits cannot be repaired with future days. Review explicit remote plans separately; protected and leave dates will not be converted.',
    };
  }
  // Begin with a proven feasible capacity plan; remove later days while preserving every checkpoint.
  // This deterministic deletion search is feasible and locally minimal, not globally optimal.
  const dates = minimizeDates(snapshot, [...initial.availableDates]);
  if (!meetsAllCheckpoints(snapshot, dates))
    return {
      state: 'limited',
      dates: [],
      alternatives: [],
      explanation:
        'The search did not find a verified schedule. This is a search limitation, not proof of impossibility.',
    };
  return {
    state: 'ready',
    dates,
    alternatives: [],
    explanation: `A feasible ${dates.length}-day plan, verified at every checkpoint. Commitments are preserved; the search removes unnecessary days, keeping earlier dates where possible. It is not globally optimal.`,
  };
}

export function strategyLabel(
  snapshot: Snapshot,
  weekStart: string,
  added: readonly string[],
): 'Standard' | 'Load' | 'Protected Remote' {
  const parsed = policySchema.safeParse(snapshot.policy);
  if (!parsed.success) return 'Standard';
  const policy = parsed.data;
  const weekEnd = addDays(weekStart, 6);
  if (
    snapshot.records.some(
      (entry) =>
        entry.date >= weekStart &&
        entry.date <= weekEnd &&
        entry.type === 'remote' &&
        entry.priority === 'must',
    )
  )
    return 'Protected Remote';
  if (policy.kind !== 'rolling' || policy.mode !== 'average') return 'Standard';
  const weekAdded = added.filter((date) => date >= weekStart && date <= weekEnd);
  if (!weekAdded.length) return 'Standard';
  const before = forecast(snapshot);
  const after = forecast({
    ...snapshot,
    records: [...snapshot.records, ...simulatedEntries(weekAdded)],
  });
  const count =
    after.checkpoints.find((point) => point.weekStart === weekStart)?.committedDates.length ?? 0;
  const improved = after.checkpoints.some(
    (point, i) =>
      (point.committed.score?.achieved ?? 0) >
      (before.checkpoints[i]?.committed.score?.achieved ?? 0),
  );
  return count > policy.n && improved ? 'Load' : 'Standard';
}
