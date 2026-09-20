import Dexie, { type Table } from 'dexie';
import {
  backupSchema,
  entrySchema,
  type Entry,
  type Policy,
  type Preferences,
} from '../domain/schema';
import {
  applyAction,
  type Action,
  type Change,
  type EditAction,
  type StoredSnapshot,
} from './model';
export { ConflictError, toInput } from './model';
export type {
  Action,
  Change,
  EditAction,
  SettingsAction,
  ReplaceAction,
  StoredSnapshot,
} from './model';

export type Row = { date: string; revision: number; value: Entry | null };
export type Meta = {
  id: 'state';
  revision: number;
  generation: number;
  policy: Policy | null;
  preferences: Preferences;
};

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
      const current = await this.read();
      const { snapshot, inverse, changedDates } = applyAction(current, action, now);
      if (snapshot === current) return null;
      const records = new Map(snapshot.dataset.records.map((entry) => [entry.date, entry]));
      if (action.type === 'replace') {
        await this.db.rows.clear();
        await this.db.rows.bulkPut(
          snapshot.dataset.records.map((value) => ({
            date: value.date,
            revision: value.revision,
            value,
          })),
        );
      } else {
        for (const date of changedDates)
          await this.db.rows.put({
            date,
            revision: snapshot.revisions[date],
            value: records.get(date) ?? null,
          });
      }
      await this.db.meta.put({
        id: 'state',
        policy: snapshot.dataset.policy,
        preferences: snapshot.dataset.preferences,
        revision: snapshot.revision,
        generation: snapshot.generation,
      });
      return inverse;
    });
  }
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
  values: Pick<Change, 'date' | 'value'>[],
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
