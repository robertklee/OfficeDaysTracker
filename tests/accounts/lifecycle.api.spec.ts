import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { accountHeaders, COOKIE, expect, jsonResponse, signup, test, uniqueIP } from './helpers';

const execute = promisify(execFile);

test('lifecycle: missing schema returns 503 and an expired server session is denied in an isolated D1', async ({
  playwright,
}, info) => {
  const persistence = info.config.metadata.lifecyclePersistence;
  const origin = info.config.metadata.lifecycleOrigin;
  expect(persistence).toMatch(/^\.wrangler\/test-accounts-lifecycle\/[a-f0-9-]{36}$/);
  expect(origin).toBe('http://127.0.0.1:8790');
  const client = await playwright.request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { Origin: origin, 'CF-Connecting-IP': uniqueIP() },
  });
  const wrangler = (args: string[]) =>
    execute(
      process.execPath,
      [
        'node_modules/wrangler/bin/wrangler.js',
        'd1',
        ...args,
        'DB',
        '--local',
        '--persist-to',
        persistence,
      ],
      { timeout: 30_000 },
    );
  try {
    await test.step('missing tables fail readiness, session checks and login with sanitized JSON', async () => {
      const responses = [
        await client.get('/api/health'),
        await client.get('/api/session'),
        await client.post('/api/auth/login', {
          data: { username: 'schema_probe', password: 'Not a real password' },
        }),
      ];
      for (const response of responses) {
        expect(await jsonResponse(response, 503)).toEqual({
          error: 'Account service is unavailable. Try again later.',
        });
      }
    });

    await test.step('migrations repair only this run-specific lifecycle database', async () => {
      await wrangler(['migrations', 'apply']);
      expect(await jsonResponse(await client.get('/api/health'))).toEqual({ ready: true });
    });

    await test.step('server-side expiry rejects a still-present cookie and reauthentication creates a new session', async () => {
      const { user, credentials } = await signup(client);
      const cookie = (await client.storageState()).cookies.find((value) => value.name === COOKIE)!;
      expect(cookie.expires).toBeGreaterThan(Date.now() / 1000);
      const tokenHash = createHash('sha256').update(cookie.value).digest('hex');
      expect(user.id).toMatch(/^[a-f0-9-]{36}$/);
      await execute(
        process.execPath,
        [
          'node_modules/wrangler/bin/wrangler.js',
          'd1',
          'execute',
          'DB',
          '--local',
          '--persist-to',
          persistence,
          '--command',
          `UPDATE sessions SET expires_at = 0 WHERE user_id = '${user.id}' AND token_hash = '${tokenHash}'`,
        ],
        { timeout: 30_000 },
      );
      expect(
        (await client.storageState()).cookies.find((value) => value.name === COOKIE)?.value,
      ).toBe(cookie.value);
      expect(await jsonResponse(await client.get('/api/session'))).toEqual({ user: null });
      await jsonResponse(await client.get('/api/planner', { headers: accountHeaders(user) }), 401);
      await jsonResponse(
        await client.post('/api/planner', {
          headers: accountHeaders(user),
          data: { id: crypto.randomUUID(), action: { type: 'edit', generation: 0, changes: [] } },
        }),
        401,
      );
      expect(
        await jsonResponse(
          await client.post('/api/auth/login', {
            data: { username: credentials.username, password: credentials.password },
          }),
        ),
      ).toEqual({ user });
      expect(
        (await client.storageState()).cookies.find((value) => value.name === COOKIE)?.value,
      ).not.toBe(cookie.value);
    });
  } finally {
    await client.dispose();
  }
});
