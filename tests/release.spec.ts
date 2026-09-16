import { expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { dateRange } from '../src/domain/dates';
import { type Dataset } from '../src/domain/schema';

test('five-year mobile-sized dataset meets feedback and full recalculation budgets', async ({
  page,
  browser,
  browserName,
  isMobile,
}, info) => {
  test.skip(
    browserName !== 'chromium',
    'Record the performance baseline in desktop and mobile Chromium.',
  );
  await page.clock.setFixedTime(new Date('2026-03-24T19:00:00Z'));
  await page.goto('/settings');
  const dataset: Dataset = {
    formatVersion: 1,
    policy: {
      kind: 'rolling',
      mode: 'qualifying',
      x: 35,
      y: 52,
      n: 3,
      weekStart: 1,
      startDate: '2021-03-24',
      timeZone: 'America/Los_Angeles',
    },
    preferences: { includeWeekends: false },
    records: dateRange('2021-03-24', '2026-03-24').map((date) => ({
      date,
      type: 'office',
      status: 'actual',
      priority: 'normal',
      notes: '',
      revision: 1,
      createdAt: '2021-03-24T00:00:00.000Z',
      updatedAt: '2021-03-24T00:00:00.000Z',
    })),
  };
  await page.getByLabel('Import JSON backup').setInputFiles({
    name: 'synthetic-five-years.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(dataset)),
  });
  await page.getByRole('button', { name: 'Confirm replacement', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings & backups' })).toBeVisible();
  await page.goto('/dashboard');
  await expect(page.getByText('Current + next 52 weeks')).toBeVisible();
  const elapsed = page.evaluate(
    () =>
      new Promise<number>((resolveMeasurement) => {
        const button = [...document.querySelectorAll('button')].find(
          (value) => value.textContent === 'Working remotely',
        )!;
        button.addEventListener(
          'click',
          () => {
            const start = performance.now();
            const metric = document.querySelector('.metrics .metric-value')!;
            const observer = new MutationObserver(() => {
              if (metric.textContent?.trim().startsWith('1')) {
                observer.disconnect();
                resolveMeasurement(performance.now() - start);
              }
            });
            observer.observe(metric, { childList: true, subtree: true, characterData: true });
          },
          { once: true },
        );
      }),
  );
  await page.getByRole('button', { name: 'Working remotely', exact: true }).click();
  const recalculationMs = await elapsed;
  expect(recalculationMs).toBeLessThan(500);
  await page.goto('/calendar');
  const target = page.locator('[data-date="2026-03-25"]');
  await target.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  const feedback = page.evaluate(
    () =>
      new Promise<number>((resolveMeasurement) => {
        const button = document.querySelector('[data-date="2026-03-25"]')!;
        button.addEventListener(
          'pointerdown',
          () => {
            const start = performance.now();
            const observer = new MutationObserver(() => {
              if (button.classList.contains('range-preview')) {
                observer.disconnect();
                resolveMeasurement(performance.now() - start);
              }
            });
            observer.observe(button, { attributes: true, attributeFilter: ['class'] });
          },
          { capture: true, once: true },
        );
      }),
  );
  if (isMobile) await target.tap();
  else await target.click();
  const feedbackMs = await feedback;
  expect(feedbackMs).toBeLessThan(100);
  const measurement = {
    browser: browser.version(),
    profile: info.project.name,
    host: `${process.platform}/${process.arch}`,
    records: dataset.records.length,
    horizonWeeks: 52,
    recalculationMs,
    feedbackMs,
    physicalMobileDevice: false,
  };
  await info.attach('performance-baseline', {
    body: JSON.stringify(measurement, null, 2),
    contentType: 'application/json',
  });
  console.info('Performance baseline:', JSON.stringify(measurement));
});

test('a real service-worker update prompts without reloading an open notes draft', async ({
  page,
  browserName,
  isMobile,
}) => {
  test.skip(
    browserName !== 'chromium' || isMobile,
    'One real service-worker lifecycle check on Chromium.',
  );
  const root = resolve('dist');
  let version = 1;
  const mime: Record<string, string> = {
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.html': 'text/html',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.webmanifest': 'application/manifest+json',
  };
  const server = createServer((request, response) => {
    void (async () => {
      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
      let file = resolve(root, `.${pathname}`);
      if (!file.startsWith(`${root}/`) || !extname(file)) file = resolve(root, 'index.html');
      try {
        const content = await readFile(file);
        response.writeHead(200, {
          'Content-Type': mime[extname(file)] ?? 'application/octet-stream',
          'Cache-Control': 'no-store',
        });
        response.end(
          pathname === '/sw.js'
            ? `${content.toString()}\n// Synthetic deployment ${version}\n`
            : content,
        );
      } catch {
        response.writeHead(404);
        response.end('Not found');
      }
    })();
  });
  await new Promise<void>((resolveListening) => server.listen(0, '127.0.0.1', resolveListening));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind a port.');
  try {
    await page.clock.setFixedTime(new Date('2026-03-24T19:00:00Z'));
    await page.goto(`http://127.0.0.1:${address.port}/dashboard`);
    await page.getByRole('button', { name: 'Preview policy', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm policy & start' }).click();
    await expect(page.getByRole('heading', { name: 'Your office rhythm.' })).toBeVisible();
    await expect(page.locator('.saved-status')).toHaveText('Saved on this browser');
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await page.getByRole('link', { name: 'Calendar', exact: true }).click();
    await page.locator('[data-date="2026-03-24"]').click();
    await expect(page.locator('[data-date="2026-03-24"]')).toHaveAttribute(
      'aria-label',
      /Office, actual/,
    );
    await expect(page.locator('.saved-status')).toHaveText('Saved on this browser');
    await page.locator('[data-date="2026-03-24"]').focus();
    await page.keyboard.press('d');
    await page.getByLabel('Notes', { exact: true }).fill('Unfinished synthetic draft');
    version = 2;
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      await registration.update();
    });
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByLabel('Notes', { exact: true })).toHaveValue(
      'Unfinished synthetic draft',
    );
    await page.getByRole('button', { name: 'Close dialog' }).click();
    await expect(page.getByRole('button', { name: 'Review app update' })).toBeVisible();
    await page.getByRole('button', { name: 'Review app update' }).click();
    await expect(page.getByRole('dialog')).toContainText(
      'Unfinished ranges, notes, and policy drafts will be discarded',
    );
    await page.getByRole('button', { name: 'Confirm reload' }).click();
    await expect(page.locator('[data-date="2026-03-24"]')).toHaveAttribute(
      'aria-label',
      /Office, actual/,
    );
  } finally {
    await page.close();
    server.closeAllConnections();
    await new Promise<void>((resolveClosed, reject) =>
      server.close((error) => (error ? reject(error) : resolveClosed())),
    );
  }
});
