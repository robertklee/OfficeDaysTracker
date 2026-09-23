import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { addDays, dateRange } from '../src/domain/dates';
import { type Dataset } from '../src/domain/schema';

async function setup(page: Page, kind = 'rolling', weekStart = '1') {
  await page.clock.install({ time: new Date('2026-03-24T19:00:00Z') });
  await page.goto('/dashboard');
  await page.getByLabel('Policy type').selectOption(kind);
  await page.getByLabel('Week starts on').selectOption(weekStart);
  await page.getByLabel('Start date', { exact: true }).fill('2026-03-23');
  await page.getByRole('button', { name: 'Preview policy', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm policy & start' }).click();
  await expect(page.getByRole('heading', { name: 'This week', exact: true })).toBeVisible();
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
  await page.getByRole('checkbox', { name: 'Protect this day' }).check();
  await page.getByRole('button', { name: 'Save day', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await day(page, '2026-03-24').click();
  await expect(page.getByRole('dialog')).toContainText('protected');
  await page.getByRole('button', { name: 'Change protected days' }).click();
  await page.getByRole('button', { name: 'Undo last change' }).click();
  await expect(day(page, '2026-03-24')).toHaveAttribute('aria-label', /, protected/);
  await expect(page.locator('.saved-status')).toHaveText('Saved in this browser');
  await day(page, '2026-03-24').focus();
  await page.keyboard.press('d');
  await expect(page.getByLabel('Notes', { exact: true })).toHaveValue('Keep this note');
  await expect(page.getByRole('checkbox', { name: 'Protect this day' })).toBeChecked();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.reload();
  await expect(day(page, '2026-03-24')).toHaveAttribute('aria-label', /, protected/);
  for (const route of ['/settings', '/dashboard', '/calendar']) {
    await page.goto(route);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    if (route === '/dashboard') await expect(page.locator('.recommendation-value')).toBeVisible();
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

test('touch swipes scroll without painting and taps still edit one day', async ({
  page,
  context,
  isMobile,
}) => {
  test.skip(!isMobile, 'Requires a touch-enabled browser.');
  await page.setViewportSize({ width: 390, height: 740 });
  await setup(page);
  await page.goto('/calendar');
  const session = await context.newCDPSession(page);
  try {
    await day(page, '2026-03-24').scrollIntoViewIfNeeded();
    const box = (await day(page, '2026-03-24').boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const before = await page.evaluate(() => scrollY);
    expect(
      await page.locator('.calendar-grid').evaluate((grid) => getComputedStyle(grid).touchAction),
    ).toBe('auto');
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y }],
    });
    await expect(day(page, '2026-03-24')).not.toHaveClass(/range-preview/);
    for (let step = 1; step <= 5; step++)
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x, y: y - step * 28 }],
      });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(before + 20);
    await expect(day(page, '2026-03-24')).toHaveAttribute('aria-label', /unentered/);
    await expect(day(page, '2026-03-25')).toHaveAttribute('aria-label', /unentered/);
    await expect(page.locator('.save-announcement')).toBeEmpty();

    await day(page, '2026-03-25').evaluate((element) =>
      element.scrollIntoView({ block: 'center' }),
    );
    const from = (await day(page, '2026-03-25').boundingBox())!;
    const to = (await day(page, '2026-03-27').boundingBox())!;
    const startX = from.x + from.width / 2;
    const endX = to.x + to.width / 2;
    const rowY = from.y + from.height / 2;
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: startX, y: rowY }],
    });
    for (let step = 1; step <= 4; step++)
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: startX + ((endX - startX) * step) / 4, y: rowY }],
      });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    for (const date of ['2026-03-25', '2026-03-26', '2026-03-27'])
      await expect(day(page, date)).toHaveAttribute('aria-label', /unentered/);

    await day(page, '2026-03-24').tap();
    await expect(day(page, '2026-03-24')).toHaveAttribute('aria-label', /Office, actual/);
    await expect(day(page, '2026-03-25')).toHaveAttribute('aria-label', /unentered/);
  } finally {
    await session.detach();
  }
});

