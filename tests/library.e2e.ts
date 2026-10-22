import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'All records' })).toBeVisible();
});

async function startCustomRecord(page: Page, title: string) {
  await page.getByRole('button', { name: 'New record', exact: true }).click();
  await page.getByRole('button', { name: 'Custom record Start with your own fields.' }).click();
  const editor = page.getByRole('dialog', { name: 'New record', exact: true });
  await editor.getByLabel('Title', { exact: true }).fill(title);
  return editor;
}

test('search matches bilingual fields and multiple words, and clearing recovers the list', async ({ page }) => {
  const search = page.getByRole('textbox', { name: 'Search records, fields, files…' });
  await search.fill('学校 example');
  await expect(page.locator('.record-card')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'MSc · Computer Science', exact: true })).toBeVisible();
  await search.fill('a phrase that does not exist');
  await expect(page.getByText('No matching records', { exact: true })).toBeVisible();
  await expect(page.locator('.record-card')).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear search', exact: true }).first().click();
  await expect(page.locator('.record-card')).toHaveCount(3);
  await page.keyboard.press('Control+k');
  await expect(search).toBeFocused();
});

test('creates and edits a custom record while maintaining keyboard focus', async ({ page }) => {
  const editor = await startCustomRecord(page, 'Synthetic conference profile');
  await editor.getByLabel('Subtitle', { exact: true }).click();
  await editor.getByLabel('Subtitle', { exact: true }).pressSequentially('Ready to reuse');
  await expect(editor.getByLabel('Subtitle', { exact: true })).toHaveValue('Ready to reuse');
  await expect(editor.getByLabel('Subtitle', { exact: true })).toBeFocused();
  await editor.getByRole('button', { name: 'Add field', exact: true }).first().click();
  await editor.getByLabel('Label 1', { exact: true }).fill('Research interest');
  await editor.getByLabel('Chinese label 1', { exact: true }).fill('研究兴趣');
  await editor.getByLabel('Type 1', { exact: true }).selectOption('multiline');
  await editor.getByLabel('Value 1', { exact: true }).fill('Accessible desktop software\nLocal-first workflows');
  await editor.getByLabel('Tags', { exact: true }).fill('conference, synthetic');
  await editor.getByLabel('Notes', { exact: true }).fill('Only synthetic data is used by this test.');
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(editor).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Synthetic conference profile', exact: true })).toBeVisible();
  await expect(page.getByText('Accessible desktop software\nLocal-first workflows', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const editing = page.getByRole('dialog', { name: 'Edit', exact: true });
  await editing.getByLabel('Title', { exact: true }).fill('Updated conference profile');
  await editing.getByLabel('Value 1', { exact: true }).fill('Interaction design');
  await editing.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Updated conference profile', exact: true })).toBeVisible();
  await expect(page.getByText('Interaction design', { exact: true })).toBeVisible();
});

test('favorites, record deletion, and immediate undo preserve record content', async ({ page }) => {
  await page.getByRole('button', { name: /Research portfolio Projects, publications/ }).click();
  await page.getByRole('button', { name: 'Add to favorites', exact: true }).click();
  await page.getByRole('button', { name: /^Favorites/ }).click();
  await expect(page.locator('.record-card')).toHaveCount(3);
  await page.getByRole('button', { name: /Research portfolio Projects, publications/ }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('dialog', { name: 'Delete this record?' }).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Record deleted');
  await expect(page.locator('.record-card')).toHaveCount(2);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Research portfolio', exact: true })).toBeVisible();
  await expect(page.getByText('Human–computer interaction', { exact: true })).toBeVisible();
  await expect(page.locator('.record-card')).toHaveCount(3);
  await page.getByRole('button', { name: 'Remove from favorites', exact: true }).click();
  await expect(page.locator('.record-card')).toHaveCount(2);
});

test('masks sensitive fields and excludes them from whole-record clipboard output', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await expect(page.getByText('DEMO-000000', { exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Show value', exact: true }).click();
  await expect(page.getByText('DEMO-000000', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Hide value', exact: true }).click();
  await expect(page.getByText('DEMO-000000', { exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Copy record', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('Full name: Alex Morgan');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).not.toContain('DEMO-000000');
  expect(copied).not.toContain('Document number');
  await page.getByRole('button', { name: 'Copy Document number', exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('DEMO-000000');
});

test('switches and persists interface language without translating personal content', async ({ page }) => {
  await page.getByRole('button', { name: 'Language', exact: true }).click();
  await expect(page.getByRole('heading', { name: '全部条目' })).toBeVisible();
  await expect(page.getByText('姓名', { exact: true })).toBeVisible();
  await expect(page.getByText('Alex Morgan', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: '全部条目' })).toBeVisible();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await settings.getByRole('combobox', { name: '语言', exact: true }).selectOption('en');
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export backup', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Restore backup', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'All records' })).toBeVisible();
});

test('guards unsaved edits and resets browser preview data on reload', async ({ page }) => {
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit', exact: true });
  await editor.getByLabel('Title', { exact: true }).fill('Unsaved synthetic change');
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  const discard = page.getByRole('dialog', { name: 'Discard unsaved changes?' });
  await expect(discard).toBeVisible();
  await discard.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(editor.getByLabel('Title', { exact: true })).toHaveValue('Unsaved synthetic change');
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Personal details', exact: true })).toBeVisible();
  const newEditor = await startCustomRecord(page, 'Temporary browser record');
  await newEditor.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Temporary browser record', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('.record-card')).toHaveCount(3);
  await expect(page.getByText('Temporary browser record', { exact: true })).toBeHidden();
});

test('keeps native attachment actions explicit in browser preview', async ({ page }) => {
  await page.getByRole('button', { name: 'Add files', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Open the desktop app to manage files and backups.');
  await page.getByRole('button', { name: /^Files\s*0$/ }).click();
  await expect(page.getByRole('heading', { name: 'File library' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No files attached', exact: true })).toBeVisible();
});

test('loads only local resources and fits both desktop sizes', async ({ page }) => {
  const remoteRequests: string[] = [];
  const runtimeErrors: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (['http:', 'https:'].includes(url.protocol) && !['127.0.0.1', 'localhost'].includes(url.hostname)) {
      remoteRequests.push(url.origin);
    }
  });
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'All records' })).toBeVisible();
  await page.screenshot({ path: 'artifacts/preview-en.png', fullPage: true });
  await page.getByRole('button', { name: 'Language', exact: true }).click();
  await expect(page.getByRole('heading', { name: '全部条目' })).toBeVisible();
  await page.screenshot({ path: 'artifacts/preview-zh.png', fullPage: true });
  await page.setViewportSize({ width: 900, height: 620 });
  await expect(page.getByRole('button', { name: '新建条目', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/preview-compact.png', fullPage: true });
  expect(remoteRequests).toEqual([]);
  expect(runtimeErrors).toEqual([]);
});
