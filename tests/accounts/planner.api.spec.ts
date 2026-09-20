import { randomUUID } from 'node:crypto';
import type { Action, EditAction } from '../../src/data/model';
import {
  accountHeaders,
  dataset,
  entry,
  expect,
  jsonResponse,
  mutate,
  signup,
  snapshot,
  test,
} from './helpers';

test('owner data is separate and a cookie/account mismatch blocks reads, writes and logout', async ({
  createClient,
}) => {
  const first = await createClient();
  const second = await createClient();
  const { user: alice } = await signup(first);
  const { user: bob } = await signup(second);
  await jsonResponse(
    await mutate(first, alice, {
      type: 'edit',
      generation: 0,
      changes: [{ date: '2026-03-24', expectedRevision: 0, value: entry('2026-03-24') }],
    }),
  );
  const aliceSnapshot = await snapshot(first, alice);
  const bobSnapshot = await snapshot(second, bob);
  expect(bobSnapshot.dataset.records).toEqual([]);
  for (const headers of [{}, accountHeaders(alice)]) {
    await jsonResponse(await second.get('/api/planner', { headers }), 409);
    await jsonResponse(
      await second.post('/api/planner', {
        headers,
        data: {
          id: randomUUID(),
          action: { type: 'edit', generation: 0, changes: [] },
        },
      }),
      409,
    );
    const logout = await second.post('/api/auth/logout', { headers, data: {} });
    await jsonResponse(logout, 409);
    expect(logout.headers()['set-cookie']).toBeUndefined();
  }
  expect(await jsonResponse(await second.get('/api/session'))).toEqual({ user: bob });
  expect(await snapshot(first, alice)).toEqual(aliceSnapshot);
  expect(await snapshot(second, bob)).toEqual(bobSnapshot);
  await jsonResponse(
    await mutate(second, bob, {
      type: 'edit',
      generation: 0,
      changes: [
        {
          date: '2026-03-24',
          expectedRevision: 0,
          value: entry('2026-03-24', { type: 'remote', notes: 'Only Bob can read this.' }),
        },
      ],
    }),
  );
  expect((await snapshot(first, alice)).dataset.records[0].type).toBe('office');
  expect((await snapshot(second, bob)).dataset.records[0].type).toBe('remote');
});

test('edits persist revisions, replay exactly once, reject changed retries and support inverse edits', async ({
  createClient,
}) => {
  const client = await createClient();
  const { user } = await signup(client);
  expect(await snapshot(client, user)).toEqual({
    dataset: {
      formatVersion: 1,
      records: [],
      policy: null,
      preferences: { includeWeekends: false },
    },
    revision: 0,
    generation: 0,
    revisions: {},
  });
  const id = randomUUID();
  const action: EditAction = {
    type: 'edit',
    generation: 0,
    changes: ['2026-03-24', '2026-03-25'].map((date) => ({
      date,
      expectedRevision: 0,
      value: entry(date, { notes: 'Original note' }),
    })),
  };
  const first = await jsonResponse(await mutate(client, user, action, id));
  expect(first.snapshot).toMatchObject({
    revision: 1,
    generation: 0,
    revisions: { '2026-03-24': 1, '2026-03-25': 1 },
  });
  expect(first.snapshot.dataset.records).toHaveLength(2);
  expect(first.snapshot.dataset.records[0]).toMatchObject({
    ...entry('2026-03-24', { notes: 'Original note' }),
    revision: 1,
    createdAt: expect.any(String),
    updatedAt: expect.any(String),
  });
  expect(first.inverse).toEqual({
    type: 'edit',
    generation: 0,
    changes: action.changes.map(({ date }) => ({
      date,
      expectedRevision: 1,
      value: null,
      restoreRevision: 0,
    })),
  });
  expect(await jsonResponse(await mutate(client, user, action, id))).toEqual(first);
  expect(await snapshot(client, user)).toEqual(first.snapshot);
  expect(
    await jsonResponse(
      await mutate(
        client,
        user,
        {
          ...action,
          changes: [],
        },
        id,
      ),
      409,
    ),
  ).toEqual({ error: 'A retry cannot change the original edit.' });

  const unchanged = await jsonResponse(
    await mutate(client, user, {
      ...action,
      changes: action.changes.map((change) => ({ ...change, expectedRevision: 1 })),
    }),
  );
  expect(unchanged).toEqual({ snapshot: first.snapshot, inverse: null });
  const undone = await jsonResponse(await mutate(client, user, first.inverse));
  expect(undone.snapshot).toMatchObject({
    revision: 2,
    generation: 0,
    revisions: { '2026-03-24': 2, '2026-03-25': 2 },
    dataset: { records: [] },
  });
  const restored = await jsonResponse(await mutate(client, user, undone.inverse));
  expect(restored.snapshot.revision).toBe(3);
  expect(
    restored.snapshot.dataset.records.map((record: { createdAt: string }) => record.createdAt),
  ).toEqual(
    first.snapshot.dataset.records.map((record: { createdAt: string }) => record.createdAt),
  );
  expect(
    restored.snapshot.dataset.records.every(
      (record: { revision: number }) => record.revision === 3,
    ),
  ).toBe(true);
});

