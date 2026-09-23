import { z } from 'zod';
import { isCivilDate, isTimeZone } from './dates';

export const civilDateSchema = z
  .string()
  .refine(isCivilDate, 'Use a real date in YYYY-MM-DD format.');
const weekStartSchema = z.union([z.literal(1), z.literal(6), z.literal(7)]);
const basePolicy = {
  startDate: civilDateSchema,
  timeZone: z
    .string()
    .refine(isTimeZone, 'Enter a valid IANA timezone, for example America/Los_Angeles.'),
  weekStart: weekStartSchema,
};
const count = z.number().int().min(1).max(52);
const officeTarget = z.number().int().min(1).max(5);
export const policySchema = z
  .discriminatedUnion('kind', [
    z
      .object({
        ...basePolicy,
        kind: z.literal('rolling'),
        mode: z.enum(['qualifying', 'average']),
        x: count,
        y: count,
        n: officeTarget,
      })
      .strict(),
    z
      .object({
        ...basePolicy,
        kind: z.literal('weekly'),
        n: officeTarget,
        windowWeeks: count.default(4),
      })
      .strict(),
    z
      .object({
        ...basePolicy,
        kind: z.literal('weekdays'),
        requiredDays: z
          .array(z.number().int().min(1).max(5))
          .min(1)
          .max(5)
          .refine(
            (days) => new Set(days).size === days.length,
            'Required weekdays must be unique.',
          ),
        windowWeeks: count.default(4),
      })
      .strict(),
  ])
  .superRefine((policy, ctx) => {
    if (policy.kind === 'rolling' && policy.x > policy.y) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['x'],
        message: 'Best weeks cannot exceed the total weeks in the window.',
      });
    }
  });
export type Policy = z.infer<typeof policySchema>;
export const dayTypes = ['office', 'remote', 'vacation', 'sick', 'holiday'] as const;
export const entrySchema = z
  .object({
    date: civilDateSchema,
    type: z.enum(dayTypes),
    status: z.enum(['actual', 'planned']),
    priority: z.enum(['normal', 'must']),
    notes: z.string().max(2000),
    revision: z.number().int().min(1),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type Entry = z.infer<typeof entrySchema>;
export type EntryInput = Pick<Entry, 'date' | 'type' | 'status' | 'priority' | 'notes'>;
export type DayType = Entry['type'];
export const preferencesSchema = z.object({ includeWeekends: z.boolean() }).strict();
export type Preferences = z.infer<typeof preferencesSchema>;
export const backupSchema = z
  .object({
    formatVersion: z.literal(1),
    records: z.array(entrySchema).max(100000),
    policy: policySchema.nullable(),
    preferences: preferencesSchema,
  })
  .strict()
  .superRefine((backup, ctx) => {
    if (new Set(backup.records.map((entry) => entry.date)).size !== backup.records.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['records'],
        message: 'Duplicate attendance dates.',
      });
    }
  });
export type Dataset = z.infer<typeof backupSchema>;
export const emptyDataset = (): Dataset => ({
  formatVersion: 1,
  records: [],
  policy: null,
  preferences: { includeWeekends: false },
});
export const defaultPolicy = (today: string, timeZone: string): Policy => ({
  kind: 'rolling',
  mode: 'average',
  x: 8,
  y: 12,
  n: 3,
  startDate: today,
  timeZone,
  weekStart: 7,
});
