import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function setup(page: Page) {
  await page.clock.install({ time: new Date('2026-03-24T19:00:00Z') });
  await page.goto('/dashboard');
  await page.getByLabel('Enforcement start').fill('2026-03-23');
  await page.getByRole('button', { name: 'Preview policy', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm policy & start' }).click();
  await expect(page.getByRole('heading', { name: 'Your office rhythm.' })).toBeVisible();
}
const day = (page: Page, date: string) => page.locator(`[data-date="${date}"]`);

test('first run, paint, idempotence, hints, eraser, repeated undo, protected details, reload and route fallback', async ({
  page,
}) => {
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  await setup(page);
  await page.getByRole('link', { name: 'Calendar', exact: true }).click();
  await day(page, '2026-03-24').click();
  await expect(day(page, '2026-03-24')).toHaveAttribute('aria-label', /Office, actual/);
  await day(page, '2026-03-24').click();
  await expect(day(page, '2026-03-25')).toHaveClass(/hint/);
  await page.getByRole('button', { name: 'Remote', exact: true }).click();
  await day(page, '2026-03-24').click();
  await expect(day(page, '2026-03-24')).toHaveAttribute('aria-label', /Remote, actual/);
  await page.getByRole('button', { name: 'Undo last change' }).click();
  await expect(day(page, '2026-03-24')).toHaveAttribute('aria-label', /Office, actual/);
  await page.getByRole('button', { name: 'Undo last change' }).click();
  await expect(day(page, '2026-03-24')).toHaveAttribute('aria-label', /unentered/);
  await expect(day(page, '2026-03-25')).not.toHaveClass(/hint/);
  await day(page, '2026-03-24').focus();
  await page.keyboard.press('d');
  await page.getByLabel('Notes', { exact: true }).fill('Keep this note');
  await page.getByRole('checkbox', { name: 'Must priority - protect this commitment' }).check();
  await page.getByRole('button', { name: 'Save day details' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Eraser', exact: true }).click();
  await day(page, '2026-03-24').click();
  await expect(page.getByRole('dialog')).toContainText('protected');
  await page.getByRole('button', { name: 'Confirm protected changes' }).click();
  await page.getByRole('button', { name: 'Undo last change' }).click();
  await expect(day(page, '2026-03-24')).toHaveAttribute('aria-label', /must priority/);
  await expect(page.locator('.saved-status')).toHaveText('Saved on this browser');
  await day(page, '2026-03-24').focus();
  await page.keyboard.press('d');
  await expect(page.getByLabel('Notes', { exact: true })).toHaveValue('Keep this note');
  await expect(
    page.getByRole('checkbox', { name: 'Must priority - protect this commitment' }),
  ).toBeChecked();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.reload();
  await expect(day(page, '2026-03-24')).toHaveAttribute('aria-label', /must priority/);
  for (const route of ['/settings', '/dashboard', '/calendar']) {
    await page.goto(route);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  }
  await page.goto('/unknown-route');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  expect(failures).toEqual([]);
});

test('inclusive skipped-event and reverse drag, cancellation, keyboard range, weekends and Today', async ({
  page,
  isMobile,
}) => {
  test.skip(
    isMobile,
    'Mouse drag alternatives are covered on desktop engines; touch taps are covered separately.',
  );
  await setup(page);
  await page.goto('/calendar');
  await day(page, '2026-03-31').scrollIntoViewIfNeeded();
  const friday = await day(page, '2026-03-27').boundingBox();
  const tuesday = await day(page, '2026-03-31').boundingBox();
  await page.mouse.move(friday!.x + 15, friday!.y + 15);
  await page.mouse.down();
  await page.mouse.move(tuesday!.x + 15, tuesday!.y + 15);
  await page.mouse.up();
  for (const date of ['2026-03-27', '2026-03-30', '2026-03-31'])
    await expect(day(page, date)).toHaveAttribute('aria-label', /Office, planned/);
  await expect(day(page, '2026-03-28')).toHaveAttribute('aria-label', /unentered/);
  await page.getByRole('button', { name: 'Undo last change' }).click();
  await page.mouse.move(tuesday!.x + 15, tuesday!.y + 15);
  await page.mouse.down();
  await page.mouse.move(friday!.x + 15, friday!.y + 15);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(day(page, '2026-03-30')).toHaveAttribute('aria-label', /unentered/);
  await day(page, '2026-03-27').focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Enter');
  await expect(day(page, '2026-03-30')).toHaveAttribute('aria-label', /Office, planned/);
  await day(page, '2026-03-28').click();
  await expect(day(page, '2026-03-28')).toHaveAttribute('aria-label', /Office, planned.*weekend/);
  await page.getByRole('button', { name: 'Next month' }).click();
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(day(page, '2026-03-24')).toBeFocused();
});

test('320px calendar reflows with 44px targets and touch-capable day entry', async ({
  page,
  isMobile,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await setup(page);
  await page.goto('/calendar');
  await expect(day(page, '2026-03-24')).toBeVisible();
  const measurements = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > innerWidth,
    cell: document.querySelector('[data-date="2026-03-24"]')!.getBoundingClientRect().width,
  }));
  expect(measurements.overflow).toBe(false);
  expect(measurements.cell).toBeGreaterThanOrEqual(44);
  if (isMobile) await day(page, '2026-03-24').tap();
  else await day(page, '2026-03-24').click();
  await expect(day(page, '2026-03-24')).toHaveAttribute('aria-label', /Office, actual/);
});

test('JSON backups export, validate before replacement and preserve actuals when clearing plans', async ({
  page,
}) => {
  await setup(page);
  await page.goto('/calendar');
  await day(page, '2026-03-24').click();
  await day(page, '2026-03-25').click();
  await page.getByRole('button', { name: 'Clear planned days', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Remove 1 planned entries');
  await page.getByRole('button', { name: 'Confirm removal of 1 plans' }).click();
  await expect(day(page, '2026-03-24')).toHaveAttribute('aria-label', /Office, actual/);
  await expect(day(page, '2026-03-25')).toHaveAttribute('aria-label', /unentered/);
  await page.goto('/settings');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON backup', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('rto-planner-backup.json');
  const backupPath = await download.path();
  await page.getByLabel('Import JSON backup').setInputFiles({
    name: 'corrupt.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{'),
  });
  await expect(page.getByRole('alert')).toContainText('not valid JSON');
  await page.getByLabel('Import JSON backup').setInputFiles(backupPath!);
  await expect(page.getByRole('dialog')).toContainText('1 attendance entries');
  await page.getByRole('button', { name: 'Confirm replacement', exact: true }).click();
  await expect(page.getByText('Backup restored on this browser.')).toBeVisible();
});

test('same-origin tabs receive count-preserving edits and reject stale details', async ({
  page,
  context,
}) => {
  await setup(page);
  await page.goto('/calendar');
  await day(page, '2026-03-24').click();
  const other = await context.newPage();
  await other.clock.install({ time: new Date('2026-03-24T19:00:00Z') });
  await other.goto('/calendar');
  await expect(day(other, '2026-03-24')).toHaveAttribute('aria-label', /Office, actual/);
  await day(page, '2026-03-24').focus();
  await page.keyboard.press('d');
  await page.getByLabel('Notes', { exact: true }).fill('Stale edit');
  await other.getByRole('button', { name: 'Remote', exact: true }).click();
  await day(other, '2026-03-24').click();
  await expect(day(page, '2026-03-24')).toHaveAttribute('aria-label', /Remote, actual/);
  await page.getByRole('button', { name: 'Save day details' }).click();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByRole('alert')).toContainText('changed in another tab');
  await page.getByRole('button', { name: 'Discard pending edit' }).click();
  await expect(day(page, '2026-03-24')).toHaveAttribute('aria-label', /Remote, actual/);
});

test('offline reload retains logging and exports without attendance requests', async ({
  page,
  context,
  browserName,
}) => {
  test.skip(
    browserName === 'webkit',
    'Playwright WebKit does not support service-worker inspection; physical Safari release gate remains.',
  );
  const unexpected: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET') unexpected.push(request.method());
  });
  await setup(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect(page.getByText('Ready for offline use', { exact: false })).toBeVisible();
  await context.setOffline(true);
  await page.goto('/calendar');
  await day(page, '2026-03-24').click();
  await expect(day(page, '2026-03-24')).toHaveAttribute('aria-label', /Office, actual/);
  await expect(page.locator('.saved-status')).toHaveText('Saved on this browser');
  await page.reload();
  await expect(day(page, '2026-03-24')).toHaveAttribute('aria-label', /Office, actual/);
  await page.goto('/settings');
  const exported = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export attendance CSV' }).click();
  expect((await exported).suggestedFilename()).toBe('rto-attendance.csv');
  expect(unexpected).toEqual([]);
});

test('worker-generated plan requires preview, passes the horizon, and is one undoable change', async ({
  page,
}) => {
  await setup(page);
  await page.getByRole('button', { name: 'Preview suggested office days' }).click();
  await expect(page.getByRole('dialog')).toContainText('verified at every checkpoint');
  await page.getByRole('button', { name: /Apply \d+ planned office days/ }).click();
  await expect(
    page.getByRole('heading', { name: 'On track under recorded plan', exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Calendar', exact: true }).click();
  await expect(page.locator('.day.planned').first()).toBeVisible();
  await page.getByRole('button', { name: 'Undo last change' }).click();
  await expect(page.locator('.day.planned')).toHaveCount(0);
  await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'More planning needed', exact: true }),
  ).toBeVisible();
});

test('a policy-local date rollover invalidates an open schedule preview', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Preview suggested office days' }).click();
  await expect(page.getByRole('button', { name: /Apply \d+ planned office days/ })).toBeEnabled();
  await page.clock.setFixedTime(new Date('2026-03-25T19:00:00Z'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('dialog')).toContainText(
    'policy-local date changed since this preview',
  );
  await expect(page.getByRole('button', { name: /Apply \d+ planned office days/ })).toBeDisabled();
});

test('storage quota failures retain unsaved edits for export and retry without claiming success', async ({
  page,
}) => {
  await setup(page);
  await page.goto('/calendar');
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
      if (this.name === 'rows') {
        IDBObjectStore.prototype.put = original;
        throw new DOMException('Synthetic quota failure', 'QuotaExceededError');
      }
      return original.apply(this, args);
    };
  });
  await day(page, '2026-03-24').click();
  await expect(page.getByRole('alert')).toContainText('Your edit is not saved');
  await expect(page.locator('.saved-status')).toHaveText('Storage needs attention');
  await expect(day(page, '2026-03-24')).toHaveAttribute('aria-label', /unentered/);
  const exportEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export unsaved changes' }).click();
  expect((await exportEvent).suggestedFilename()).toBe('rto-unsaved-recovery.json');
  await page.getByRole('button', { name: 'Retry storage' }).click();
  await expect(day(page, '2026-03-24')).toHaveAttribute('aria-label', /Office, actual/);
  await expect(page.locator('.saved-status')).toHaveText('Saved on this browser');
});

