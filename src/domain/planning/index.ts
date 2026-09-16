import { addDays } from '../dates';
import { forecast, type Snapshot } from '../projection';
import { type Entry, policySchema } from '../schema';

export type Suggestion = {
  state: 'ready' | 'unnecessary' | 'conflict' | 'limited' | 'invalid';
  dates: string[];
  explanation: string;
  alternatives: string[];
};
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
  const succeeds = (dates: string[]) => {
    const result = forecast({
      ...snapshot,
      records: [...snapshot.records, ...simulatedEntries(dates)],
    });
    // Also preserve provisional targets when there is no formal checkpoint in the horizon.
    return result.checkpoints.every((point) => point.committed.score?.met);
  };
  if (succeeds([]))
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
  let dates = [...initial.availableDates];
  for (let i = dates.length - 1; i >= 0; i--) {
    const candidate = dates.filter((_, index) => index !== i);
    if (succeeds(candidate)) dates = candidate;
  }
  if (!succeeds(dates))
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
