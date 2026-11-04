import { expect, test, type Page } from '@playwright/test';

const masked = '••••••••••••';
const alphaSecret = 'DEMO-ALPHA-REFERENCE';
const betaSecret = 'DEMO-BETA-REFERENCE';
const privateEmail = 'private-alpha@example.invalid';
const emptyField = { id: 'empty', label: 'Empty private value', labelZh: '未填写的私密字段', value: '', kind: 'text', sensitive: true };
const publicField = { id: 'public', label: 'Public name', labelZh: '公开名称', value: 'Synthetic public name', kind: 'text', sensitive: false };
const baseRecord = { category: 'custom', subtitle: '', tags: [], favorite: false, notes: '', createdAt: '2026-11-01T09:00:00.000Z' };
const snapshot = {
  dataDir: 'C:\\SyntheticVisibility', attachments: [],
  records: [
    { ...baseRecord, id: '00000000-0000-4000-8000-000000000801', title: 'Synthetic Alpha', updatedAt: '2026-11-04T09:00:00.000Z', fields: [
      publicField,
      { id: 'reference', label: 'Private reference', labelZh: '私密编号', value: alphaSecret, kind: 'text', sensitive: true },
      { id: 'email', label: 'Private email', labelZh: '私密邮箱', value: privateEmail, kind: 'email', sensitive: true },
      emptyField,
    ] },
    { ...baseRecord, id: '00000000-0000-4000-8000-000000000802', title: 'Synthetic Beta', updatedAt: '2026-11-03T09:00:00.000Z', fields: [
      publicField,
      { id: 'reference', label: 'Private reference', labelZh: '私密编号', value: betaSecret, kind: 'text', sensitive: true },
    ] },
    { ...baseRecord, id: '00000000-0000-4000-8000-000000000803', title: 'Synthetic Public', updatedAt: '2026-11-02T09:00:00.000Z', fields: [publicField, emptyField] },
  ],
};

async function openSyntheticLibrary(page: Page) {
  await page.route('http://127.0.0.1:1420/', async route => {
    const response = await route.fetch();
    const html = await response.text();
    const bootstrap = `
      import { mockIPC, mockWindows } from '/node_modules/@tauri-apps/api/mocks.js';
      globalThis.isTauri = true;
      mockWindows('main');
      const state = globalThis.__folioSensitiveVisibility = { snapshot: ${JSON.stringify(snapshot)}, clipboard: null, bootstrapStatus: 'loading', bootstrapError: null };
      mockIPC(async (command, args) => {
        if (command === 'load_snapshot') return structuredClone(state.snapshot);
        if (command === 'plugin:clipboard-manager|write_text') { state.clipboard = args.text; return; }
        if (command.startsWith('plugin:window|')) return;
        throw new Error('Unmocked synthetic command: ' + command);
      }, { shouldMockEvents: true });
      try {
        await import('/src/main.tsx');
        state.bootstrapStatus = 'ready';
      } catch (error) {
        state.bootstrapError = String(error);
        state.bootstrapStatus = 'error';
      }
    `;
    const entry = /<script type="module" src="\/src\/main\.tsx(?:\?[^\"]*)?"><\/script>/;
    expect(html).toMatch(entry);
    await route.fulfill({ response, body: html.replace(entry, () => `<script type="module">${bootstrap}</script>`) });
  });
  await page.goto('/');
  await waitForSyntheticBootstrap(page);
  await expect(page.getByRole('heading', { name: 'Synthetic Alpha', exact: true })).toBeVisible();
}

async function waitForSyntheticBootstrap(page: Page) {
  // Navigation's load event can precede this test's dynamic module import. Wait for
  // the actual bootstrap rather than spending UI assertion time on Vite imports.
  await page.waitForFunction(() => ['ready', 'error'].includes((window as any).__folioSensitiveVisibility?.bootstrapStatus));
  expect(await page.evaluate(() => (window as any).__folioSensitiveVisibility.bootstrapError)).toBeNull();
}