test('pointer cancellation does not persist preview and reverse range supports all week starts', async ({
  page,
  context,
  isMobile,
}) => {
  await setup(page);
  for (const weekStart of ['1', '7', '6']) {
    await page.goto('/settings');
    await page.getByLabel('Policy week starts').selectOption(weekStart);
    await page.getByRole('button', { name: 'Preview policy', exact: true }).click();
    await page.getByRole('button', { name: 'Apply policy changes' }).click();
    await expect(page.getByText('Policy confirmed and saved on this browser.')).toBeVisible();
    await page.goto('/calendar');
    await day(page, '2026-03-27').evaluate((element) =>
      element.scrollIntoView({ block: 'center' }),
    );
    const box = (await day(page, '2026-03-27').boundingBox())!;
    if (isMobile) {
      const session = await context.newCDPSession(page);
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: box.x + 15, y: box.y + 15 }],
      });
      await expect(day(page, '2026-03-27')).toHaveClass(/range-preview/);
      await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
      await session.detach();
    } else {
      await page.mouse.move(box.x + 15, box.y + 15);
      await page.mouse.down();
      await expect(day(page, '2026-03-27')).toHaveClass(/range-preview/);
      await page
        .getByRole('grid')
        .dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse', isPrimary: true });
      await page.mouse.up();
    }
    await expect(day(page, '2026-03-27')).toHaveAttribute('aria-label', /unentered/);
    await page.getByLabel('From', { exact: true }).fill('2026-03-31');
    await page.getByLabel('Through', { exact: true }).fill('2026-03-27');
    await page.getByRole('button', { name: 'Apply selected tool' }).click();
    for (const date of ['2026-03-27', '2026-03-30', '2026-03-31'])
      await expect(day(page, date)).toHaveAttribute('aria-label', /Office, planned/);
    await expect(day(page, '2026-03-28')).toHaveAttribute('aria-label', /unentered/);
    await page.getByRole('button', { name: 'Undo last change' }).click();
    await expect(day(page, '2026-03-27')).toHaveAttribute('aria-label', /unentered/);
    await expect(page.locator('.saved-status')).toHaveText('Saved on this browser');
  }
});

