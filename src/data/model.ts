import { z } from 'zod';
import {
  backupSchema,
  civilDateSchema,
  emptyDataset,
  entrySchema,
  policySchema,
  preferencesSchema,
  type Entry,
  type EntryInput,
} from '../domain/schema';

const revisionSchema = z.number().int().nonnegative().safe();
const inputSchema = entrySchema.pick({
  date: true,
  type: true,
  status: true,
  priority: true,
  notes: true,
});
export const editActionSchema = z
  .object({
    type: z.literal('edit'),
    generation: revisionSchema,
    changes: z
      .array(
        z
          .object({
            date: civilDateSchema,
            expectedRevision: revisionSchema,
            value: inputSchema.nullable(),
            restoreRevision: revisionSchema.optional(),
            restoreCreatedAt: z.string().datetime().optional(),
          })
          .strict(),
      )
      .max(100000),
    expectedDatasetRevision: revisionSchema.optional(),
  })
  .strict();
export const actionSchema = z.discriminatedUnion('type', [
  editActionSchema,
  z
    .object({
      type: z.literal('settings'),
      expectedRevision: revisionSchema,
      policy: policySchema,
      preferences: preferencesSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('replace'),
      expectedRevision: revisionSchema,
      dataset: backupSchema,
    })
    .strict(),
]);
export const snapshotSchema = z
  .object({
    dataset: backupSchema,
    revisions: z.record(civilDateSchema, revisionSchema),
    revision: revisionSchema,
    generation: revisionSchema,
  })
  .strict();
export type StoredSnapshot = z.infer<typeof snapshotSchema>;
export type EditAction = z.infer<typeof editActionSchema>;
export type Change = EditAction['changes'][number];
export type Action = z.infer<typeof actionSchema>;
export type SettingsAction = Extract<Action, { type: 'settings' }>;
export type ReplaceAction = Extract<Action, { type: 'replace' }>;

export interface PlannerRepository {
  read(): Promise<StoredSnapshot>;
  perform(action: Action): Promise<EditAction | null>;
}

export const emptySnapshot = (): StoredSnapshot => ({
  dataset: emptyDataset(),
  revisions: {},
  revision: 0,
  generation: 0,
});

export class ConflictError extends Error {
  constructor() {
    super(
      'This data changed in another tab or device. Your edit was not saved. Export or discard the pending edit, then refresh and review the latest data before trying again.',
    );
  }
}

export function toInput(entry: Entry): EntryInput {
  const { date, type, status, priority, notes } = entry;
  return { date, type, status, priority, notes };
}

export function applyAction(
  current: StoredSnapshot,
  action: Action,
  now = new Date().toISOString(),
): { snapshot: StoredSnapshot; inverse: EditAction | null; changedDates: string[] } {
  if (action.type === 'edit') {
    if (
      current.generation !== action.generation ||
      (action.expectedDatasetRevision !== undefined &&
        current.revision !== action.expectedDatasetRevision)
    )
      throw new ConflictError();
    if (new Set(action.changes.map((change) => change.date)).size !== action.changes.length)
      throw new Error('Duplicate dates in one edit.');
    const records = new Map(current.dataset.records.map((entry) => [entry.date, entry]));
    const revisions = { ...current.revisions };
    const undo: Change[] = [];
    for (const change of action.changes) {
      civilDateSchema.parse(change.date);
      if ((revisions[change.date] ?? 0) !== change.expectedRevision) throw new ConflictError();
      if (change.value && change.value.date !== change.date)
        throw new Error('Entry date does not match its key.');
      const previous = records.get(change.date) ?? null;
      const same =
        change.value === null
          ? previous === null
          : previous !== null &&
            ['type', 'status', 'priority', 'notes'].every(
              (key) => previous[key as keyof Entry] === change.value?.[key as keyof EntryInput],
            );
      if (same) continue;
      const revision = (revisions[change.date] ?? 0) + 1;
      if (change.value)
        records.set(
          change.date,
          entrySchema.parse({
            ...change.value,
            revision,
            createdAt: change.restoreCreatedAt ?? previous?.createdAt ?? now,
            updatedAt: now,
          }),
        );
      else records.delete(change.date);
      revisions[change.date] = revision;
      undo.push({
        date: change.date,
        expectedRevision: revision,
        value: previous ? toInput(previous) : null,
        restoreRevision: current.revisions[change.date] ?? 0,
        restoreCreatedAt: previous?.createdAt,
      });
    }
    if (!undo.length) return { snapshot: current, inverse: null, changedDates: [] };
    return {
      snapshot: {
        ...current,
        dataset: { ...current.dataset, records: [...records.values()] },
        revisions,
        revision: current.revision + 1,
      },
      inverse: { type: 'edit', generation: current.generation, changes: undo },
      changedDates: undo.map((change) => change.date),
    };
  }
  if (current.revision !== action.expectedRevision) throw new ConflictError();
  const dataset = backupSchema.parse(
    action.type === 'replace'
      ? action.dataset
      : {
          ...current.dataset,
          policy: action.policy,
          preferences: action.preferences,
        },
  );
  return {
    snapshot: {
      dataset,
      revision: current.revision + 1,
      generation: current.generation + (action.type === 'replace' ? 1 : 0),
      revisions:
        action.type === 'replace'
          ? Object.fromEntries(dataset.records.map((entry) => [entry.date, entry.revision]))
          : current.revisions,
    },
    inverse: null,
    changedDates: [],
  };
}
