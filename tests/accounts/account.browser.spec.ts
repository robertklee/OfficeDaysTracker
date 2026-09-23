import type { Page } from '@playwright/test';
import type { User } from '../../src/data/account-schema';
import {
  accountHeaders,
  COOKIE,
  dataset,
  entry,
  expect,
  expectSafeUser,
  jsonResponse,
  PASSWORD,
  snapshot,
  test,
  uniqueIP,
  username,
} from './helpers';
import { randomUUID } from 'node:crypto';

const clientTime = new Date('2026-03-24T19:00:00Z');
const day = (page: Page, date: string) => page.locator(`[data-date="${date}"]`);

async function createAccount(page: Page) {
  const credentials = {
    username: username(),
    password: PASSWORD,
    displayName: 'Browser account owner',
  };
  await page.goto('/account');
  await page.getByRole('button', { name: 'Create account', exact: true }).first().click();
  await page.getByLabel('Username', { exact: true }).fill(credentials.username);
  await page.getByLabel('Password', { exact: true }).fill(credentials.password);
  await page.getByLabel('Display name', { exact: true }).fill(credentials.displayName);
  await page
    .getByRole('form', { name: 'Account credentials' })
    .getByRole('button', { name: 'Create account', exact: true })
    .click();
  await expect(page.getByRole('main')).toContainText(credentials.displayName);
  await expect(page.getByRole('main')).toContainText(credentials.username);
  const session = await jsonResponse(await page.request.get('/api/session'));
  expectSafeUser(session.user);
  return { credentials, user: session.user as User };
}

async function signIn(page: Page, credentials: { username: string; password: string }) {
  await page.goto('/account');
  await page.getByRole('button', { name: 'Sign in', exact: true }).first().click();
  await page.getByLabel('Username', { exact: true }).fill(credentials.username);
  await page.getByLabel('Password', { exact: true }).fill(credentials.password);
  await page
    .getByRole('form', { name: 'Account credentials' })
    .getByRole('button', { name: 'Sign in', exact: true })
    .click();
  await expect(page.getByRole('main')).toContainText(credentials.username);
}

async function signOut(page: Page) {
  await page.goto('/account');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Confirm sign out', exact: true }).click();
  await expect(page.getByLabel('Username', { exact: true })).toBeVisible();
  expect(await jsonResponse(await page.request.get('/api/session'))).toEqual({ user: null });
}

async function localPlanner(page: Page) {
  return page.evaluate(async () => {
    if (!(await indexedDB.databases()).some((database) => database.name === 'rto-planner'))
      return null;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('rto-planner');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction(['rows', 'meta'], 'readonly');
        const rows = transaction.objectStore('rows').getAll();
        const meta = transaction.objectStore('meta').getAll();
        transaction.oncomplete = () => resolve({ rows: rows.result, meta: meta.result });
        transaction.onerror = () => reject(transaction.error);
      });
    } finally {
      db.close();
    }
  });
}

async function seedAccount(page: Page, user: User, cloud: ReturnType<typeof dataset>) {
  const current = await snapshot(page.request, user);
  await jsonResponse(
    await page.request.post('/api/planner', {
      headers: { ...accountHeaders(user), Origin: new URL(page.url()).origin },
      data: {
        id: randomUUID(),
        action: { type: 'replace', expectedRevision: current.revision, dataset: cloud },
      },
    }),
  );
}

async function inspectPrivateStorage(page: Page, secrets: string[]) {
  return page.evaluate(async (privateValues) => {
    const leaks: string[] = [];
    const containsPrivateData = (value: string) =>
      privateValues.some((secret) => value.includes(secret));
    for (const [name, storage] of [
      ['localStorage', localStorage],
      ['sessionStorage', sessionStorage],
    ] as const) {
      if (containsPrivateData(JSON.stringify(Object.entries(storage)))) leaks.push(name);
    }
    for (const database of await indexedDB.databases()) {
      if (!database.name) continue;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(database.name!);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const stores = [...db.objectStoreNames];
        if (!stores.length) continue;
        const transaction = db.transaction(stores, 'readonly');
        await Promise.all(
          stores.map(
            (name) =>
              new Promise<void>((resolve, reject) => {
                const request = transaction.objectStore(name).getAll();
                request.onerror = () => reject(request.error);
                request.onsuccess = () => {
                  if (containsPrivateData(JSON.stringify(request.result)))
                    leaks.push(`indexedDB:${database.name}/${name}`);
                  resolve();
                };
              }),
          ),
        );
      } finally {
        db.close();
      }
    }
    const cacheURLs: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        cacheURLs.push(request.url);
        const response = await cache.match(request);
        if (response && containsPrivateData(await response.text()))
          leaks.push(`cache:${request.url}`);
      }
    }
    return { leaks, cacheURLs };
  }, secrets);
}