async function reloadSyntheticLibrary(page: Page) {
  await page.reload();
  await waitForSyntheticBootstrap(page);
}

const field = (page: Page, id: string) => page.locator(`.detail-pane .field-row[data-field-id="${id}"]`);
const details = (page: Page) => page.locator('.detail-pane .detail-section').first();
const clipboard = (page: Page) => page.evaluate(() => (window as any).__folioSensitiveVisibility.clipboard);

async function openSettings(page: Page, locale: 'en' | 'zh' = 'en') {
  await page.getByRole('button', { name: locale === 'en' ? 'Settings' : '设置', exact: true }).click();
  return page.getByRole('dialog', { name: locale === 'en' ? 'Settings' : '设置', exact: true });
}

async function expectRecordToggle(page: Page, state: 'show' | 'hide') {
  const button = details(page).getByRole('button', { name: state === 'show' ? 'Show sensitive fields' : 'Hide sensitive fields', exact: true });
  await expect(button).toBeVisible();
  await expect(button.locator(state === 'show' ? 'svg.lucide-eye' : 'svg.lucide-eye-off')).toHaveCount(1);
  return button;
}

test('masks populated sensitive fields by default and keeps empty and public fields usable', async ({ page }) => {
  await openSyntheticLibrary(page);
  await expect(field(page, 'reference').locator('.field-value')).toHaveText(masked);
  await expect(field(page, 'email').locator('.field-value')).toHaveText(masked);
  await expect(field(page, 'public').locator('.field-value')).toHaveText(publicField.value);
  await expect(field(page, 'empty').locator('.field-value')).toHaveText('Not set');
  await expect(field(page, 'empty').getByRole('button', { name: 'Show value', exact: true })).toHaveCount(0);
  await expect(field(page, 'empty').getByRole('button', { name: 'Copy Empty private value', exact: true })).toBeDisabled();
  await expect(details(page).getByRole('button', { name: 'Show value', exact: true })).toHaveCount(2);
  await expectRecordToggle(page, 'show');
  const settings = await openSettings(page);
  await expect(settings.getByRole('switch', { name: 'Hide sensitive fields', exact: true })).toBeChecked();
});

test('keeps the record toggle in sync with individual reveals and resets visibility when records change', async ({ page }) => {
  await openSyntheticLibrary(page);
  await field(page, 'reference').getByRole('button', { name: 'Show value', exact: true }).click();
  await expect(field(page, 'reference').locator('.field-value')).toHaveText(alphaSecret);
  await expect(field(page, 'email').locator('.field-value')).toHaveText(masked);
  await expectRecordToggle(page, 'show');
  await field(page, 'email').getByRole('button', { name: 'Show value', exact: true }).click();
  await expectRecordToggle(page, 'hide');
  await field(page, 'reference').getByRole('button', { name: 'Hide value', exact: true }).click();
  await expect(field(page, 'reference').locator('.field-value')).toHaveText(masked);
  await expectRecordToggle(page, 'show');
  await (await expectRecordToggle(page, 'show')).click();
  await expect(field(page, 'reference').locator('.field-value')).toHaveText(alphaSecret);
  await expect(field(page, 'email').locator('.field-value')).toHaveText(privateEmail);
  await (await expectRecordToggle(page, 'hide')).click();
  await expect(field(page, 'reference').locator('.field-value')).toHaveText(masked);
  await expect(field(page, 'email').locator('.field-value')).toHaveText(masked);
  await (await expectRecordToggle(page, 'show')).click();
  await page.getByRole('textbox', { name: 'Search records, fields, files…' }).fill('reference');
  await expect(page.locator('.field-result-value')).toHaveText([masked, masked]);
  await expect(field(page, 'reference').locator('.field-value')).toHaveText(alphaSecret);
  await page.getByRole('textbox', { name: 'Search records, fields, files…' }).fill('');
  await page.locator('.record-card').filter({ hasText: 'Synthetic Beta' }).click();
  await expect(field(page, 'reference').locator('.field-value')).toHaveText(masked);
  await (await expectRecordToggle(page, 'show')).click();
  await expect(field(page, 'reference').locator('.field-value')).toHaveText(betaSecret);
  await page.locator('.record-card').filter({ hasText: 'Synthetic Alpha' }).click();
  await expect(field(page, 'reference').locator('.field-value')).toHaveText(masked);
  await expect(field(page, 'email').locator('.field-value')).toHaveText(masked);
  await page.locator('.record-card').filter({ hasText: 'Synthetic Public' }).click();
  await expect(details(page).getByRole('button', { name: /^(Show|Hide) sensitive fields$/ })).toHaveCount(0);
  await expect(details(page).getByRole('button', { name: 'Copy record', exact: true })).toBeVisible();
});

