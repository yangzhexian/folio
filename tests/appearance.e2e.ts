import { expect, test } from '@playwright/test';

test('defaults to sage and light and persists appearance across reload and language changes', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'sage');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  await expect(settings.getByRole('button', { name: 'Light', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(settings.getByRole('button', { name: 'Sage', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await settings.getByRole('button', { name: 'Dark', exact: true }).click();
  await settings.getByRole('button', { name: 'Violet', exact: true }).click();
  await expect(settings.getByRole('button', { name: 'Dark', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(settings.getByRole('button', { name: 'Violet', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: 'artifacts/preview-appearance-settings.png', fullPage: true });
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'violet');
  await page.getByRole('button', { name: 'Language', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'violet');
  await page.screenshot({ path: 'artifacts/preview-dark-zh.png', fullPage: true });
});

test('applies every accent in light and dark modes and supports the quick theme toggle', async ({ page }) => {
  await page.goto('/');
  const lightBackground = await page.locator('html').evaluate(node => getComputedStyle(node).backgroundColor);
  await page.getByRole('button', { name: 'Switch to dark theme', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  for (const mode of ['Light', 'Dark']) {
    await settings.getByRole('button', { name: mode, exact: true }).click();
    const renderedColors = new Set<string>();
    for (const accent of ['Sage', 'Blue', 'Violet', 'Rose', 'Amber']) {
      await settings.getByRole('button', { name: accent, exact: true }).click();
      await expect(settings.getByRole('button', { name: accent, exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('html')).toHaveAttribute('data-accent', accent.toLowerCase());
      const centers = await settings.getByRole('button', { name: accent, exact: true }).evaluate(button => {
        const ring = button.getBoundingClientRect();
        const swatch = button.querySelector('.accent-swatch')!.getBoundingClientRect();
        return { x: Math.abs(ring.x + ring.width / 2 - swatch.x - swatch.width / 2), y: Math.abs(ring.y + ring.height / 2 - swatch.y - swatch.height / 2) };
      });
      expect(centers.x).toBeLessThanOrEqual(0.5);
      expect(centers.y).toBeLessThanOrEqual(0.5);
      renderedColors.add(await page.locator('.compact-create').evaluate(node => getComputedStyle(node).backgroundColor));
    }
    expect(renderedColors.size).toBe(5);
  }
  await settings.getByRole('button', { name: 'Blue', exact: true }).click();
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  const darkBackground = await page.locator('html').evaluate(node => getComputedStyle(node).backgroundColor);
  expect(darkBackground).not.toBe(lightBackground);
  await page.setViewportSize({ width: 900, height: 620 });
  await expect(page.getByRole('button', { name: 'Switch to light theme', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/preview-dark-compact.png', fullPage: true });
  await page.getByRole('button', { name: 'Switch to light theme', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'blue');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await settings.getByRole('button', { name: 'Reset appearance', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'sage');
});

test('falls back to the default appearance for invalid saved preferences', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('folio.theme', 'unsupported-theme');
    localStorage.setItem('folio.accent', 'unsupported-accent');
  });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'sage');
});
