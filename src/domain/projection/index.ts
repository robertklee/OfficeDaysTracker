import { addDays, dateRange, firstEligibleWeek, startOfWeek, weekday } from '../dates';
import {
  evaluateWeeks,
  policyWindow,
  weekFromDates,
  type Evaluation,
  type Week,
} from '../policies';
import { policySchema, type Entry } from '../schema';

export type Checkpoint = {
  weekStart: string;
  end: string;
  formal: boolean;
  committed: Evaluation;
  capacity: Evaluation;
  availableDates: string[];
  committedDates: string[];
  expiringWeeks: string[];
};
export type Forecast = {
  state: 'on-track' | 'planning' | 'conflict' | 'gathering' | 'invalid';
  explanation: string;
  checkpoints: Checkpoint[];
  firstAffected?: Checkpoint;
  firstAdvisory?: Checkpoint;
  end: string;
  horizonWeeks: number;
  availableDates: string[];
};
export type Snapshot = { policy: unknown; records: readonly Entry[]; today: string };

export function forecast(snapshot: Snapshot): Forecast {
  const parsed = policySchema.safeParse(snapshot.policy);
  if (!parsed.success)
    return {
      state: 'invalid',
      explanation: 'Unable to evaluate: invalid or unsupported policy.',
      checkpoints: [],
      end: snapshot.today,
      horizonWeeks: 0,
      availableDates: [],
    };
  const policy = parsed.data;
  const horizonWeeks = Math.max(12, policyWindow(policy));
  const currentWeek = startOfWeek(snapshot.today, policy.weekStart);
  const end = addDays(currentWeek, horizonWeeks * 7 + 6);
  const first = firstEligibleWeek(policy.startDate, policy.weekStart);
  const records = new Map(snapshot.records.map((entry) => [entry.date, entry]));
  const committed = new Set(
    snapshot.records
      .filter(
        (entry) =>
          entry.type === 'office' &&
          entry.date >= policy.startDate &&
          weekday(entry.date) <= 5 &&
          ((entry.status === 'actual' && entry.date <= snapshot.today) ||
            (entry.status === 'planned' && entry.date >= snapshot.today)),
      )
      .map((entry) => entry.date),
  );
  const availableDates = dateRange(snapshot.today, end, false).filter(
    (date) => date >= first && !records.has(date),
  );
  const capacity = new Set([...committed, ...availableDates]);
  const checkpoints: Checkpoint[] = [];
  const committedWeeks: Week[] = [];
  const capacityWeeks: Week[] = [];
  const historyStart = addDays(currentWeek, -policyWindow(policy) * 7);
  for (
    let start = historyStart > first ? historyStart : first;
    start <= end;
    start = addDays(start, 7)
  ) {
    committedWeeks.push(weekFromDates(policy, start, committed));
    capacityWeeks.push(weekFromDates(policy, start, capacity));
  }
  for (let start = currentWeek; start <= end; start = addDays(start, 7)) {
    if (start < first) continue;
    const checkpointEnd = addDays(start, 6);
    const evaluationDate = addDays(checkpointEnd, 1);
    const windowStart = addDays(start, -(policyWindow(policy) - 1) * 7);
    const planned = evaluateWeeks(
      policy,
      committedWeeks.filter((week) => week.start >= windowStart && week.start <= start),
      evaluationDate,
    );
    const possible = evaluateWeeks(
      policy,
      capacityWeeks.filter((week) => week.start >= windowStart && week.start <= start),
      evaluationDate,
    );
    const formal = planned.state === 'compliant' || planned.state === 'shortfall';
    const expiringStart = addDays(start, -policyWindow(policy) * 7);
    const prior = committedWeeks.find((week) => week.start === expiringStart);
    checkpoints.push({
      weekStart: start,
      end: checkpointEnd,
      formal,
      committed: planned,
      capacity: possible,
      availableDates: availableDates.filter((date) => date >= start && date <= checkpointEnd),
      committedDates: [...committed]
        .filter((date) => date >= start && date <= checkpointEnd)
        .sort(),
      expiringWeeks:
        policy.kind === 'rolling' && prior && prior.count >= policy.n ? [prior.start] : [],
    });
  }
  const formal = checkpoints.filter((checkpoint) => checkpoint.formal);
  const firstAffected = formal.find((checkpoint) => !checkpoint.committed.score?.met);
  const firstAdvisory = checkpoints.find((checkpoint) => !checkpoint.committed.score?.met);
  const conflict = formal.some((checkpoint) => !checkpoint.capacity.score?.met);
  const state = !formal.length
    ? 'gathering'
    : conflict
      ? 'conflict'
      : firstAffected
        ? 'planning'
        : 'on-track';
  const explanation = {
    'on-track': 'On track under recorded plan',
    planning: 'More planning needed',
    conflict: 'Plan conflicts with policy',
    gathering: 'Gathering history / not started',
  }[state];
  return {
    state,
    explanation,
    checkpoints,
    firstAffected,
    firstAdvisory,
    end,
    horizonWeeks,
    availableDates,
  };
}
