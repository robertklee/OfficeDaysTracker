import { expect, test, type Page } from '@playwright/test';

async function openPlanner(page: Page) {
  await page.route('**/api/session', (route) => route.fulfill({ json: { user: null } }));
  await page.clock.setFixedTime(new Date('2026-03-24T19:00:00Z'));
  await page.goto('/dashboard');
  await page.getByLabel('Policy type').selectOption('weekly');
  await page.getByLabel('Start date', { exact: true }).fill('2026-03-22');
  await page.getByRole('button', { name: 'Preview policy', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm policy & start' }).click();
  await expect(page.getByRole('heading', { name: '3 office days' })).toBeVisible();
}

test('shared layouts reflow and navigation keeps accessible touch targets', async ({ page }) => {
  await openPlanner(page);
  for (const route of ['/dashboard', '/calendar', '/settings', '/account']) {
    await page.goto(route);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const active = page
      .getByRole('navigation', { name: 'Main navigation' })
      .locator('[aria-current="page"]');
    await expect(active).toHaveCount(1);
    await expect(active).toHaveAttribute('href', route);
    for (const width of [1440, 768, 760, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      const layout = await page.evaluate(() => {
        const nav = document.querySelector('.main-navigation')!;
        const bounds = nav.getBoundingClientRect();
        return {
          overflow: document.documentElement.scrollWidth > innerWidth,
          navigationVisible:
            bounds.left >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight,
          targets: [...nav.querySelectorAll('a')].map((element) => {
            const rect = element.getBoundingClientRect();
            return rect.width >= 44 && rect.height >= 44;
          }),
        };
      });
      expect(layout.overflow, `${route} at ${width}px`).toBe(false);
      expect(layout.navigationVisible, `${route} at ${width}px`).toBe(true);
      expect(layout.targets.every(Boolean)).toBe(true);
    }
  }
});

test('attendance colors have readable text and plans are distinct from logged days', async ({
  page,
}) => {
  await openPlanner(page);
  await page.locator('[data-date="2026-03-23"]').click();
  await page.locator('[data-date="2026-03-25"]').click();
  await page.getByRole('button', { name: 'Remote', exact: true }).click();
  await page.locator('[data-date="2026-03-24"]').click();
  await page.getByLabel('Time off', { exact: true }).selectOption('vacation');
  await page.locator('[data-date="2026-03-26"]').click();
  await page.getByLabel('Time off', { exact: true }).selectOption('sick');
  await page.locator('[data-date="2026-03-27"]').click();
  await page.getByLabel('Time off', { exact: true }).selectOption('holiday');
  await page.locator('[data-date="2026-03-28"]').click();
  await expect(page.locator('[data-date="2026-03-28"]')).toHaveAttribute(
    'aria-label',
    /Holiday, Planned/,
  );
  await expect(page.locator('[data-date="2026-03-23"]')).toHaveCSS('border-top-style', 'solid');
  await expect(page.locator('[data-date="2026-03-25"]')).toHaveCSS('border-top-style', 'dashed');
  const colors = await page.evaluate(() => {
    const pairs = [...document.querySelectorAll<HTMLElement>('.week-day')].map((day) => ({
      text: getComputedStyle(day.querySelector('.week-day-type')!).color,
      background: getComputedStyle(day).backgroundColor,
    }));
    const recommendation = document.querySelector('.recommendation .eyebrow')!;
    pairs.push({
      text: getComputedStyle(recommendation).color,
      background: getComputedStyle(document.querySelector('.week-summary')!).backgroundColor,
    });
    return pairs;
  });
  const luminance = (color: string) => {
    const [red, green, blue] = color
      .match(/\d+/g)!
      .slice(0, 3)
      .map((value) => {
        const channel = Number(value) / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
    return red * 0.2126 + green * 0.7152 + blue * 0.0722;
  };
  for (const pair of colors) {
    const values = [luminance(pair.text), luminance(pair.background)].sort((a, b) => b - a);
    expect((values[0] + 0.05) / (values[1] + 0.05), JSON.stringify(pair)).toBeGreaterThanOrEqual(
      4.5,
    );
  }
});

test('keyboard focus remains visible and reduced motion is respected', async ({
  page,
  browserName,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openPlanner(page);
  await page.getByRole('button', { name: 'Previous week', exact: true }).focus();
  // Safari on macOS uses Option+Tab to include buttons in keyboard navigation.
  await page.keyboard.press(
    browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab',
  );
  await expect(page.getByRole('button', { name: 'Next week', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Upcoming week' })).toBeVisible();
  const focus = await page
    .getByRole('button', { name: 'Next week', exact: true })
    .evaluate((button) => ({
      outlined: getComputedStyle(button).outlineStyle !== 'none',
      duration: getComputedStyle(button).transitionDuration,
    }));
  expect(focus.outlined).toBe(true);
  expect(focus.duration).toBe('0s');
  await page.getByRole('button', { name: 'Previous week', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'This week', exact: true })).toBeVisible();
  await page.locator('[data-date="2026-03-24"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('office-logged')).toHaveText('1');
});
