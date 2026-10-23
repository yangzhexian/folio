import { expect, test, type Page } from '@playwright/test';

const syntheticTitle = 'Synthetic contact profile';
const syntheticFields = [
  { label: 'QQ', labelZh: 'QQ 号', value: '123456789' },
  { label: 'Mobile', labelZh: '手机号', value: '13800000000' },
  { label: 'Email', labelZh: '邮箱', value: 'search@example.invalid' },
];

async function createSearchRecord(page: Page) {
  await page.getByRole('button', { name: 'New record', exact: true }).click();
  await page.getByRole('button', { name: 'Custom record Start with your own fields.' }).click();
  const editor = page.getByRole('dialog', { name: 'New record', exact: true });
  await editor.getByLabel('Title', { exact: true }).fill(syntheticTitle);
  for (const [index, field] of syntheticFields.entries()) {
    await editor.getByRole('button', { name: index === 0 ? 'Add field' : `Add field after ${syntheticFields[index - 1].label}`, exact: true }).click();
    await editor.getByLabel(`Label ${index + 1}`, { exact: true }).fill(field.label);
    await editor.getByLabel(`Chinese label ${index + 1}`, { exact: true }).fill(field.labelZh);
    await editor.getByLabel(`Value ${index + 1}`, { exact: true }).fill(field.value);
  }
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(editor).toBeHidden();
  await expect(page.getByRole('heading', { name: syntheticTitle, exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^All records/ }).click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.record-card')).toHaveCount(3);
});

test('finds QQ spacing variants and phone aliases as specific field results', async ({ page }) => {
  await createSearchRecord(page);
  const search = page.getByRole('textbox', { name: 'Search records, fields, files…' });
  const results = page.locator('.field-search-results .field-result');
  for (const query of ['QQ号', 'QQ 号', 'ＱＱ　号']) {
    await search.fill(query);
    await expect(page.locator('.record-card')).toHaveCount(1);
    await expect(results).toHaveCount(1);
    await expect(results.locator('.field-result-label')).toHaveText('QQ');
    await expect(results.locator('.field-result-value')).toHaveText('123456789');
  }
  for (const query of ['手机', '手机号', 'Mobile', 'PHONE', 'contact 手机 138']) {
    await search.fill(query);
    await expect(results).toHaveCount(1);
    await expect(results.locator('.field-result-label')).toHaveText('Mobile');
    await expect(results.locator('.field-result-value')).toHaveText('13800000000');
  }
  await search.fill('phone email');
  await expect(results.locator('.field-result-label')).toHaveText(['Mobile', 'Email']);
  await page.setViewportSize({ width: 900, height: 620 });
  await expect(results.first()).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/preview-field-search.png', fullPage: true });
  await search.fill('Synthetic contact');
  await expect(page.locator('.record-card')).toHaveCount(1);
  await expect(results).toHaveCount(0);
  await search.fill('手机号 nonexistent');
  await expect(page.locator('.record-card')).toHaveCount(0);
  await expect(results).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear search', exact: true }).first().click();
  await expect(page.locator('.record-card')).toHaveCount(4);
  await expect(results).toHaveCount(0);
});

test('copies field snippets directly and opens the corresponding field on another record', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await createSearchRecord(page);
  await page.getByRole('textbox', { name: 'Search records, fields, files…' }).fill('email');
  const custom = page.locator('.record-result').filter({ has: page.locator('.record-title strong', { hasText: syntheticTitle }) });
  const personal = page.locator('.record-result').filter({ has: page.locator('.record-title strong', { hasText: 'Personal details' }) });
  await expect(page.locator('.field-result')).toHaveCount(2);
  await expect(page.getByRole('heading', { name: syntheticTitle, exact: true })).toBeVisible();
  await personal.locator('.field-result').getByRole('button', { name: 'Copy Email', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('alex@example.com');
  await expect(page.getByRole('heading', { name: syntheticTitle, exact: true })).toBeVisible();
  await personal.getByRole('button', { name: 'Show field Email', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Personal details', exact: true })).toBeVisible();
  const found = page.locator('.field-row.field-found');
  await expect(found).toHaveCount(1);
  await expect(found.locator('.field-label')).toHaveText('Email');
  await expect(found.locator('.field-value')).toHaveText('alex@example.com');
  await expect(found).toBeInViewport();
  await custom.getByRole('button', { name: 'Show field Email', exact: true }).click();
  await expect(page.getByRole('heading', { name: syntheticTitle, exact: true })).toBeVisible();
  await expect(found.locator('.field-value')).toHaveText('search@example.invalid');
  await custom.locator('.field-result').getByRole('button', { name: 'Copy Email', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('search@example.invalid');
});

test('keeps sensitive search snippets masked while allowing explicit single-field copy', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const search = page.getByRole('textbox', { name: 'Search records, fields, files…' });
  for (const query of ['证件号', '证件号码', 'ID number', 'document number', 'DEMO-000000']) {
    await search.fill(query);
    await expect(page.locator('.field-result')).toHaveCount(1);
    await expect(page.locator('.field-result-label')).toHaveText('Document number');
    await expect(page.locator('.field-result-value')).toHaveText('••••••••••••');
    await expect(page.locator('.field-search-results')).not.toContainText('DEMO-000000');
  }
  const result = page.locator('.field-result');
  await result.getByRole('button', { name: 'Copy Document number', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('DEMO-000000');
  await expect(result.locator('.field-result-value')).toHaveText('••••••••••••');
  await result.getByRole('button', { name: 'Show field Document number', exact: true }).click();
  const found = page.locator('.field-row.field-found');
  await expect(found).toHaveCount(1);
  await expect(found.locator('.field-value')).toHaveClass(/masked/);
  await found.getByRole('button', { name: 'Show value', exact: true }).click();
  await expect(found.locator('.field-value')).toHaveText('DEMO-000000');
  await expect(result.locator('.field-result-value')).toHaveText('••••••••••••');
  await page.getByRole('button', { name: 'Copy record', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).not.toContain('DEMO-000000');
});

test('renders translated field matches and preserves alias behavior after a language reload', async ({ page }) => {
  await createSearchRecord(page);
  await page.getByRole('textbox', { name: 'Search records, fields, files…' }).fill('QQ号');
  await page.getByRole('button', { name: 'Language', exact: true }).click();
  const chineseSearch = page.getByRole('textbox', { name: '搜索条目、字段、文件…' });
  await expect(chineseSearch).toHaveValue('QQ号');
  await expect(page.locator('.field-result-label')).toHaveText('QQ 号');
  await expect(page.getByRole('button', { name: '查看字段 QQ 号', exact: true })).toBeVisible();
  await chineseSearch.fill('Mobile');
  await expect(page.locator('.field-result-label')).toHaveText('手机号');
  await page.getByRole('button', { name: '查看字段 手机号', exact: true }).click();
  await expect(page.locator('.field-row.field-found .field-label')).toHaveText('手机号');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(chineseSearch).toHaveValue('');
  await expect(page.locator('.field-result')).toHaveCount(0);
  await chineseSearch.fill('ID number');
  await expect(page.locator('.field-result-label')).toHaveText('证件号码');
  await expect(page.locator('.field-result-value')).toHaveText('••••••••••••');
  await page.getByRole('button', { name: '查看字段 证件号码', exact: true }).click();
  await expect(page.locator('.field-row.field-found .field-label')).toHaveText('证件号码');
  await page.getByRole('button', { name: '语言', exact: true }).click();
  await expect(page.locator('.field-result-label')).toHaveText('Document number');
  await expect(page.getByRole('button', { name: 'Show field Document number', exact: true })).toBeVisible();
});
