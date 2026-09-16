import { addDays, dateRange, daysBetween, firstEligibleWeek, startOfWeek, weekday } from '../dates';
import { policySchema, type Entry, type Policy } from '../schema';

export type Week = {
  start: string;
  end: string;
  officeDates: string[];
  count: number;
  missingDays: number[];
};
export type Score = { met: boolean; achieved: number; target: number; unit: string };
export type Evaluation = {
  state: 'not-started' | 'gathering' | 'initializing' | 'compliant' | 'shortfall' | 'invalid';
  explanation: string;
  weeks: Week[];
  score: Score | null;
  eligibleCompleted: number;
  firstEligible: string;
  windowStart?: string;
  windowEnd?: string;
};

export interface PolicyFormula {
  kind: Policy['kind'];
  label: string;
  validate: (value: unknown) => Policy;
  explain: (policy: Policy) => string;
  evaluate: (policy: Policy, weeks: Week[], eligibleCompleted: number) => Score;
  recommendationSupport: 'unknown-weekdays';
}

const names = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const weekdayName = (day: number) => names[day - 1];
export const policyWindow = (policy: Policy): number =>
  policy.kind === 'rolling' ? policy.y : policy.windowWeeks;
export const isWeekMet = (policy: Policy, week: Week): boolean =>
  policy.kind === 'weekdays' ? week.missingDays.length === 0 : week.count >= policy.n;

export const formulas: Record<Policy['kind'], PolicyFormula> = {
  rolling: {
    kind: 'rolling',
    label: 'Best X of Y weeks',
    validate: (value) => policySchema.parse(value),
    explain: (policy) => {
      if (policy.kind !== 'rolling') throw new Error('Incorrect formula configuration.');
      return policy.mode === 'qualifying'
        ? `At least ${policy.x} of the last ${policy.y} completed weeks need ${policy.n} office days each. Extra days cannot rescue another week.`
        : `The best ${policy.x} of the last ${policy.y} completed weeks need ${policy.x * policy.n} office days combined.`;
    },
    evaluate: (policy, weeks, eligible) => {
      if (policy.kind !== 'rolling') throw new Error('Incorrect formula configuration.');
      const required = Math.ceil((policy.x * Math.min(eligible, policy.y)) / policy.y);
      const achieved =
        policy.mode === 'qualifying'
          ? weeks.filter((week) => week.count >= policy.n).length
          : weeks
              .map((week) => week.count)
              .sort((a, b) => b - a)
              .slice(0, required)
              .reduce((sum, n) => sum + n, 0);
      const target = policy.mode === 'qualifying' ? required : required * policy.n;
      return {
        achieved,
        target,
        met: achieved >= target,
        unit: policy.mode === 'qualifying' ? 'qualifying weeks' : 'office days in best weeks',
      };
    },
    recommendationSupport: 'unknown-weekdays',
  },
  weekly: {
    kind: 'weekly',
    label: 'Minimum days each week',
    validate: (value) => policySchema.parse(value),
    explain: (policy) => {
      if (policy.kind !== 'weekly') throw new Error('Incorrect formula configuration.');
      return `Each completed week needs ${policy.n} office days, reported over ${policy.windowWeeks} weeks. Weeks cannot offset each other.`;
    },
    evaluate: (policy, weeks) => {
      const achieved = weeks.filter((week) => isWeekMet(policy, week)).length;
      return {
        achieved,
        target: weeks.length,
        met: achieved === weeks.length,
        unit: 'weeks meeting every obligation',
      };
    },
    recommendationSupport: 'unknown-weekdays',
  },
  weekdays: {
    kind: 'weekdays',
    label: 'Specific weekdays',
    validate: (value) => policySchema.parse(value),
    explain: (policy) => {
      if (policy.kind !== 'weekdays') throw new Error('Incorrect formula configuration.');
      return `Office attendance is required every ${policy.requiredDays.map(weekdayName).join(', ')}. Other weekdays cannot substitute.`;
    },
    evaluate: (policy, weeks) => {
      const achieved = weeks.filter((week) => isWeekMet(policy, week)).length;
      return {
        achieved,
        target: weeks.length,
        met: achieved === weeks.length,
        unit: 'weeks meeting every obligation',
      };
    },
    recommendationSupport: 'unknown-weekdays',
  },
};

