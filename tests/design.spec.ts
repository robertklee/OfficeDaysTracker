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

function linearChannels(color: string): number[] {
  return color
    .match(/\d+/g)!
    .slice(0, 3)
    .map((value) => {
      const channel = Number(value) / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
}

function luminance(color: string): number {
  const [red, green, blue] = linearChannels(color);
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function contrast(a: string, b: string): number {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function colorDistance(a: string, b: string): number {
  const toLab = (color: string) => {
    const [red, green, blue] = linearChannels(color);
    const light = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
    const medium = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
    const short = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
    return [
      0.2104542553 * light + 0.793617785 * medium - 0.0040720468 * short,
      1.9779984951 * light - 2.428592205 * medium + 0.4505937099 * short,
      0.0259040371 * light + 0.7827717662 * medium - 0.808675766 * short,
    ];
  };
  const first = toLab(a);
  const second = toLab(b);
  return Math.hypot(...first.map((value, index) => value - second[index]));
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
  for (const pair of colors) {
    expect(contrast(pair.text, pair.background), JSON.stringify(pair)).toBeGreaterThanOrEqual(4.5);
  }
});

test('calendar types have distinct fills and markers with readable text at phone widths', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openPlanner(page);
  await page.goto('/calendar');
  const entries = [
    { date: '2026-03-23', type: 'Office' },
    { date: '2026-03-24', type: 'Remote' },
    { date: '2026-03-25', type: 'Vacation' },
    { date: '2026-03-26', type: 'Sick' },
    { date: '2026-03-27', type: 'Holiday' },
  ];
  for (const { date, type } of entries) {
    if (type === 'Office' || type === 'Remote')
      await page.getByRole('button', { name: type, exact: true }).click();
    else await page.getByLabel('Time off', { exact: true }).selectOption(type.toLowerCase());
    await page.locator(`[data-date="${date}"]`).click();
    await expect(page.locator(`[data-date="${date}"]`)).toHaveAttribute(
      'aria-label',
      new RegExp(type),
    );
    await expect(page.locator(`[data-date="${date}"]`)).not.toHaveClass(/range-preview/);
  }
  const swatches = await page.evaluate(
    (dates) =>
      dates.map((date) => {
        const day = document.querySelector<HTMLElement>(`[data-date="${date}"]`)!;
        return {
          type: day.classList[1],
          text: getComputedStyle(day).color,
          fill: getComputedStyle(day).backgroundColor,
          marker: getComputedStyle(day, '::before').backgroundColor,
          markerHeight: getComputedStyle(day, '::before').height,
          borderStyle: getComputedStyle(day).borderTopStyle,
          badge: day.querySelector('.plan-badge')?.textContent,
        };
      }),
    entries.map(({ date }) => date),
  );
  for (const [index, swatch] of swatches.entries()) {
    expect(contrast(swatch.text, swatch.fill), swatch.type).toBeGreaterThanOrEqual(4.5);
    expect(swatch.borderStyle).toBe(index < 2 ? 'solid' : 'dashed');
    expect(swatch.markerHeight).toBe(index < 2 ? '4px' : '2px');
    expect(swatch.badge).toBe(index < 2 ? undefined : 'Plan');
    for (const previous of swatches.slice(0, index)) {
      expect(
        colorDistance(swatch.fill, previous.fill),
        `${swatch.type}/${previous.type} fills`,
      ).toBeGreaterThan(0.055);
      expect(
        colorDistance(swatch.marker, previous.marker),
        `${swatch.type}/${previous.type} markers`,
      ).toBeGreaterThan(0.085);
    }
  }
  const weekend = await page.locator('[data-date="2026-03-28"]').evaluate((day) => ({
    number: getComputedStyle(day.querySelector('.day-number')!).color,
    fill: getComputedStyle(day).backgroundColor,
  }));
  expect(contrast(weekend.number, weekend.fill)).toBeGreaterThanOrEqual(4.5);
  const legend = page.locator('.legend');
  for (const { type } of entries)
    await expect(legend.locator(`.${type.toLowerCase()}-dot`)).toHaveText(type);
  await expect(legend).toContainText('Dashed = planned');
  for (const type of ['vacation', 'sick', 'holiday']) {
    await page.getByLabel('Time off', { exact: true }).selectOption(type);
    const selectColor = await page
      .getByLabel('Time off', { exact: true })
      .evaluate((select) => getComputedStyle(select).color);
    expect(selectColor).toBe(
      swatches[entries.findIndex((entry) => entry.type.toLowerCase() === type)].text,
    );
  }
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const layout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      widths: [...document.querySelectorAll<HTMLElement>('.calendar-row [data-date]')].map(
        (day) => day.getBoundingClientRect().width,
      ),
    }));
    expect(layout.overflow, `${width}px`).toBe(false);
    expect(Math.min(...layout.widths), `${width}px`).toBeGreaterThanOrEqual(44);
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
