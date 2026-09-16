import Dexie, { type Table } from 'dexie';
import {
  backupSchema,
  civilDateSchema,
  emptyDataset,
  entrySchema,
  type Dataset,
  type Entry,
  type EntryInput,
  type Policy,
  type Preferences,
} from '../domain/schema';

export type Row = { date: string; revision: number; value: Entry | null };
export type Meta = {
  id: 'state';
  revision: number;
  generation: number;
  policy: Policy | null;
  preferences: Preferences;
};
export type StoredSnapshot = {
  dataset: Dataset;
  revisions: Record<string, number>;
  revision: number;
  generation: number;
};
export type Change = {
  date: string;
  expectedRevision: number;
  value: EntryInput | null;
  restoreRevision?: number;
  restoreCreatedAt?: string;
};
export type EditAction = {
  type: 'edit';
  generation: number;
  changes: Change[];
  expectedDatasetRevision?: number;
};
export type SettingsAction = {
  type: 'settings';
  expectedRevision: number;
  policy: Policy;
  preferences: Preferences;
};
export type ReplaceAction = { type: 'replace'; expectedRevision: number; dataset: Dataset };
export type Action = EditAction | SettingsAction | ReplaceAction;

const initialMeta = (): Meta => ({
  id: 'state',
  revision: 0,
  generation: 0,
  policy: null,
  preferences: { includeWeekends: false },
});

export class PlannerDB extends Dexie {
  records!: Table<Entry, string>;
  rows!: Table<Row, string>;
  meta!: Table<Meta, string>;

  constructor(name = 'rto-planner') {
    super(name);
    this.version(1).stores({ records: '&date', meta: '&id' });
    this.version(2)
      .stores({ records: '&date', rows: '&date', meta: '&id' })
      .upgrade(async (tx) => {
        const records = await tx.table<Entry>('records').toArray();
        const valid = records.map((entry) => entrySchema.parse(entry));
        await tx
          .table('rows')
          .bulkPut(valid.map((value) => ({ date: value.date, revision: value.revision, value })));
        const meta = await tx.table<Meta>('meta').get('state');
        if (meta)
          await tx
            .table('meta')
            .put({ ...meta, generation: meta.generation ?? 0, revision: meta.revision ?? 0 });
        await tx.table('records').clear();
      });
    // Dexie closes older connections on versionchange. The UI explicitly requests a reload.
  }
}

export class ConflictError extends Error {
  constructor() {
    super(
      'This data changed in another tab. Your edit was not saved. Export or discard the pending edit, then review the latest data before trying again.',
    );
  }
}

export class Repository {
  constructor(readonly db: PlannerDB) {}

  async read(): Promise<StoredSnapshot> {
    return this.db.transaction('r', this.db.rows, this.db.meta, async () => {
      const meta = (await this.db.meta.get('state')) ?? initialMeta();
      const rows = await this.db.rows.toArray();
      const dataset = backupSchema.parse({
        formatVersion: 1,
        records: rows.flatMap((row) => (row.value ? [row.value] : [])),
        policy: meta.policy,
        preferences: meta.preferences,
      });
      return {
        dataset,
        revisions: Object.fromEntries(rows.map((row) => [row.date, row.revision])),
        revision: meta.revision,
        generation: meta.generation,
      };
    });
  }

  async perform(action: Action, now = new Date().toISOString()): Promise<EditAction | null> {
    return this.db.transaction('rw', this.db.rows, this.db.meta, async () => {
      const meta = (await this.db.meta.get('state')) ?? initialMeta();
      if (action.type === 'edit') {
        if (meta.generation !== action.generation) throw new ConflictError();
        if (
          action.expectedDatasetRevision !== undefined &&
          meta.revision !== action.expectedDatasetRevision
        )
          throw new ConflictError();
        if (new Set(action.changes.map((change) => change.date)).size !== action.changes.length)
          throw new Error('Duplicate dates in one edit.');
        const undo: Change[] = [];
        for (const change of action.changes) {
          civilDateSchema.parse(change.date);
          const previous = await this.db.rows.get(change.date);
          if ((previous?.revision ?? 0) !== change.expectedRevision) throw new ConflictError();
          if (change.value && change.value.date !== change.date)
            throw new Error('Entry date does not match its key.');
          const prevValue = previous?.value ?? null;
          const same =
            change.value === null
              ? prevValue === null
              : prevValue !== null &&
                ['type', 'status', 'priority', 'notes'].every(
                  (key) =>
                    prevValue[key as keyof Entry] === change.value?.[key as keyof EntryInput],
                );
          if (same) continue;
          const revision = (previous?.revision ?? 0) + 1;
          const value = change.value
            ? entrySchema.parse({
                ...change.value,
                revision,
                createdAt: change.restoreCreatedAt ?? prevValue?.createdAt ?? now,
                updatedAt: now,
              })
            : null;
          await this.db.rows.put({ date: change.date, revision, value });
          undo.push({
            date: change.date,
            expectedRevision: revision,
            value: prevValue ? toInput(prevValue) : null,
            restoreRevision: previous?.revision ?? 0,
            restoreCreatedAt: prevValue?.createdAt,
          });
        }
        if (!undo.length) return null;
        await this.db.meta.put({ ...meta, revision: meta.revision + 1 });
        return { type: 'edit', generation: meta.generation, changes: undo };
      }
      if (meta.revision !== action.expectedRevision) throw new ConflictError();
      if (action.type === 'settings') {
        const valid = backupSchema.parse({
          ...emptyDataset(),
          policy: action.policy,
          preferences: action.preferences,
        });
        await this.db.meta.put({
          ...meta,
          policy: valid.policy,
          preferences: valid.preferences,
          revision: meta.revision + 1,
        });
      } else {
        const dataset = backupSchema.parse(action.dataset);
        await this.db.rows.clear();
        await this.db.rows.bulkPut(
          dataset.records.map((value) => ({ date: value.date, revision: value.revision, value })),
        );
        await this.db.meta.put({
          ...meta,
          policy: dataset.policy,
          preferences: dataset.preferences,
          revision: meta.revision + 1,
          generation: meta.generation + 1,
        });
      }
      return null;
    });
  }
}

export function toInput(entry: Entry): EntryInput {
  const { date, type, status, priority, notes } = entry;
  return { date, type, status, priority, notes };
}

export function advanceUndoStack(
  stack: EditAction[],
  applied: EditAction,
  inverse: EditAction | null,
): EditAction[] {
  const revisions = new Map(
    inverse?.changes.map((change) => [change.date, change.expectedRevision]),
  );
  const restored = new Map(applied.changes.map((change) => [change.date, change.restoreRevision]));
  return stack.slice(0, -1).map((previous) => ({
    ...previous,
    changes: previous.changes.map((change) => ({
      ...change,
      // Only join our own contiguous history; an intervening tab's revision stays stale.
      expectedRevision:
        change.expectedRevision === restored.get(change.date)
          ? (revisions.get(change.date) ?? change.expectedRevision)
          : change.expectedRevision,
    })),
  }));
}

export function editAction(
  snapshot: StoredSnapshot,
  values: { date: string; value: EntryInput | null }[],
): EditAction {
  return {
    type: 'edit',
    generation: snapshot.generation,
    changes: values.map((value) => ({
      ...value,
      expectedRevision: snapshot.revisions[value.date] ?? 0,
    })),
  };
}