test('persists the masking preference, applies it to search results, and clears earlier reveals when enabled again', async ({ page }) => {
  await openSyntheticLibrary(page);
  await (await expectRecordToggle(page, 'show')).click();
  let settings = await openSettings(page);
  await settings.getByRole('switch', { name: 'Hide sensitive fields', exact: true }).click();
  await expect(settings.getByRole('switch', { name: 'Hide sensitive fields', exact: true })).not.toBeChecked();
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(field(page, 'reference').locator('.field-value')).toHaveText(alphaSecret);
  await expect(field(page, 'email').locator('.field-value')).toHaveText(privateEmail);
  await expect(details(page).getByRole('button', { name: /^(Show value|Hide value|Show sensitive fields|Hide sensitive fields)$/ })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Search records, fields, files…' }).fill('reference');
  await expect(page.locator('.field-result-value')).toHaveText([alphaSecret, betaSecret]);
  settings = await openSettings(page);
  await settings.getByRole('switch', { name: 'Hide sensitive fields', exact: true }).click();
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(field(page, 'reference').locator('.field-value')).toHaveText(masked);
  await expect(field(page, 'email').locator('.field-value')).toHaveText(masked);
  await expect(page.locator('.field-result-value')).toHaveText([masked, masked]);
  await (await expectRecordToggle(page, 'show')).click();
  settings = await openSettings(page);
  await settings.getByRole('switch', { name: 'Hide sensitive fields', exact: true }).click();
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  await reloadSyntheticLibrary(page);
  await expect(field(page, 'reference').locator('.field-value')).toHaveText(alphaSecret);
  await expect(details(page).getByRole('button', { name: /^(Show value|Hide value|Show sensitive fields|Hide sensitive fields)$/ })).toHaveCount(0);
  settings = await openSettings(page);
  await expect(settings.getByRole('switch', { name: 'Hide sensitive fields', exact: true })).not.toBeChecked();
  await settings.getByRole('switch', { name: 'Hide sensitive fields', exact: true }).click();
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(field(page, 'reference').locator('.field-value')).toHaveText(masked);
  await expect(field(page, 'email').locator('.field-value')).toHaveText(masked);
  await expectRecordToggle(page, 'show');
  await page.getByRole('textbox', { name: 'Search records, fields, files…' }).fill('reference');
  await expect(page.locator('.field-result-value')).toHaveText([masked, masked]);
  await reloadSyntheticLibrary(page);
  await expect(field(page, 'reference').locator('.field-value')).toHaveText(masked);
  settings = await openSettings(page);
  await expect(settings.getByRole('switch', { name: 'Hide sensitive fields', exact: true })).toBeChecked();
});

test('copies explicitly selected private values while whole-record copy excludes them in every display mode', async ({ page }) => {
  await openSyntheticLibrary(page);
  for (const mode of ['masked', 'revealed', 'masking-disabled']) {
    if (mode === 'revealed') await (await expectRecordToggle(page, 'show')).click();
    if (mode === 'masking-disabled') {
      const settings = await openSettings(page);
      await settings.getByRole('switch', { name: 'Hide sensitive fields', exact: true }).click();
      await settings.getByRole('button', { name: 'Close', exact: true }).click();
    }
    await field(page, 'reference').getByRole('button', { name: 'Copy Private reference', exact: true }).click();
    await expect.poll(() => clipboard(page)).toBe(alphaSecret);
    await details(page).getByRole('button', { name: 'Copy record', exact: true }).click();
    await expect.poll(() => clipboard(page)).toContain(publicField.value);
    expect(await clipboard(page)).not.toContain(alphaSecret);
    expect(await clipboard(page)).not.toContain(privateEmail);
  }
  await page.getByRole('textbox', { name: 'Search records, fields, files…' }).fill('reference');
  const beta = page.locator('.record-result').filter({ has: page.locator('.record-title strong', { hasText: 'Synthetic Beta' }) });
  await beta.getByRole('button', { name: 'Copy Private reference', exact: true }).click();
  await expect.poll(() => clipboard(page)).toBe(betaSecret);
  await expect(page.getByRole('heading', { name: 'Synthetic Alpha', exact: true })).toBeVisible();
});

test('translates record and settings controls and retains preferences after a Chinese reload', async ({ page }) => {
  await openSyntheticLibrary(page);
  await page.getByRole('button', { name: 'Language', exact: true }).click();
  await expect(field(page, 'reference').locator('.field-label')).toHaveText('私密编号');
  await details(page).getByRole('button', { name: '显示敏感字段', exact: true }).click();
  await expect(details(page).getByRole('button', { name: '隐藏敏感字段', exact: true })).toBeVisible();
  await expect(field(page, 'reference').getByRole('button', { name: '隐藏内容', exact: true })).toBeVisible();
  const settings = await openSettings(page, 'zh');
  await expect(settings.getByRole('switch', { name: '隐藏敏感字段', exact: true })).toBeChecked();
  await settings.getByRole('switch', { name: '隐藏敏感字段', exact: true }).click();
  await settings.getByRole('button', { name: '关闭', exact: true }).click();
  await reloadSyntheticLibrary(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(field(page, 'reference').locator('.field-value')).toHaveText(alphaSecret);
  await expect(details(page).getByRole('button', { name: /^(显示敏感字段|隐藏敏感字段|显示内容|隐藏内容)$/ })).toHaveCount(0);
  await page.getByRole('textbox', { name: '搜索条目、字段、文件…' }).fill('私密编号');
  await expect(page.locator('.field-result-value')).toHaveText([alphaSecret, betaSecret]);
  const reopened = await openSettings(page, 'zh');
  await expect(reopened.getByRole('switch', { name: '隐藏敏感字段', exact: true })).not.toBeChecked();
});

for (const locale of ['en', 'zh'] as const) {
  test(`keeps visibility controls aligned and keyboard accessible in a compact window (${locale})`, async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 620 });
    await openSyntheticLibrary(page);
    if (locale === 'zh') await page.getByRole('button', { name: 'Language', exact: true }).click();
    const toggle = details(page).getByRole('button', { name: locale === 'en' ? 'Show sensitive fields' : '显示敏感字段', exact: true });
    const copy = details(page).getByRole('button', { name: locale === 'en' ? 'Copy record' : '复制条目', exact: true });
    await expect(toggle).toBeInViewport();
    await expect(copy).toBeInViewport();
    const toggleBox = (await toggle.boundingBox())!;
    const copyBox = (await copy.boundingBox())!;
    expect(toggleBox.x + toggleBox.width).toBeLessThanOrEqual(copyBox.x);
    expect(Math.abs(toggleBox.y + toggleBox.height / 2 - copyBox.y - copyBox.height / 2)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const settings = await openSettings(page, locale);
    const control = settings.getByRole('switch', { name: locale === 'en' ? 'Hide sensitive fields' : '隐藏敏感字段', exact: true });
    await control.scrollIntoViewIfNeeded();
    await expect(control).toBeInViewport();
    await control.focus();
    await page.keyboard.press('Space');
    await expect(control).not.toBeChecked();
    expect(await settings.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.screenshot({ path: `artifacts/preview-sensitive-${locale}-compact.png`, fullPage: true });
  });
}
