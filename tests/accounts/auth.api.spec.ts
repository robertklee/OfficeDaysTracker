import { randomUUID } from 'node:crypto';
import {
  accountHeaders,
  COOKIE,
  expect,
  expectSafeUser,
  jsonResponse,
  PASSWORD,
  signup,
  streamedRequest,
  test,
  username,
} from './helpers';

test('health verifies the migrated schema and API misses never fall back to HTML', async ({
  createClient,
}) => {
  const client = await createClient();
  const health = await client.get('/api/health');
  expect(await jsonResponse(health)).toEqual({ ready: true });
  expect(health.headers()['x-content-type-options']).toBe('nosniff');
  expect(health.headers()['referrer-policy']).toBe('no-referrer');
  expect(health.headers()['content-security-policy']).toContain("default-src 'none'");
  expect(await jsonResponse(await client.get('/api/session'))).toEqual({ user: null });
  for (const method of ['get', 'post'] as const) {
    expect(await jsonResponse(await client[method]('/api/does-not-exist'), 404)).toEqual({
      error: 'API endpoint not found.',
    });
  }
  const wrongMethod = await client.get('/api/auth/signup');
  expect(await jsonResponse(wrongMethod, 405)).toEqual({ error: 'Method not allowed.' });
  expect(wrongMethod.headers().allow).toBe('POST');
});

test('signup, session, logout and login expose only safe users and rotate revocable cookies', async ({
  createClient,
}) => {
  const client = await createClient();
  const name = username();
  const { user, response } = await signup(client, {
    username: `  ${name.toUpperCase()}  `,
    displayName: '  Account owner  ',
  });
  expect(user).toEqual({ id: expect.any(String), username: name, displayName: 'Account owner' });
  const setCookie = response.headers()['set-cookie'];
  expect(setCookie).toMatch(new RegExp(`^${COOKIE}=[a-f0-9]{64};`));
  expect(setCookie).toContain('HttpOnly');
  expect(setCookie).toContain('SameSite=Strict');
  expect(setCookie).toContain('Path=/');
  expect(setCookie).toContain('Max-Age=2592000');
  const cookie = (await client.storageState()).cookies.find((item) => item.name === COOKIE)!;
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/', secure: false });
  expect(cookie.expires - Date.now() / 1000).toBeGreaterThan(29 * 24 * 60 * 60);
  expect(await jsonResponse(await client.get('/api/session'))).toEqual({ user });

  const logout = await client.post('/api/auth/logout', {
    headers: accountHeaders(user),
    data: {},
  });
  expect(await jsonResponse(logout)).toEqual({ user: null });
  expect(logout.headers()['set-cookie']).toContain(`${COOKIE}=;`);
  expect(logout.headers()['set-cookie']).toContain('Max-Age=0');
  expect((await client.storageState()).cookies.filter((item) => item.name === COOKIE)).toEqual([]);
  expect(await jsonResponse(await client.get('/api/session'))).toEqual({ user: null });
  const revoked = await createClient({ cookie: `${COOKIE}=${cookie.value}` });
  expect(await jsonResponse(await revoked.get('/api/session'))).toEqual({ user: null });
  await jsonResponse(await revoked.get('/api/planner', { headers: accountHeaders(user) }), 401);

  const login = await client.post('/api/auth/login', {
    data: { username: name.toUpperCase(), password: PASSWORD },
  });
  const body = await jsonResponse(login);
  expectSafeUser(body.user);
  expect(body).toEqual({ user });
  expect(
    (await client.storageState()).cookies.find((item) => item.name === COOKIE)?.value,
  ).not.toBe(cookie.value);
});

test('duplicate usernames, including normalized case, do not create a second account', async ({
  createClient,
}) => {
  const owner = await createClient();
  const { credentials, user } = await signup(owner);
  for (const name of [credentials.username, credentials.username.toUpperCase()]) {
    const other = await createClient();
    expect(
      await jsonResponse(
        await other.post('/api/auth/signup', {
          data: { ...credentials, username: name, displayName: 'Not the owner' },
        }),
        409,
      ),
    ).toEqual({ error: 'That username is already in use.' });
    expect(await jsonResponse(await other.get('/api/session'))).toEqual({ user: null });
  }
  expect(await jsonResponse(await owner.get('/api/session'))).toEqual({ user });
});

test('concurrent case-equivalent signups create exactly one usable account', async ({
  createClient,
}) => {
  const first = await createClient();
  const second = await createClient();
  const name = username();
  const credentials = { username: name, password: PASSWORD, displayName: 'Concurrent owner' };
  const responses = await Promise.all([
    first.post('/api/auth/signup', { data: credentials }),
    second.post('/api/auth/signup', { data: { ...credentials, username: name.toUpperCase() } }),
  ]);
  expect(responses.map((response) => response.status()).sort()).toEqual([201, 409]);
  const winner = responses.findIndex((response) => response.status() === 201);
  const { user } = await jsonResponse(responses[winner], 201);
  expectSafeUser(user);
  expect(user.username).toBe(name);
  const clients = [first, second];
  expect(await jsonResponse(await clients[1 - winner].get('/api/session'))).toEqual({ user: null });
  const planner = await jsonResponse(
    await clients[winner].get('/api/planner', {
      headers: accountHeaders(user),
    }),
  );
  expect(planner.snapshot.dataset.records).toEqual([]);
  const login = await clients[1 - winner].post('/api/auth/login', {
    data: { username: name, password: PASSWORD },
  });
  expect(await jsonResponse(login)).toEqual({ user });
});