test('stale edits and partially stale batches are atomic and invalid mutations leave no changes', async ({
  createClient,
}) => {
  const client = await createClient();
  const { user } = await signup(client);
  const date = '2026-03-24';
  const action: EditAction = {
    type: 'edit',
    generation: 0,
    changes: [{ date, expectedRevision: 0, value: entry(date) }],
  };
  await jsonResponse(await mutate(client, user, action));
  const before = await snapshot(client, user);
  for (const stale of [
    action,
    { ...action, expectedDatasetRevision: 0, changes: [] },
    {
      ...action,
      changes: [
        { date: '2026-03-25', expectedRevision: 0, value: entry('2026-03-25') },
        ...action.changes,
      ],
    },
  ]) {
    await jsonResponse(await mutate(client, user, stale), 409);
    expect(await snapshot(client, user)).toEqual(before);
  }
  for (const invalid of [
    { ...action, changes: [action.changes[0], action.changes[0]] },
    { ...action, changes: [{ ...action.changes[0], value: entry('2026-03-25') }] },
    { ...action, changes: [{ ...action.changes[0], expectedRevision: -1 }] },
    { ...action, changes: [{ ...action.changes[0], date: '2026-02-30' }] },
    {
      ...action,
      changes: [{ ...action.changes[0], value: entry(date, { notes: 'x'.repeat(2001) }) }],
    },
    { ...action, userId: randomUUID() },
  ]) {
    await jsonResponse(
      await client.post('/api/planner', {
        headers: accountHeaders(user),
        data: { id: randomUUID(), action: invalid },
      }),
      400,
    );
  }
  await jsonResponse(
    await client.post('/api/planner', {
      headers: accountHeaders(user),
      data: { id: 'not-a-mutation-id', action },
    }),
    400,
  );
  await jsonResponse(
    await client.post('/api/planner', {
      headers: { ...accountHeaders(user), 'Content-Type': 'text/plain' },
      data: JSON.stringify({ id: randomUUID(), action }),
    }),
    415,
  );
  expect(await snapshot(client, user)).toEqual(before);
});

test('settings and full replacement use dataset revisions and invalidate pre-replacement generations', async ({
  createClient,
}) => {
  const client = await createClient();
  const { user } = await signup(client);
  const settings: Action = {
    type: 'settings',
    expectedRevision: 0,
    policy: dataset().policy!,
    preferences: { includeWeekends: true },
  };
  const configured = await jsonResponse(await mutate(client, user, settings));
  expect(configured).toMatchObject({
    inverse: null,
    snapshot: {
      revision: 1,
      generation: 0,
      dataset: { policy: settings.policy, preferences: settings.preferences },
    },
  });
  await jsonResponse(await mutate(client, user, settings), 409);
  await jsonResponse(
    await mutate(client, user, {
      type: 'edit',
      generation: 0,
      changes: [
        {
          date: '2026-03-24',
          expectedRevision: 0,
          value: entry('2026-03-24'),
        },
      ],
    }),
  );
  const replacement = dataset([entry('2026-03-26', { type: 'vacation', priority: 'must' })]);
  replacement.records[0].revision = 7;
  const replace: Action = { type: 'replace', expectedRevision: 2, dataset: replacement };
  const replaced = await jsonResponse(await mutate(client, user, replace));
  expect(replaced).toEqual({
    snapshot: {
      dataset: replacement,
      revision: 3,
      generation: 1,
      revisions: { '2026-03-26': 7 },
    },
    inverse: null,
  });
  await jsonResponse(await mutate(client, user, replace), 409);
  await jsonResponse(
    await mutate(client, user, {
      type: 'edit',
      generation: 0,
      changes: [{ date: '2026-03-24', expectedRevision: 0, value: entry('2026-03-24') }],
    }),
    409,
  );
  await jsonResponse(
    await client.post('/api/planner', {
      headers: accountHeaders(user),
      data: {
        id: randomUUID(),
        action: {
          type: 'replace',
          expectedRevision: 3,
          dataset: { ...replacement, records: [replacement.records[0], replacement.records[0]] },
        },
      },
    }),
    400,
  );
  expect(await snapshot(client, user)).toEqual(replaced.snapshot);
  const next = await jsonResponse(
    await mutate(client, user, {
      type: 'edit',
      generation: 1,
      changes: [{ date: '2026-03-26', expectedRevision: 7, value: null }],
    }),
  );
  expect(next.snapshot).toMatchObject({
    revision: 4,
    generation: 1,
    revisions: { '2026-03-26': 8 },
    dataset: { records: [] },
  });
});

