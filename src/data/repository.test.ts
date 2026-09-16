import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { type Entry, type EntryInput, emptyDataset } from '../domain/schema';
import {
  attendanceCSV,
  MAX_BACKUP_BYTES,
  parseBackup,
  serializeBackup,
} from '../features/backup/backup';
import {
  advanceUndoStack,
  ConflictError,
  editAction,
  PlannerDB,
  Repository,
  type EditAction,
} from './repository';

const databases: Dexie[] = [];
function create() {
  const db = new PlannerDB(`test-${crypto.randomUUID()}`);
  databases.push(db);
  return new Repository(db);
}
const value: EntryInput = {
  date: '2026-03-24',
  type: 'office',
  status: 'planned',
  priority: 'must',
  notes: 'Original note',
};
const record: Entry = {
  ...value,
  revision: 1,
  createdAt: '2026-03-01T00:00:00.000Z',
  updatedAt: '2026-03-01T00:00:00.000Z',
};
afterEach(async () => {
  for (const db of databases.splice(0)) await db.delete();
});

describe('atomic repository and revision conflicts', () => {
  it('paints idempotently and undoes erase including notes and priority', async () => {
    const repo = create();
    const initial = await repo.read();
    await repo.perform(editAction(initial, [{ date: value.date, value }]));
    const saved = await repo.read();
    expect(saved.dataset.records).toHaveLength(1);
    expect(await repo.perform(editAction(saved, [{ date: value.date, value }]))).toBeNull();
    expect((await repo.read()).revision).toBe(saved.revision);
    const undo = await repo.perform(editAction(saved, [{ date: value.date, value: null }]));
    expect((await repo.read()).dataset.records).toHaveLength(0);
    await repo.perform(undo!);
    expect((await repo.read()).dataset.records[0]).toMatchObject(value);
    expect((await repo.read()).dataset.records[0].createdAt).toBe(
      saved.dataset.records[0].createdAt,
    );
  });
  it('keeps repeated own undos valid without letting undo overwrite intervening tab edits', async () => {
    const repo = create();
    let stack: EditAction[] = [];
    const first = await repo.perform(editAction(await repo.read(), [{ date: value.date, value }]));
    stack.push(first!);
    const second = await repo.perform(
      editAction(await repo.read(), [{ date: value.date, value: { ...value, type: 'remote' } }]),
    );
    stack.push(second!);
    const inverse = await repo.perform(second!);
    stack = advanceUndoStack(stack, second!, inverse);
    await repo.perform(stack[0]);
    expect((await repo.read()).dataset.records).toHaveLength(0);

    stack = [];
    stack.push((await repo.perform(editAction(await repo.read(), [{ date: value.date, value }])))!);
    await repo.perform(
      editAction(await repo.read(), [{ date: value.date, value: { ...value, type: 'remote' } }]),
    );
    const mine = (await repo.perform(
      editAction(await repo.read(), [
        { date: value.date, value: { ...value, type: 'remote', notes: 'My later note' } },
      ]),
    ))!;
    stack.push(mine);
    const otherInverse = await repo.perform(mine);
    stack = advanceUndoStack(stack, mine, otherInverse);
    await expect(repo.perform(stack[0])).rejects.toBeInstanceOf(ConflictError);
    expect((await repo.read()).dataset.records[0].type).toBe('remote');
  });
  it('rejects stale edits, including absent -> present -> absent ABA conflicts', async () => {
    const repo = create();
    const initial = await repo.read();
    await repo.perform(editAction(initial, [{ date: value.date, value }]));
    await expect(
      repo.perform(
        editAction(initial, [{ date: value.date, value: { ...value, type: 'remote' } }]),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
    await repo.perform(editAction(await repo.read(), [{ date: value.date, value: null }]));
    await expect(
      repo.perform(editAction(initial, [{ date: value.date, value }])),
    ).rejects.toBeInstanceOf(ConflictError);
  });
  it('permits independent per-record edits and rejects stale replacement or plan preview', async () => {
    const repo = create();
    const initial = await repo.read();
    await repo.perform(editAction(initial, [{ date: value.date, value }]));
    const other = { ...value, date: '2026-03-25' };
    await repo.perform(editAction(initial, [{ date: other.date, value: other }]));
    await expect(
      repo.perform({
        type: 'replace',
        expectedRevision: initial.revision,
        dataset: emptyDataset(),
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      repo.perform({ ...editAction(initial, []), expectedDatasetRevision: initial.revision }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
  it('rolls back a whole range on quota failure and retains old records', async () => {
    const repo = create();
    await repo.perform(editAction(await repo.read(), [{ date: value.date, value }]));
    const previous = await repo.read();
    repo.db.rows.hook('creating', (_key, row) => {
      if (row.date === '2026-03-26') throw new DOMException('Storage full', 'QuotaExceededError');
    });
    await expect(
      repo.perform(
        editAction(previous, [
          { date: value.date, value: null },
          { date: '2026-03-25', value: { ...value, date: '2026-03-25' } },
          { date: '2026-03-26', value: { ...value, date: '2026-03-26' } },
        ]),
      ),
    ).rejects.toThrow('Storage full');
    expect(await repo.read()).toEqual(previous);
  });
  it('rejects malformed replacement before deleting any existing data', async () => {
    const repo = create();
    await repo.perform(editAction(await repo.read(), [{ date: value.date, value }]));
    const before = await repo.read();
    await expect(
      repo.perform({
        type: 'replace',
        expectedRevision: before.revision,
        dataset: { ...emptyDataset(), records: [record, record] },
      }),
    ).rejects.toThrow();
    expect(await repo.read()).toEqual(before);
  });
  it('replaces atomically, invalidates old generation edits, and round-trips backups', async () => {
    const repo = create();
    const before = await repo.read();
    const backup = { ...emptyDataset(), records: [record], preferences: { includeWeekends: true } };
    await repo.perform({
      type: 'replace',
      expectedRevision: 0,
      dataset: parseBackup(serializeBackup(backup)),
    });
    expect((await repo.read()).dataset).toEqual(backup);
    await expect(
      repo.perform(
        editAction(before, [{ date: '2026-03-25', value: { ...value, date: '2026-03-25' } }]),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });
  it('migrates v1 source records without losing dates, notes, protection, or settings', async () => {
    const name = `migration-${crypto.randomUUID()}`;
    const old = new Dexie(name);
    old.version(1).stores({ records: '&date', meta: '&id' });
    await old.table('records').put(record);
    await old
      .table('meta')
      .put({ id: 'state', revision: 3, policy: null, preferences: { includeWeekends: true } });
    old.close();
    const db = new PlannerDB(name);
    databases.push(db);
    const result = await new Repository(db).read();
    expect(result.dataset.records).toEqual([record]);
    expect(result.dataset.preferences.includeWeekends).toBe(true);
    expect(result.revision).toBe(3);
  });
  it('retains v1 data when a migration fails validation', async () => {
    const name = `failed-migration-${crypto.randomUUID()}`;
    const old = new Dexie(name);
    old.version(1).stores({ records: '&date', meta: '&id' });
    await old.table('records').put({ ...record, date: 'bad-date' });
    old.close();
    const upgrade = new PlannerDB(name);
    await expect(upgrade.open()).rejects.toThrow();
    upgrade.close();
    const unchanged = new Dexie(name);
    databases.push(unchanged);
    unchanged.version(1).stores({ records: '&date', meta: '&id' });
    expect(await unchanged.table('records').toArray()).toEqual([{ ...record, date: 'bad-date' }]);
  });
});

describe('portable backups', () => {
  it('rejects corrupt, duplicate, invalid and oversized imports', () => {
    expect(() => parseBackup('{')).toThrow('not valid JSON');
    expect(() => parseBackup('{}', MAX_BACKUP_BYTES + 1)).toThrow('5 MB');
    for (const data of [
      { ...emptyDataset(), formatVersion: 2 },
      { ...emptyDataset(), records: [record, record] },
      { ...emptyDataset(), records: [{ ...record, type: 'unknown' }] },
      { ...emptyDataset(), records: [{ ...record, date: '2026-02-29' }] },
    ])
      expect(() => parseBackup(JSON.stringify(data))).toThrow('Invalid backup');
  });
  it('quotes CSV and prevents notes from being spreadsheet formulas', () => {
    const csv = attendanceCSV({
      ...emptyDataset(),
      records: [{ ...record, notes: '=HYPERLINK("bad")' }],
    });
    expect(csv).toContain('"\'=HYPERLINK(""bad"")"');
    expect(csv).not.toContain('formatVersion');
  });
});
