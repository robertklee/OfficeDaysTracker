import {
  expect,
  jsonResponse,
  mutate,
  PASSWORD,
  signup,
  snapshot,
  test,
  username,
} from './helpers';

function retryAfter(headers: Record<string, string>, maximum: number) {
  expect(headers['retry-after']).toMatch(/^\d+$/);
  expect(Number(headers['retry-after'])).toBeGreaterThan(0);
  expect(Number(headers['retry-after'])).toBeLessThanOrEqual(maximum);
}

for (const [path, limit, seconds] of [
  ['/api/auth/signup', 5, 3600],
  ['/api/auth/login', 20, 900],
] as const) {
  test(`${path} throttles the client IP after ${limit} attempts, including invalid input`, async ({
    createClient,
  }) => {
    const client = await createClient();
    for (let attempt = 0; attempt < limit; attempt++) {
      await jsonResponse(await client.post(path, { data: {} }), 400);
    }
    const blocked = await client.post(path, { data: {} });
    expect(await jsonResponse(blocked, 429)).toEqual({
      error: 'Too many attempts. Try again later.',
    });
    retryAfter(blocked.headers(), seconds);
    expect(await jsonResponse(await client.get('/api/health'))).toEqual({ ready: true });
    const otherIP = await createClient();
    await jsonResponse(await otherIP.post(path, { data: {} }), 400);
  });
}

test('username authentication throttling cannot be bypassed by changing client IP', async ({
  createClient,
}) => {
  const name = username();
  for (let attempt = 0; attempt < 10; attempt++) {
    const client = await createClient();
    await jsonResponse(
      await client.post('/api/auth/login', {
        data: { username: attempt % 2 ? name.toUpperCase() : name, password: PASSWORD },
      }),
      401,
    );
  }
  const anotherIP = await createClient();
  const blocked = await anotherIP.post('/api/auth/login', {
    data: { username: name, password: PASSWORD },
  });
  await jsonResponse(blocked, 429);
  retryAfter(blocked.headers(), 900);
  await jsonResponse(
    await anotherIP.post('/api/auth/login', {
      data: { username: username(), password: PASSWORD },
    }),
    401,
  );
});

test('planner write throttling is account-scoped and does not block reads or another owner', async ({
  createClient,
}) => {
  const client = await createClient();
  const other = await createClient();
  const { user } = await signup(client);
  const { user: otherUser } = await signup(other);
  const action = { type: 'edit' as const, generation: 0, changes: [] };
  for (let batch = 0; batch < 12; batch++) {
    const responses = await Promise.all(
      Array.from({ length: 10 }, () => mutate(client, user, action)),
    );
    for (const response of responses) await jsonResponse(response);
  }
  const blocked = await mutate(client, user, action);
  await jsonResponse(blocked, 429);
  retryAfter(blocked.headers(), 60);
  expect((await snapshot(client, user)).revision).toBe(0);
  await jsonResponse(await mutate(other, otherUser, action));
});