const invalidSignups: [string, Record<string, unknown>][] = [
  ['short password', { password: 'a'.repeat(11) }],
  ['long password', { password: 'a'.repeat(201) }],
  ['non-string password', { password: 123456789012 }],
  ['short username', { username: 'ab' }],
  ['long username', { username: 'a'.repeat(31) }],
  ['non-ASCII username', { username: 'éxample' }],
  ['punctuated username', { username: 'invalid.name' }],
  ['blank display name', { displayName: '   ' }],
  ['long display name', { displayName: 'a'.repeat(61) }],
  ['unexpected privilege field', { role: 'admin' }],
];
for (const [label, invalid] of invalidSignups) {
  test(`signup rejects ${label} without establishing a session`, async ({ createClient }) => {
    const client = await createClient();
    const response = await client.post('/api/auth/signup', {
      data: { username: username(), password: PASSWORD, displayName: 'Valid name', ...invalid },
    });
    expect(await jsonResponse(response, 400)).toEqual({
      error: 'Invalid request. Check the field formats and limits.',
    });
    expect(response.headers()['set-cookie']).toBeUndefined();
    expect(await jsonResponse(await client.get('/api/session'))).toEqual({ user: null });
  });
}

for (const length of [12, 200]) {
  test(`a ${length}-character password can sign up and subsequently sign in`, async ({
    createClient,
  }) => {
    const owner = await createClient();
    const password = `${'x'.repeat(length - 2)}9!`;
    const { credentials, user } = await signup(owner, { password });
    const other = await createClient();
    expect(
      await jsonResponse(
        await other.post('/api/auth/login', {
          data: { username: credentials.username, password },
        }),
      ),
    ).toEqual({ user });
  });
}

test('wrong and nonexistent credentials have indistinguishable public errors', async ({
  createClient,
}) => {
  const owner = await createClient();
  const { credentials } = await signup(owner);
  const anonymous = await createClient();
  const errors = [];
  for (const name of [credentials.username, username()]) {
    const response = await anonymous.post('/api/auth/login', {
      data: { username: name, password: 'Definitely incorrect_42!' },
    });
    errors.push(await jsonResponse(response, 401));
    expect(response.headers()['set-cookie']).toBeUndefined();
  }
  expect(errors).toEqual([
    { error: 'Incorrect username or password.' },
    { error: 'Incorrect username or password.' },
  ]);
  expect(await jsonResponse(await anonymous.get('/api/session'))).toEqual({ user: null });
});

test('invalid JSON, invalid UTF-8, absent bodies and oversized auth payloads fail safely', async ({
  createClient,
}) => {
  for (const data of ['{', Buffer.from([0x7b, 0x80, 0x7d]), undefined]) {
    const client = await createClient();
    await jsonResponse(
      await client.post('/api/auth/signup', {
        headers: { 'Content-Type': 'application/json' },
        data,
      }),
      400,
    );
  }
  const client = await createClient();
  expect(
    await jsonResponse(
      await client.post('/api/auth/signup', {
        data: { username: username(), password: PASSWORD, displayName: 'x'.repeat(4096) },
      }),
      413,
    ),
  ).toEqual({ error: 'Request exceeds the size limit.' });
});

test('chunked bodies are parsed and their actual bytes are bounded without Content-Length', async ({
  baseURL,
}) => {
  const data = Buffer.from(JSON.stringify({ username: username(), password: PASSWORD }));
  const valid = await streamedRequest(baseURL!, '/api/auth/login', [
    data.subarray(0, 15),
    data.subarray(15),
  ]);
  expect(valid.status).toBe(401);
  expect(valid.body).toEqual({ error: 'Incorrect username or password.' });
  const oversized = await streamedRequest(baseURL!, '/api/auth/signup', [
    Buffer.from('{"displayName":"'),
    Buffer.alloc(2048, 'x'),
    Buffer.alloc(2048, 'x'),
    Buffer.from('"}'),
  ]);
  expect(oversized.status).toBe(413);
  expect(oversized.body).toEqual({ error: 'Request exceeds the size limit.' });
  expect(oversized.headers['content-type']).toMatch(/^application\/json\b/);
});

test('mutations reject absent or foreign origins before authenticating or accepting a body', async ({
  createClient,
}) => {
  for (const origin of [null, 'https://unrelated.example', 'http://localhost:8789']) {
    const client = await createClient({ origin });
    for (const path of [
      '/api/auth/signup',
      '/api/auth/login',
      '/api/auth/logout',
      '/api/planner',
    ]) {
      expect(await jsonResponse(await client.post(path, { data: {} }), 403)).toEqual({
        error: 'Account changes require an exact same-origin request.',
      });
    }
  }
});

test('mutations require application/json rather than form or text submissions', async ({
  createClient,
}) => {
  for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'application/jsonp']) {
    const client = await createClient();
    for (const path of ['/api/auth/signup', '/api/auth/login', '/api/auth/logout']) {
      expect(
        await jsonResponse(
          await client.post(path, {
            headers: { 'Content-Type': type },
            data: '{}',
          }),
          415,
        ),
      ).toEqual({ error: 'Send application/json.' });
    }
  }
});

test('a missing, forged or malformed cookie never grants planner access', async ({
  createClient,
}) => {
  for (const cookie of [undefined, `${COOKIE}=${'a'.repeat(64)}`, `${COOKIE}=malformed`]) {
    const client = await createClient({ cookie });
    for (const method of ['get', 'post'] as const) {
      await jsonResponse(
        await client[method]('/api/planner', {
          headers: { 'X-RTO-Account': randomUUID() },
          ...(method === 'post' ? { data: {} } : {}),
        }),
        401,
      );
    }
    expect(await jsonResponse(await client.get('/api/session'))).toEqual({ user: null });
  }
});