test('account is reachable before policy setup, cloud edits survive another browser and switches remount state', async ({
  page,
  browser,
  baseURL,
}) => {
  await page.clock.setFixedTime(clientTime);
  const { credentials, user } = await createAccount(page);
  expect((await snapshot(page.request, user)).dataset.policy).toBeNull();
  await page.goto('/dashboard');
  await page.getByLabel('Start date', { exact: true }).fill('2026-03-23');
  await page.getByRole('button', { name: 'Preview policy', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm policy & start' }).click();
  await expect(page.getByRole('heading', { name: 'This week', exact: true })).toBeVisible();
  await page.goto('/calendar');
  await day(page, '2026-03-24').click();
  await expect(day(page, '2026-03-24')).toHaveAttribute('aria-label', /Office, actual/);
  await expect
    .poll(async () => (await snapshot(page.request, user)).dataset.records.length)
    .toBe(1);
  await page.reload();
  await expect(day(page, '2026-03-24')).toHaveAttribute('aria-label', /Office, actual/);

  const otherBrowser = await browser.newContext({
    baseURL,
    timezoneId: 'America/Los_Angeles',
    extraHTTPHeaders: { 'CF-Connecting-IP': uniqueIP() },
  });
  try {
    const otherPage = await otherBrowser.newPage();
    await otherPage.clock.setFixedTime(clientTime);
    await signIn(otherPage, credentials);
    await otherPage.goto('/calendar');
    await expect(day(otherPage, '2026-03-24')).toHaveAttribute('aria-label', /Office, actual/);

    await signOut(page);
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Set up your week' })).toBeVisible();
    const { user: nextUser } = await createAccount(page);
    expect(nextUser.id).not.toBe(user.id);
    const nextSnapshot = await snapshot(page.request, nextUser);
    expect(nextSnapshot.dataset.records).toEqual([]);
    expect(nextSnapshot.dataset.policy).toBeNull();
    await page.goto('/calendar');
    await expect(page.getByRole('heading', { name: 'Set up your week' })).toBeVisible();
    await otherPage.reload();
    await expect(day(otherPage, '2026-03-24')).toHaveAttribute('aria-label', /Office, actual/);
    expect((await snapshot(otherPage.request, user)).dataset.records).toHaveLength(1);
  } finally {
    await otherBrowser.close();
  }
});

test('local import requires confirmation, replaces only the account and leaves the original IndexedDB intact', async ({
  page,
  browser,
  baseURL,
}) => {
  await page.clock.setFixedTime(clientTime);
  const local = dataset([entry('2026-03-24', { notes: 'Original browser-only attendance' })]);
  await page.goto('/settings');
  await page.getByLabel('Import JSON backup').setInputFiles({
    name: 'local-planner.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(local)),
  });
  await page.getByRole('button', { name: 'Confirm replacement', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  const localBefore = await localPlanner(page);
  expect(localBefore).not.toBeNull();
  const { credentials, user } = await createAccount(page);
  const empty = await snapshot(page.request, user);
  expect(empty.dataset.records).toEqual([]);
  expect(empty.dataset.policy).toBeNull();
  expect(await localPlanner(page)).toEqual(localBefore);

  const oldCloud = dataset([entry('2026-03-25', { type: 'remote', notes: 'Will be replaced' })]);
  await jsonResponse(
    await page.request.post('/api/planner', {
      headers: { ...accountHeaders(user), Origin: baseURL! },
      data: {
        id: randomUUID(),
        action: { type: 'replace', expectedRevision: 0, dataset: oldCloud },
      },
    }),
  );
  await page.reload();
  await page.getByRole('button', { name: 'Import local planner', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Import local planner?' });
  await expect(dialog).toBeVisible();
  expect((await snapshot(page.request, user)).dataset).toEqual(oldCloud);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await snapshot(page.request, user)).dataset).toEqual(oldCloud);
  await page.getByRole('button', { name: 'Import local planner', exact: true }).click();
  await dialog.getByRole('button', { name: 'Import into account', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect.poll(async () => (await snapshot(page.request, user)).dataset).toEqual(local);
  expect(await localPlanner(page)).toEqual(localBefore);

  await page.goto('/calendar');
  await expect(day(page, '2026-03-24')).toHaveAttribute('aria-label', /Office, actual/);
  await expect(day(page, '2026-03-25')).toHaveAttribute('aria-label', /unentered/);
  await page.getByRole('button', { name: 'Remote', exact: true }).click();
  await day(page, '2026-03-26').click();
  await expect(day(page, '2026-03-26')).toHaveAttribute('aria-label', /Remote, planned/);
  await expect
    .poll(async () => (await snapshot(page.request, user)).dataset.records.length)
    .toBe(2);
  expect(await localPlanner(page)).toEqual(localBefore);

  await page.goto('/account');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  expect(await jsonResponse(await page.request.get('/api/session'))).toEqual({ user });
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await jsonResponse(await page.request.get('/api/session'))).toEqual({ user });
  await signOut(page);
  await page.goto('/calendar');
  await expect(day(page, '2026-03-24')).toHaveAttribute('aria-label', /Office, actual/);
  await expect(day(page, '2026-03-26')).toHaveAttribute('aria-label', /unentered/);
  expect(await localPlanner(page)).toEqual(localBefore);

  const otherBrowser = await browser.newContext({
    baseURL,
    timezoneId: 'America/Los_Angeles',
    extraHTTPHeaders: { 'CF-Connecting-IP': uniqueIP() },
  });
  try {
    const otherPage = await otherBrowser.newPage();
    await otherPage.clock.setFixedTime(clientTime);
    await signIn(otherPage, credentials);
    await otherPage.goto('/calendar');
    await expect(day(otherPage, '2026-03-24')).toHaveAttribute('aria-label', /Office, actual/);
    await expect(day(otherPage, '2026-03-26')).toHaveAttribute('aria-label', /Remote, planned/);
    await signOut(otherPage);
    await otherPage.goto('/calendar');
    await expect(otherPage.getByRole('heading', { name: 'Set up your week' })).toBeVisible();
  } finally {
    await otherBrowser.close();
  }
});

test('lifecycle: an offline account save stays pending and exportable until an explicit successful retry', async ({
  page,
  context,
  createClient,
}) => {
  await page.clock.setFixedTime(clientTime);
  const { user } = await createAccount(page);
  const cloud = dataset([entry('2026-03-24', { notes: 'Already saved in the account' })]);
  await seedAccount(page, user, cloud);
  await page.goto('/calendar');
  await expect(day(page, '2026-03-24')).toHaveAttribute('aria-label', /Office, actual/);
  const localBefore = await localPlanner(page);
  const cookie = (await context.cookies()).find((value) => value.name === COOKIE)!;
  const observer = await createClient({ cookie: `${COOKIE}=${cookie.value}` });
  const before = await snapshot(observer, user);

  await context.setOffline(true);
  await page.getByRole('button', { name: 'Remote', exact: true }).click();
  await day(page, '2026-03-25').click();
  await expect(page.getByRole('heading', { name: 'Account save not confirmed' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Cannot reach the account service');
  await expect(page.locator('.saved-status')).toHaveText('Storage error');
  await expect(day(page, '2026-03-25')).toHaveAttribute('aria-label', /unentered/);
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export unsaved changes', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('rto-unsaved-recovery.json');
  const stream = await download.createReadStream();
  expect(stream).not.toBeNull();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const recovery = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  expect(recovery.records).toEqual([
    expect.objectContaining({ date: '2026-03-24', type: 'office' }),
    expect.objectContaining({ date: '2026-03-25', type: 'remote', status: 'planned' }),
  ]);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  expect(await snapshot(observer, user)).toEqual(before);
  expect(await localPlanner(page)).toEqual(localBefore);
  await context.setOffline(false);
  await expect(
    page.getByRole('button', { name: 'Export unsaved changes', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.saved-status')).toHaveText('Storage error');
  expect(await snapshot(observer, user)).toEqual(before);
  await page.getByRole('button', { name: 'Retry storage', exact: true }).click();
  await expect(page.locator('.saved-status')).toHaveText('Saved to your account');
  await expect(day(page, '2026-03-25')).toHaveAttribute('aria-label', /Remote, planned/);
  expect((await snapshot(observer, user)).revision).toBe(before.revision + 1);
  expect(await localPlanner(page)).toEqual(localBefore);
});

test('lifecycle: service worker never caches private account data or falls back to HTML for API navigation', async ({
  page,
  context,
}) => {
  await page.clock.setFixedTime(clientTime);
  const { user } = await createAccount(page);
  const privateNote = `Private cloud attendance ${randomUUID()}`;
  await seedAccount(page, user, dataset([entry('2026-03-24', { notes: privateNote })]));
  await page.goto('/calendar');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect(day(page, '2026-03-24')).toHaveAttribute('aria-label', /Office, actual/);
  await day(page, '2026-03-24').focus();
  await page.keyboard.press('d');
  await expect(page.getByLabel('Notes', { exact: true })).toHaveValue(privateNote);
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();

  for (const [path, status] of [
    ['/api/session', 200],
    ['/api/planner', 409],
    ['/api/no-navigation-fallback', 404],
  ] as const) {
    const response = await page.goto(path);
    expect(response!.status()).toBe(status);
    expect(response!.fromServiceWorker()).toBe(false);
    expect(response!.headers()['content-type']).toMatch(/^application\/json\b/);
    expect(response!.headers()['cache-control']).toBe('no-store');
    const body = await response!.json();
    if (status === 200) expect(body).toEqual({ user });
    else expect(Object.keys(body)).toEqual(['error']);
  }
  await page.goto('/calendar');
  await expect(day(page, '2026-03-24')).toHaveAttribute('aria-label', /Office, actual/);
  const storage = await inspectPrivateStorage(page, [privateNote, user.id, user.username]);
  expect(storage.cacheURLs.some((url) => new URL(url).pathname === '/index.html')).toBe(true);
  expect(storage.cacheURLs.filter((url) => /^\/api(?:\/|$)/.test(new URL(url).pathname))).toEqual(
    [],
  );
  expect(storage.leaks).toEqual([]);
  expect(await page.evaluate(() => document.cookie)).not.toContain(COOKIE);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.topbar')).toContainText('My planner');
  await expect(page.getByRole('heading', { name: 'Account unavailable' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Set up your week' })).toBeVisible();
  await expect(page.getByRole('main')).not.toContainText(privateNote);
  await expect(page.getByRole('main')).not.toContainText(user.username);
  expect((await inspectPrivateStorage(page, [privateNote, user.id, user.username])).leaks).toEqual(
    [],
  );
});

test('lifecycle: another tab logout broadcasts clear the account workspace and an open private draft', async ({
  page,
  context,
}) => {
  await page.clock.setFixedTime(clientTime);
  const { user } = await createAccount(page);
  const privateNote = `Cloud-only note ${randomUUID()}`;
  await seedAccount(
    page,
    user,
    dataset([entry('2026-03-24', { type: 'remote', notes: privateNote })]),
  );
  const other = await context.newPage();
  await other.clock.setFixedTime(clientTime);
  await other.goto('/calendar');
  await expect(day(other, '2026-03-24')).toHaveAttribute('aria-label', /Remote, actual/);
  await day(other, '2026-03-24').focus();
  await other.keyboard.press('d');
  await expect(other.getByLabel('Notes', { exact: true })).toHaveValue(privateNote);
  await other.getByLabel('Notes', { exact: true }).fill('An unsaved private draft');
  await signOut(page);
  await expect(other).toHaveURL(/\/calendar$/);
  await expect(other.locator('.topbar')).toContainText('My planner');
  await expect(other.getByRole('dialog')).not.toBeVisible();
  await expect(other.getByRole('heading', { name: 'Set up your week' })).toBeVisible();
  await expect(other.getByRole('main')).toContainText('Account data was cleared from this tab');
  await expect(other.getByRole('main')).not.toContainText(privateNote);
  await expect(other.getByRole('main')).not.toContainText('An unsaved private draft');
  expect(await jsonResponse(await other.request.get('/api/session'))).toEqual({ user: null });
});