test('saved civil dates and policy timezone survive device timezone changes', async ({
  page,
  context,
  browser,
}) => {
  await setup(page);
  await page.goto('/calendar');
  await day(page, '2026-03-24').click();
  await expect(page.locator('.saved-status')).toHaveText('Saved on this browser');
  await expect(day(page, '2026-03-24')).toHaveAttribute('aria-label', /Office, actual/);
  const saved = await context.storageState({ indexedDB: true });
  const travel = await browser.newContext({ storageState: saved, timezoneId: 'Asia/Tokyo' });
  try {
    const abroad = await travel.newPage();
    await abroad.clock.install({ time: new Date('2026-03-25T06:30:00Z') });
    await abroad.goto('http://127.0.0.1:4173/calendar');
    await expect(day(abroad, '2026-03-24')).toHaveAttribute('aria-label', /Office, actual.*today/);
    await abroad.goto('http://127.0.0.1:4173/settings');
    await expect(abroad.getByLabel('Policy timezone')).toHaveValue('America/Los_Angeles');
  } finally {
    await travel.close();
  }
});

test('an alternate origin has independent browser storage', async ({ page }) => {
  await setup(page);
  await page.goto('http://localhost:4173/dashboard');
  await expect(page.getByRole('heading', { name: 'Start with your policy' })).toBeVisible();
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Your office rhythm.' })).toBeVisible();
});

test('production CSP supports application assets and the planning worker without third-party requests', async ({
  page,
}) => {
  const headers = await readFile('public/_headers', 'utf8');
  const csp = headers
    .split('\n')
    .find((line) => line.trim().startsWith('Content-Security-Policy:'))!
    .split('Content-Security-Policy: ')[1];
  const violations: string[] = [];
  const thirdParty: string[] = [];
  page.on('console', (message) => {
    if (/violat|refused to/i.test(message.text())) violations.push(message.text());
  });
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== 'http://127.0.0.1:4173') thirdParty.push(request.url());
  });
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), 'content-security-policy': csp },
    });
  });
  await setup(page);
  await page.getByRole('button', { name: 'Preview suggested office days' }).click();
  await expect(page.getByRole('dialog')).toContainText('verified at every checkpoint');
  expect(violations).toEqual([]);
  expect(thirdParty).toEqual([]);
});