test('JSON backups export, validate before replacement and preserve actuals when clearing plans', async ({
  page,
}) => {
  await setup(page);
  await page.goto('/calendar');
  await day(page, '2026-03-24').click();
  await day(page, '2026-03-25').click();
  await page.getByRole('button', { name: 'Clear planned days', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Remove 1 plan?');
  await page.getByRole('button', { name: 'Remove 1 plan' }).click();
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
  await expect(page.getByRole('dialog')).toContainText('1 day');
  await page.getByRole('button', { name: 'Confirm replacement', exact: true }).click();
  await expect(page.getByText('Backup restored in this browser.')).toBeVisible();
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
  await page.getByRole('button', { name: 'Save day', exact: true }).click();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByRole('alert')).toContainText('changed in another tab');
  await page.getByRole('button', { name: 'Discard unsaved edit' }).click();
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
  await expect(page.locator('.saved-status')).toHaveText('Saved in this browser');
  await page.reload();
  await expect(day(page, '2026-03-24')).toHaveAttribute('aria-label', /Office, actual/);
  await page.goto('/settings');
  const exported = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export attendance CSV' }).click();
  expect((await exported).suggestedFilename()).toBe('rto-attendance.csv');
  expect(unexpected).toEqual([]);
});

test('weekly recommendations are counts only; quick entry saves actuals, plans and undo', async ({
  page,
}) => {
  await setup(page, 'weekly');
  await expect(page.getByRole('heading', { name: '3 office days' })).toBeVisible();
  await expect(page.locator('.week-day')).toHaveCount(7);
  await expect(page.locator('.week-day.office')).toHaveCount(0);
  await expect(page.getByTestId('office-logged')).toHaveText('0');
  await day(page, '2026-03-23').click();
  await expect(day(page, '2026-03-23')).toHaveAttribute('aria-label', /Office, Logged/);
  await expect(page.getByTestId('office-logged')).toHaveText('1');
  await page.getByRole('button', { name: 'Remote', exact: true }).click();
  await day(page, '2026-03-24').click();
  await expect(day(page, '2026-03-24')).toHaveAttribute('aria-label', /Remote, Logged/);
  await page.getByRole('button', { name: 'Office', exact: true }).click();
  await day(page, '2026-03-25').focus();
  await page.keyboard.press('Enter');
  await expect(day(page, '2026-03-25')).toHaveAttribute('aria-label', /Office, Planned/);
  await expect(page.getByTestId('office-planned')).toHaveText('1');
  await expect(page.getByText('1 more to plan', { exact: true })).toBeVisible();
  await page.getByLabel('Time off', { exact: true }).selectOption('sick');
  await day(page, '2026-03-26').click();
  await expect(day(page, '2026-03-26')).toHaveAttribute('aria-label', /Sick, Planned/);
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await day(page, '2026-03-26').click();
  await expect(day(page, '2026-03-26')).toHaveAttribute('aria-label', /Unentered/);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(day(page, '2026-03-26')).toHaveAttribute('aria-label', /Sick, Planned/);
  await page.locator('summary').filter({ hasText: 'Upcoming weeks' }).click();
  await expect(page.getByRole('columnheader', { name: 'Office days', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'More to plan' })).toBeVisible();
  await page.reload();
  await expect(day(page, '2026-03-23')).toHaveAttribute('aria-label', /Office, Logged/);
  await expect(day(page, '2026-03-25')).toHaveAttribute('aria-label', /Office, Planned/);
  await page.getByRole('link', { name: 'Calendar', exact: true }).click();
  await expect(day(page, '2026-03-23')).toHaveAttribute('aria-label', /Office, actual/);
  await expect(day(page, '2026-03-25')).toHaveAttribute('aria-label', /Office, planned/);
});

test('future-week cards distinguish a needed week from one that can be skipped', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-03-30T19:00:00Z') });
  await page.goto('/dashboard');
  await page.getByLabel('Week starts on').selectOption('1');
  await page.getByLabel('Calculation').selectOption('qualifying');
  await page.getByLabel('Best weeks counted').fill('1');
  await page.getByLabel('Weeks in window').fill('2');
  await page.getByLabel('Start date', { exact: true }).fill('2026-03-30');
  await page.getByRole('button', { name: 'Preview policy', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm policy & start' }).click();
  await expect(page.getByRole('heading', { name: 'This week', exact: true })).toBeVisible();
  for (const date of ['2026-03-30', '2026-03-31', '2026-04-01']) await day(page, date).click();
  await expect(day(page, '2026-04-01')).toHaveAttribute('aria-label', /Office, Planned/);
  await expect(page.locator('.saved-status')).toHaveText('Saved in this browser');
  await page.goto('/calendar');
  await page.getByRole('button', { name: 'Remote', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Include weekends in ranges' }).click();
  await expect(page.getByRole('checkbox', { name: 'Include weekends in ranges' })).toBeChecked();
  await page.getByLabel('From', { exact: true }).fill('2026-04-06');
  await page.getByLabel('Through', { exact: true }).fill('2026-04-12');
  await page.getByRole('button', { name: 'Apply to range' }).click();
  await expect(page.locator('.save-announcement')).toContainText('7 dates saved');
  await page.getByRole('button', { name: 'Next month' }).click();
  await expect(day(page, '2026-04-12')).toHaveAttribute('aria-label', /Remote, planned/);
  await page.goto('/dashboard');
  const cards = page.locator('.outlook-tile');
  await expect(cards).toHaveCount(6);
  await expect(cards.first()).toContainText('Flexible');
  await expect(cards.first()).toContainText('Could skip this week');
  await expect(cards.nth(1)).toContainText('Needed');
  await expect(cards.nth(1)).toContainText('3 office days suggested');
  await expect(page.getByText('May change', { exact: true })).toBeVisible();
  await expect(page.getByText(/Conditional: earlier weeks and unplanned days/)).toBeVisible();
  await cards.nth(1).click();
  await expect(page.getByText('Week of Apr 13, 2026', { exact: true })).toBeVisible();
  const recommendation = page.getByRole('region', { name: 'Attendance for week of Apr 13, 2026' });
  await expect(recommendation.getByText('At least 3 needed', { exact: true })).toBeVisible();
  await expect(recommendation.getByText('3 more to plan', { exact: true })).toBeVisible();
  await expect(cards.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await page.locator('summary').filter({ hasText: 'Upcoming weeks' }).click();
  await expect(page.getByRole('row', { name: /Apr 13, 2026 Needed 3 3 3/ })).toBeVisible();
});

test('the outlook is marked fully planned only when no forecast days remain open', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-03-30T19:00:00Z') });
  await page.goto('/dashboard');
  const first = '2026-03-30';
  const dataset: Dataset = {
    formatVersion: 1,
    policy: {
      kind: 'weekly',
      n: 2,
      windowWeeks: 4,
      weekStart: 1,
      startDate: first,
      timeZone: 'America/Los_Angeles',
    },
    preferences: { includeWeekends: false },
    records: dateRange(first, addDays(first, 90)).map((date, index) => ({
      date,
      type: index % 7 < 2 ? 'office' : 'remote',
      status: index === 0 ? 'actual' : 'planned',
      priority: 'normal',
      notes: '',
      revision: 1,
      createdAt: '2026-03-30T00:00:00.000Z',
      updatedAt: '2026-03-30T00:00:00.000Z',
    })),
  };
  await page.getByLabel('Import JSON backup').setInputFiles({
    name: 'planned-weeks.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(dataset)),
  });
  await page.getByRole('button', { name: 'Confirm replacement', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'This week', exact: true })).toBeVisible();
  await expect(page.getByText('All days planned', { exact: true })).toBeVisible();
  const firstWeek = page.locator('.outlook-tile').first();
  await expect(firstWeek).toContainText('Needed');
  await expect(firstWeek).toContainText('2 office days suggested');
  await firstWeek.click();
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await day(page, '2026-04-06').click();
  await expect(page.getByText('May change', { exact: true })).toBeVisible();
  await expect(firstWeek).toContainText('2 office days suggested');
});

test('new planners start on Sunday in both home and calendar', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-03-24T19:00:00Z') });
  await page.goto('/dashboard');
  await expect(page.getByLabel('Week starts on')).toHaveValue('7');
  await page.getByLabel('Policy type').selectOption('weekly');
  await expect(page.getByLabel('Week starts on')).toHaveValue('7');
  await page.getByLabel('Start date', { exact: true }).fill('2026-03-22');
  await page.getByRole('button', { name: 'Preview policy', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm policy & start' }).click();
  await expect(page.locator('.week-day').first()).toHaveAttribute('data-date', '2026-03-22');
  await expect(page.locator('.week-day').last()).toHaveAttribute('data-date', '2026-03-28');
  await expect(page.getByRole('heading', { name: '3 office days' })).toBeVisible();
  await page.reload();
  await expect(page.locator('.week-day').first()).toHaveAttribute('data-date', '2026-03-22');
  await page.getByRole('link', { name: 'Calendar', exact: true }).click();
  await expect(page.getByRole('columnheader').first()).toHaveAccessibleName('Sunday');
  await page.goto('/settings');
  await expect(page.getByLabel('Week starts on')).toHaveValue('7');
});

test('a new policy defaults to a full window, follows selections, and preserves a chosen date', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-03-24T19:00:00Z') });
  await page.goto('/dashboard');
  const startDate = page.getByLabel('Start date', { exact: true });
  await expect(startDate).toHaveValue('2025-12-28');
  await expect(page.getByText(/Unlogged past weeks may count as missed/)).toBeVisible();
  await page.getByLabel('Policy type').selectOption('weekly');
  await expect(startDate).toHaveValue('2026-02-22');
  await page.getByLabel('Reporting window (weeks)').fill('6');
  await expect(startDate).toHaveValue('2026-02-08');
  await page.getByLabel('Week starts on').selectOption('1');
  await expect(startDate).toHaveValue('2026-02-09');
  await page.getByLabel('Policy type').selectOption('weekdays');
  await expect(startDate).toHaveValue('2026-02-23');
  await startDate.fill('2026-03-23');
  await page.getByLabel('Reporting window (weeks)').fill('8');
  await page.getByLabel('Week starts on').selectOption('7');
  await page.getByLabel('Policy type').selectOption('weekly');
  await expect(startDate).toHaveValue('2026-03-23');
  await page.getByRole('button', { name: 'Preview policy', exact: true }).click();
  await expect(page.getByLabel('Policy preview')).toContainText('First full week: Mar 29, 2026');
  await page.getByRole('button', { name: 'Confirm policy & start' }).click();
  await expect(page.getByRole('heading', { name: 'This week', exact: true })).toBeVisible();
  await page.goto('/settings');
  await expect(startDate).toHaveValue('2026-03-23');
  await page.getByLabel('Policy type').selectOption('weekdays');
  await expect(startDate).toHaveValue('2026-03-23');
});

test('the full-window default applies today and discloses missing history', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.clock.install({ time: new Date('2026-03-24T19:00:00Z') });
  await page.goto('/dashboard');
  await expect(page.getByLabel('Start date', { exact: true })).toHaveValue('2025-12-28');
  await page.getByRole('button', { name: 'Preview policy', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expect(page.getByLabel('Policy preview')).toContainText('First full week: Dec 28, 2025');
  await page.getByRole('button', { name: 'Confirm policy & start' }).click();
  await expect(page.getByRole('heading', { name: 'Below target' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Review your plan' })).toBeVisible();
  await day(page, '2026-03-24').click();
  await expect(page.getByTestId('office-logged')).toHaveText('1');
});

test('the suggested start date uses the selected policy timezone', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-03-29T00:30:00Z') });
  await page.goto('/dashboard');
  const startDate = page.getByLabel('Start date', { exact: true });
  await expect(startDate).toHaveValue('2025-12-28');
  await page.getByLabel('Timezone').fill('Asia/Tokyo');
  await expect(startDate).toHaveValue('2026-01-04');
  await page.getByLabel('Policy type').selectOption('weekly');
  await expect(startDate).toHaveValue('2026-03-01');
  await page.getByLabel('Week starts on').selectOption('1');
  await expect(startDate).toHaveValue('2026-02-23');
  await page.clock.setFixedTime(new Date('2026-04-05T00:30:00Z'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(startDate).toHaveValue('2026-03-02');
  await startDate.fill('2026-03-01');
  await page.clock.setFixedTime(new Date('2026-04-12T00:30:00Z'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(startDate).toHaveValue('2026-03-01');
});

test('week navigation edits the displayed week, updates totals and preserves undo', async ({
  page,
}) => {
  await setup(page, 'weekly');
  await expect(page.getByRole('button', { name: 'This week', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Next week', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Upcoming week' })).toBeVisible();
  await expect(page.getByText('Week of Mar 30, 2026', { exact: true })).toBeVisible();
  await expect(page.locator('.week-day').first()).toHaveAttribute('data-date', '2026-03-30');
  await expect(page.getByRole('heading', { name: '3 office days' })).toBeVisible();
  await day(page, '2026-03-31').click();
  await expect(day(page, '2026-03-31')).toHaveAttribute('aria-label', /Office, Planned/);
  await expect(page.getByTestId('office-planned')).toHaveText('1');
  await expect(page.getByText('2 more to plan', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Previous week', exact: true }).click();
  await expect(page.getByTestId('office-planned')).toHaveText('0');
  await expect(page.getByRole('heading', { name: 'This week', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Previous week', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Past week' })).toBeVisible();
  await expect(page.getByText('Week in review', { exact: true })).toBeVisible();
  await expect(page.locator('.week-day').first()).toHaveAttribute('data-date', '2026-03-16');
  await day(page, '2026-03-18').click();
  await expect(day(page, '2026-03-18')).toHaveAttribute('aria-label', /Office, Logged/);
  await expect(page.getByTestId('office-logged')).toHaveText('1');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(day(page, '2026-03-18')).toHaveAttribute('aria-label', /Unentered/);
  await page.getByRole('button', { name: 'This week', exact: true }).click();
  await expect(page.locator('.week-day').first()).toHaveAttribute('data-date', '2026-03-23');
  await page.getByRole('button', { name: 'Next week', exact: true }).click();
  await expect(day(page, '2026-03-31')).toHaveAttribute('aria-label', /Office, Planned/);
  await expect(page.getByTestId('office-planned')).toHaveText('1');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'This week', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next week', exact: true }).click();
  await expect(day(page, '2026-03-31')).toHaveAttribute('aria-label', /Office, Planned/);
  await page.goto('/settings');
  await expect(page.getByLabel('Week starts on')).toHaveValue('1');
});

test('weeks outside the forecast remain editable without a loading target', async ({ page }) => {
  await setup(page, 'weekly');
  for (let i = 0; i < 12; i++)
    await page.getByRole('button', { name: 'Next week', exact: true }).click();
  await expect(page.getByText('Week of Jun 15, 2026', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '3 office days' })).toBeVisible();
  await page.getByRole('button', { name: 'Next week', exact: true }).click();
  await expect(page.getByText('Week of Jun 22, 2026', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No target available' })).toBeVisible();
  await expect(page.locator('.recommendation')).toHaveAttribute('aria-busy', 'false');
  await day(page, '2026-06-23').click();
  await expect(day(page, '2026-06-23')).toHaveAttribute('aria-label', /Office, Planned/);
  await expect(page.getByTestId('office-planned')).toHaveText('1');
  await page.getByRole('button', { name: 'This week', exact: true }).click();
  await expect(page.getByRole('heading', { name: '3 office days' })).toBeVisible();
  await expect(page.getByTestId('office-planned')).toHaveText('0');
});

test('browsing keeps the selected week across a Sunday rollover', async ({ page }) => {
  await setup(page, 'weekly', '7');
  await page.getByRole('button', { name: 'Previous week', exact: true }).click();
  await expect(page.locator('.week-day').first()).toHaveAttribute('data-date', '2026-03-15');
  await page.clock.setFixedTime(new Date('2026-03-29T06:59:00Z'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.week-day').first()).toHaveAttribute('data-date', '2026-03-15');
  await page.clock.setFixedTime(new Date('2026-03-29T07:01:00Z'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.week-day').first()).toHaveAttribute('data-date', '2026-03-15');
  await page.getByRole('button', { name: 'This week', exact: true }).click();
  await expect(page.locator('.week-day').first()).toHaveAttribute('data-date', '2026-03-29');
  await expect(day(page, '2026-03-29')).toHaveAttribute('aria-current', 'date');
  await page.clock.setFixedTime(new Date('2026-04-05T07:01:00Z'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.week-day').first()).toHaveAttribute('data-date', '2026-04-05');
  await expect(page.getByRole('button', { name: 'This week', exact: true })).toBeDisabled();
});

test('week navigation crosses year and DST boundaries without shifting dates', async ({ page }) => {
  await setup(page, 'weekly', '7');
  await page.clock.setFixedTime(new Date('2026-01-01T19:00:00Z'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.week-day').first()).toHaveAttribute('data-date', '2025-12-28');
  await expect(page.locator('.week-day').last()).toHaveAttribute('data-date', '2026-01-03');
  await page.getByRole('button', { name: 'Next week', exact: true }).click();
  await expect(page.locator('.week-day').first()).toHaveAttribute('data-date', '2026-01-04');
  await page.getByRole('button', { name: 'Previous week', exact: true }).click();
  await expect(page.locator('.week-day').first()).toHaveAttribute('data-date', '2025-12-28');
  await page.clock.setFixedTime(new Date('2026-03-08T19:00:00Z'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.week-day').first()).toHaveAttribute('data-date', '2026-03-08');
  await page.getByRole('button', { name: 'Next week', exact: true }).click();
  await expect(page.locator('.week-day').first()).toHaveAttribute('data-date', '2026-03-15');
  await expect(page.locator('.week-day').last()).toHaveAttribute('data-date', '2026-03-21');
});

test('weekly entry respects protected days and preserves notes', async ({ page }) => {
  await setup(page, 'weekly');
  await page.goto('/calendar');
  await day(page, '2026-03-24').focus();
  await page.keyboard.press('d');
  await page.getByLabel('Notes', { exact: true }).fill('Keep this note');
  await page.getByLabel('Protect this day').check();
  await page.getByRole('button', { name: 'Save day', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('link', { name: 'This week', exact: true }).click();
  await page.getByRole('button', { name: 'Remote', exact: true }).click();
  await day(page, '2026-03-24').click();
  await expect(page.getByRole('dialog')).toContainText('This day is protected');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(day(page, '2026-03-24')).toHaveAttribute('aria-label', /Office, Logged, protected/);
  await day(page, '2026-03-24').click();
  await page.getByRole('button', { name: 'Change day', exact: true }).click();
  await expect(day(page, '2026-03-24')).toHaveAttribute('aria-label', /Remote, Logged, protected/);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(day(page, '2026-03-24')).toHaveAttribute('aria-label', /Office, Logged, protected/);
  await page.goto('/calendar');
  await day(page, '2026-03-24').focus();
  await page.keyboard.press('d');
  await expect(page.getByLabel('Notes', { exact: true })).toHaveValue('Keep this note');
});

test('policy-local rollover refreshes targets without silently confirming past plans', async ({
  page,
}) => {
  await setup(page, 'weekly');
  await day(page, '2026-03-25').click();
  await expect(page.getByTestId('office-planned')).toHaveText('1');
  await expect(page.getByText('2 more to plan', { exact: true })).toBeVisible();
  await page.clock.setFixedTime(new Date('2026-03-26T19:00:00Z'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(day(page, '2026-03-25')).toHaveAttribute('aria-label', /Office, Needs confirmation/);
  await expect(day(page, '2026-03-26')).toHaveAttribute('aria-current', 'date');
  await expect(page.getByTestId('office-planned')).toHaveText('0');
  await expect(page.getByText('3 more to plan', { exact: true })).toBeVisible();
  await day(page, '2026-03-25').click();
  await expect(page.getByTestId('office-logged')).toHaveText('1');
  await expect(page.getByText('2 more to plan', { exact: true })).toBeVisible();
  await page.clock.setFixedTime(new Date('2026-03-30T19:00:00Z'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(day(page, '2026-03-24')).toHaveCount(0);
  await expect(day(page, '2026-03-30')).toHaveAttribute('aria-current', 'date');
  await expect(page.getByRole('heading', { name: 'Review your plan', exact: true })).toBeVisible();
});

test('320px week entry has no overflow and supports touch with 44px targets', async ({
  page,
  isMobile,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await setup(page, 'weekly');
  const measurements = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > innerWidth,
    targets: [
      ...document.querySelectorAll('.week-day, .attendance-tools button, .attendance-tools select'),
      ...document.querySelectorAll('.week-navigation button'),
    ].map((element) => ({
      width: element.getBoundingClientRect().width,
      height: element.getBoundingClientRect().height,
    })),
  }));
  expect(measurements.overflow).toBe(false);
  expect(measurements.targets.every((target) => target.width >= 44 && target.height >= 44)).toBe(
    true,
  );
  if (isMobile) await day(page, '2026-03-24').tap();
  else await day(page, '2026-03-24').click();
  await expect(page.getByTestId('office-logged')).toHaveText('1');
  await expect(day(page, '2026-03-24')).toHaveAttribute('aria-label', /Office, Logged/);
});

test.describe('recommendation failures', () => {
  test.use({ serviceWorkers: 'block' });

  test('a worker failure is visible, does not block logging, and can be retried', async ({
    page,
  }) => {
    const failures: string[] = [];
    page.on('pageerror', (error) => failures.push(error.message));
    const workerURL = '**/assets/planning.worker-*.js';
    await page.route(workerURL, (route) =>
      route.fulfill({
        contentType: 'text/javascript',
        body: 'self.onmessage = () => { throw new Error("Synthetic worker failure"); };',
      }),
    );
    await setup(page, 'weekly');
    await expect(page.getByRole('heading', { name: 'Target unavailable' })).toBeVisible();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Could not calculate weekly targets' }),
    ).toBeVisible();
    await day(page, '2026-03-24').click();
    await expect(page.getByTestId('office-logged')).toHaveText('1');
    await expect(page.getByRole('button', { name: 'Retry target' })).toBeVisible();
    await page.unroute(workerURL);
    await page.getByRole('button', { name: 'Retry target' }).click();
    await expect(page.getByRole('heading', { name: '3 office days' })).toBeVisible();
    await expect(page.getByText('2 more to plan', { exact: true })).toBeVisible();
    expect(failures).toEqual([]);
  });
});

test('partial first weeks and required-weekday policies have clear targets', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-03-24T19:00:00Z') });
  await page.goto('/dashboard');
  await page.getByLabel('Start date', { exact: true }).fill('2026-03-24');
  await page.getByRole('button', { name: 'Preview policy', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm policy & start' }).click();
  await expect(page.getByRole('heading', { name: 'No target yet' })).toBeVisible();
  await day(page, '2026-03-24').click();
  await expect(page.getByTestId('office-logged')).toHaveText('1');
  await page.goto('/settings');
  await page.getByLabel('Policy type').selectOption('weekdays');
  await page.getByLabel('Week starts on').selectOption('1');
  await page.getByLabel('Start date', { exact: true }).fill('2026-03-23');
  await page.getByRole('button', { name: 'Preview policy', exact: true }).click();
  await page.getByRole('button', { name: 'Apply policy changes' }).click();
  await expect(page.getByText('Policy saved in this browser.')).toBeVisible();
  await page.getByRole('link', { name: 'This week', exact: true }).click();
  await expect(page.getByRole('heading', { name: '3 office days' })).toBeVisible();
  await expect(
    page.getByText(
      'Your policy requires Tuesday, Wednesday, Thursday. Other days do not substitute.',
    ),
  ).toBeVisible();
  await day(page, '2026-03-27').click();
  await expect(page.getByRole('heading', { name: '4 office days' })).toBeVisible();
  await expect(page.getByText('2 more to plan', { exact: true })).toBeVisible();
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
  await expect(page.locator('.saved-status')).toHaveText('Storage error');
  await expect(day(page, '2026-03-24')).toHaveAttribute('aria-label', /unentered/);
  const exportEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export unsaved changes' }).click();
  expect((await exportEvent).suggestedFilename()).toBe('rto-unsaved-recovery.json');
  await page.getByRole('button', { name: 'Retry storage' }).click();
  await expect(day(page, '2026-03-24')).toHaveAttribute('aria-label', /Office, actual/);
  await expect(page.locator('.saved-status')).toHaveText('Saved in this browser');
});

test('pointer cancellation does not persist preview and reverse range supports all week starts', async ({
  page,
  context,
  isMobile,
}) => {
  await setup(page);
  for (const weekStart of ['1', '7', '6']) {
    await page.goto('/settings');
    await page.getByLabel('Week starts on').selectOption(weekStart);
    await page.getByRole('button', { name: 'Preview policy', exact: true }).click();
    await page.getByRole('button', { name: 'Apply policy changes' }).click();
    await expect(page.getByText('Policy saved in this browser.')).toBeVisible();
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
      await expect(day(page, '2026-03-27')).not.toHaveClass(/range-preview/);
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
    await page.getByRole('button', { name: 'Apply to range' }).click();
    for (const date of ['2026-03-27', '2026-03-30', '2026-03-31'])
      await expect(day(page, date)).toHaveAttribute('aria-label', /Office, planned/);
    await expect(day(page, '2026-03-28')).toHaveAttribute('aria-label', /unentered/);
    await page.getByRole('button', { name: 'Undo last change' }).click();
    await expect(day(page, '2026-03-27')).toHaveAttribute('aria-label', /unentered/);
    await expect(page.locator('.saved-status')).toHaveText('Saved in this browser');
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
  await expect(page.locator('.saved-status')).toHaveText('Saved in this browser');
  await expect(day(page, '2026-03-24')).toHaveAttribute('aria-label', /Office, actual/);
  const saved = await context.storageState({ indexedDB: true });
  const travel = await browser.newContext({ storageState: saved, timezoneId: 'Asia/Tokyo' });
  try {
    const abroad = await travel.newPage();
    await abroad.clock.install({ time: new Date('2026-03-25T06:30:00Z') });
    await abroad.goto('http://127.0.0.1:4173/calendar');
    await expect(day(abroad, '2026-03-24')).toHaveAttribute('aria-label', /Office, actual.*today/);
    await abroad.goto('http://127.0.0.1:4173/settings');
    await expect(abroad.getByLabel('Timezone')).toHaveValue('America/Los_Angeles');
  } finally {
    await travel.close();
  }
});

test('an alternate origin has independent browser storage', async ({ page }) => {
  await setup(page);
  await page.goto('http://localhost:4173/dashboard');
  await expect(page.getByRole('heading', { name: 'Start with your policy' })).toBeVisible();
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'This week', exact: true })).toBeVisible();
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
  await expect(page.locator('.recommendation-value')).toBeVisible();
  expect(violations).toEqual([]);
  expect(thirdParty).toEqual([]);
});
