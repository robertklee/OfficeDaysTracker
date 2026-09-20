import { expect, test as base, type APIRequestContext, type APIResponse } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import type { User } from '../../src/data/account-schema';
import type { Action, StoredSnapshot } from '../../src/data/model';
import type { Dataset, EntryInput } from '../../src/domain/schema';

export const PASSWORD = 'Account integration_42!';
export const COOKIE = 'rto_planner_session';
export const username = () => `acct_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
export const uniqueIP = () => `10.${[...randomBytes(3)].join('.')}`;
export const accountHeaders = (user: User) => ({ 'X-RTO-Account': user.id });
export const entry = (date: string, overrides: Partial<EntryInput> = {}): EntryInput => ({
  date,
  type: 'office',
  status: 'actual',
  priority: 'normal',
  notes: '',
  ...overrides,
});

export function dataset(records: EntryInput[] = []): Dataset {
  return {
    formatVersion: 1,
    policy: {
      kind: 'weekly',
      n: 3,
      windowWeeks: 4,
      weekStart: 1,
      startDate: '2026-03-23',
      timeZone: 'America/Los_Angeles',
    },
    preferences: { includeWeekends: false },
    records: records.map((value) => ({
      ...value,
      revision: 1,
      createdAt: '2026-03-24T19:00:00.000Z',
      updatedAt: '2026-03-24T19:00:00.000Z',
    })),
  };
}

type ClientOptions = { ip?: string; origin?: string | null; cookie?: string };
type CreateClient = (options?: ClientOptions) => Promise<APIRequestContext>;

export const test = base.extend<{ createClient: CreateClient }>({
  extraHTTPHeaders: async ({}, use) => {
    await use({ 'CF-Connecting-IP': uniqueIP() });
  },
  createClient: async ({ playwright, baseURL }, use) => {
    const clients: APIRequestContext[] = [];
    await use(async (options = {}) => {
      const headers: Record<string, string> = {
        'CF-Connecting-IP': options.ip ?? uniqueIP(),
      };
      if (options.origin !== null) headers.Origin = options.origin ?? new URL(baseURL!).origin;
      if (options.cookie) headers.Cookie = options.cookie;
      const client = await playwright.request.newContext({
        baseURL,
        extraHTTPHeaders: headers,
      });
      clients.push(client);
      return client;
    });
    await Promise.all(clients.map((client) => client.dispose()));
  },
});

export { expect };

export async function jsonResponse(response: APIResponse, status = 200) {
  expect(response.status(), await response.text()).toBe(status);
  expect(response.headers()['content-type']).toMatch(/^application\/json\b/);
  expect(response.headers()['cache-control']).toBe('no-store');
  return response.json();
}

export function expectSafeUser(value: unknown): asserts value is User {
  expect(value).toEqual({
    id: expect.stringMatching(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/),
    username: expect.stringMatching(/^[a-z0-9_]{3,30}$/),
    displayName: expect.any(String),
  });
}

export async function signup(client: APIRequestContext, overrides: Record<string, unknown> = {}) {
  const credentials = {
    username: username(),
    password: PASSWORD,
    displayName: 'Integration account',
    ...overrides,
  };
  const response = await client.post('/api/auth/signup', { data: credentials });
  const body = await jsonResponse(response, 201);
  expectSafeUser(body.user);
  expect(Object.keys(body)).toEqual(['user']);
  return { user: body.user as User, response, credentials };
}

export async function snapshot(client: APIRequestContext, user: User): Promise<StoredSnapshot> {
  const response = await client.get('/api/planner', { headers: accountHeaders(user) });
  const body = await jsonResponse(response);
  expect(Object.keys(body)).toEqual(['snapshot']);
  return body.snapshot as StoredSnapshot;
}

export function mutate(client: APIRequestContext, user: User, action: Action, id = randomUUID()) {
  return client.post('/api/planner', {
    headers: accountHeaders(user),
    data: { id, action },
  });
}

export function streamedRequest(origin: string, path: string, chunks: Buffer[]) {
  return new Promise<{ status: number; headers: Record<string, unknown>; body: unknown }>(
    (resolve, reject) => {
      const request = httpRequest(
        new URL(path, origin),
        {
          method: 'POST',
          headers: {
            Origin: origin,
            'CF-Connecting-IP': uniqueIP(),
            'Content-Type': 'application/json',
            'Transfer-Encoding': 'chunked',
          },
        },
        (response) => {
          const received: Buffer[] = [];
          response.on('data', (chunk: Buffer) => received.push(chunk));
          response.on('error', reject);
          response.on('end', () => {
            try {
              resolve({
                status: response.statusCode!,
                headers: response.headers,
                body: JSON.parse(Buffer.concat(received).toString('utf8')),
              });
            } catch (error) {
              reject(error);
            }
          });
        },
      );
      request.on('error', reject);
      request.setTimeout(15_000, () => request.destroy(new Error('Streamed request timed out.')));
      for (const chunk of chunks) request.write(chunk);
      request.end();
    },
  );
}