export function weekFromDates(policy: Policy, start: string, dates: ReadonlySet<string>): Week {
  const officeDates = dateRange(start, addDays(start, 6), false).filter((date) => dates.has(date));
  return {
    start,
    end: addDays(start, 6),
    officeDates,
    count: officeDates.length,
    missingDays:
      policy.kind === 'weekdays'
        ? policy.requiredDays.filter((day) => !officeDates.some((date) => weekday(date) === day))
        : [],
  };
}

export function evaluateDates(
  policy: Policy,
  officeDates: ReadonlySet<string>,
  referenceDate: string,
): Evaluation {
  const firstEligible = firstEligibleWeek(policy.startDate, policy.weekStart);
  const current = startOfWeek(referenceDate, policy.weekStart);
  const starts: string[] = [];
  // Only the bounded reporting window is materialized, even for decades of history.
  for (
    let week = addDays(current, -7);
    week >= firstEligible && starts.length < policyWindow(policy);
    week = addDays(week, -7)
  ) {
    starts.unshift(week);
  }
  const weeks = starts.map((start) => weekFromDates(policy, start, officeDates));
  return evaluateWeeks(policy, weeks, referenceDate);
}

export function evaluateWeeks(policy: Policy, weeks: Week[], referenceDate: string): Evaluation {
  const firstEligible = firstEligibleWeek(policy.startDate, policy.weekStart);
  const current = startOfWeek(referenceDate, policy.weekStart);
  const eligibleCompleted = Math.max(0, daysBetween(firstEligible, current) / 7);
  const base = {
    weeks,
    eligibleCompleted,
    firstEligible,
    windowStart: weeks[0]?.start,
    windowEnd: weeks.at(-1)?.end,
  };
  if (referenceDate < policy.startDate)
    return {
      ...base,
      state: 'not-started',
      score: null,
      explanation: 'Not started. Enforcement is in the future.',
    };
  if (!eligibleCompleted)
    return {
      ...base,
      state: 'gathering',
      score: null,
      explanation: 'Gathering history. No full eligible policy week has completed.',
    };
  const score = formulas[policy.kind].evaluate(policy, weeks, eligibleCompleted);
  if (policy.kind === 'rolling' && eligibleCompleted < policy.y) {
    return {
      ...base,
      score,
      state: 'initializing',
      explanation: `Initializing: ${eligibleCompleted} of ${policy.y} full weeks completed. The scaled target is provisional, not a formal compliance result.`,
    };
  }
  return {
    ...base,
    score,
    state: score.met ? 'compliant' : 'shortfall',
    explanation: score.met
      ? 'Recorded actual attendance meets the completed-week requirement.'
      : 'Recorded actual attendance falls short in the completed evaluation window. Future attendance cannot rewrite history.',
  };
}

export function evaluate(
  policyValue: unknown,
  records: readonly Entry[],
  today: string,
): Evaluation {
  const result = policySchema.safeParse(policyValue);
  if (!result.success)
    return {
      state: 'invalid',
      explanation: result.error.issues.map((issue) => issue.message).join(' '),
      weeks: [],
      score: null,
      eligibleCompleted: 0,
      firstEligible: today,
    };
  const policy = result.data;
  const dates = new Set(
    records
      .filter(
        (entry) =>
          entry.type === 'office' &&
          entry.status === 'actual' &&
          entry.date <= today &&
          entry.date >= policy.startDate &&
          weekday(entry.date) <= 5,
      )
      .map((entry) => entry.date),
  );
  return evaluateDates(policy, dates, today);
}