test('D1 compare-and-swap rejects competing same-date writes but preserves disjoint concurrent edits', async ({
  createClient,
}) => {
  const client = await createClient();
  const { user } = await signup(client);
  const competitors = await Promise.all(
    ['office', 'remote'].map((type) =>
      mutate(client, user, {
        type: 'edit',
        generation: 0,
        changes: [
          {
            date: '2026-03-24',
            expectedRevision: 0,
            value: entry('2026-03-24', { type: type as 'office' | 'remote' }),
          },
        ],
      }),
    ),
  );
  expect(competitors.map((response) => response.status()).sort()).toEqual([200, 409]);
  const winner = await jsonResponse(competitors.find((response) => response.status() === 200)!);
  expect(await snapshot(client, user)).toEqual(winner.snapshot);
  const disjoint = await Promise.all(
    ['2026-03-25', '2026-03-26'].map((date) =>
      mutate(client, user, {
        type: 'edit',
        generation: 0,
        changes: [{ date, expectedRevision: 0, value: entry(date) }],
      }),
    ),
  );
  for (const response of disjoint) await jsonResponse(response);
  const final = await snapshot(client, user);
  expect(final.revision).toBe(3);
  expect(final.dataset.records.map((record) => record.date).sort()).toEqual([
    '2026-03-24',
    '2026-03-25',
    '2026-03-26',
  ]);
  expect(final.revisions).toEqual({ '2026-03-24': 1, '2026-03-25': 1, '2026-03-26': 1 });
});

test('simultaneous retries of the same mutation commit once and return the same inverse', async ({
  createClient,
}) => {
  const client = await createClient();
  const { user } = await signup(client);
  const id = randomUUID();
  const action: EditAction = {
    type: 'edit',
    generation: 0,
    changes: [{ date: '2026-03-24', expectedRevision: 0, value: entry('2026-03-24') }],
  };
  const responses = await Promise.all([
    mutate(client, user, action, id),
    mutate(client, user, action, id),
  ]);
  const bodies = await Promise.all(responses.map((response) => jsonResponse(response)));
  expect(bodies[0]).toEqual(bodies[1]);
  expect(bodies[0].snapshot.revision).toBe(1);
  expect(await snapshot(client, user)).toEqual(bodies[0].snapshot);
});

test('account storage counts UTF-8 snapshot and undo bytes and rejects oversized writes atomically', async ({
  createClient,
}) => {
  const client = await createClient();
  const { user } = await signup(client);
  const records = Array.from({ length: 700 }, (_, index) => {
    const date = new Date(Date.UTC(2024, 0, 1 + index)).toISOString().slice(0, 10);
    return entry(date, { notes: 'é'.repeat(1000) });
  });
  const initial = dataset(records.slice(0, 360));
  await jsonResponse(
    await mutate(client, user, {
      type: 'replace',
      expectedRevision: 0,
      dataset: initial,
    }),
  );
  const before = await snapshot(client, user);
  const edit: EditAction = {
    type: 'edit',
    generation: 1,
    changes: initial.records.map((record) => ({
      date: record.date,
      expectedRevision: 1,
      value: entry(record.date, { notes: 'ø'.repeat(1000) }),
    })),
  };
  const tooMuchUndo = await jsonResponse(await mutate(client, user, edit), 413);
  expect(tooMuchUndo.error).toContain('including revision and undo metadata');
  expect(await snapshot(client, user)).toEqual(before);
  await jsonResponse(
    await mutate(client, user, {
      type: 'replace',
      expectedRevision: 1,
      dataset: dataset(records),
    }),
    413,
  );
  expect(await snapshot(client, user)).toEqual(before);
  await jsonResponse(
    await client.post('/api/planner', {
      headers: accountHeaders(user),
      data: { padding: 'x'.repeat(2 * 1024 * 1024) },
    }),
    413,
  );
  expect(await snapshot(client, user)).toEqual(before);
});
