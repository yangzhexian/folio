import { expect, test, type Locator, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.record-card')).toHaveCount(3);
});

async function openCustomEditor(page: Page) {
  await page.getByRole('button', { name: 'New record', exact: true }).click();
  await page.getByRole('button', { name: 'Custom record Start with your own fields.', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'New record', exact: true });
  await editor.getByLabel('Title', { exact: true }).fill('Synthetic field editor');
  expect(await editor.locator('.add-field-button').evaluate(button => {
    const bounds = button.getBoundingClientRect();
    const container = button.closest('.field-editor')!.getBoundingClientRect();
    return Math.abs(bounds.x + bounds.width / 2 - container.x - container.width / 2);
  })).toBeLessThanOrEqual(0.5);
  return editor;
}

async function fillThreeFields(page: Page) {
  const editor = await openCustomEditor(page);
  await editor.getByRole('button', { name: 'Add field', exact: true }).click();
  await editor.getByLabel('Label 1', { exact: true }).fill('First field');
  await editor.getByLabel('Chinese label 1', { exact: true }).fill('首项');
  await editor.getByLabel('Value 1', { exact: true }).fill('Alpha');
  await editor.getByRole('button', { name: 'Add field after First field', exact: true }).click();
  await editor.getByLabel('Label 2', { exact: true }).fill('Birth date');
  await editor.getByLabel('Chinese label 2', { exact: true }).fill('出生日期');
  await editor.getByLabel('Type 2', { exact: true }).selectOption('date');
  await editor.getByLabel('Value 2', { exact: true }).fill('2024-02-29');
  await editor.locator('.editor-field').nth(1).getByRole('checkbox', { name: 'Sensitive', exact: true }).check();
  await editor.getByRole('button', { name: 'Add field after Birth date', exact: true }).click();
  await editor.getByLabel('Label 3', { exact: true }).fill('Notes');
  await editor.getByLabel('Chinese label 3', { exact: true }).fill('备注');
  await editor.getByLabel('Type 3', { exact: true }).selectOption('multiline');
  await editor.getByLabel('Value 3', { exact: true }).fill('First line\nSecond line');
  return editor;
}

async function labels(editor: Locator) {
  return editor.getByRole('textbox', { name: /^Label \d+$/ }).evaluateAll(nodes => nodes.map(node => (node as HTMLInputElement).value));
}

test('inserts after the middle field and focuses its label while preserving surrounding content', async ({ page }) => {
  const editor = await fillThreeFields(page);
  const originalIds = await editor.locator('.field-editor-item').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.fieldId));
  await editor.getByRole('button', { name: 'Add field after Birth date', exact: true }).click();
  await expect(editor.getByLabel('Label 3', { exact: true })).toBeFocused();
  await editor.getByLabel('Label 3', { exact: true }).fill('Inserted middle');
  await editor.getByLabel('Value 3', { exact: true }).fill('Inserted value');
  expect(await labels(editor)).toEqual(['First field', 'Birth date', 'Inserted middle', 'Notes']);
  expect(await editor.locator('.field-insert').evaluateAll(buttons => buttons.every(button => {
    const bounds = button.getBoundingClientRect();
    const container = button.closest('.field-editor')!.getBoundingClientRect();
    return Math.abs(bounds.x + bounds.width / 2 - container.x - container.width / 2) <= 0.5;
  }))).toBe(true);
  const insertedIds = await editor.locator('.field-editor-item').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.fieldId));
  expect(insertedIds.filter(id => originalIds.includes(id))).toEqual(originalIds);
  await expect(editor.getByLabel('Value 4', { exact: true })).toHaveValue('First line\nSecond line');
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(editor).toBeHidden();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const reopened = page.getByRole('dialog', { name: 'Edit', exact: true });
  expect(await labels(reopened)).toEqual(['First field', 'Birth date', 'Inserted middle', 'Notes']);
  await expect(reopened.getByLabel('Value 3', { exact: true })).toHaveValue('Inserted value');
  await expect(reopened.getByLabel('Value 4', { exact: true })).toHaveValue('First line\nSecond line');
});

test('reorders by pointer and keyboard and saves field identities, types, values, translations, and sensitivity', async ({ page }) => {
  const editor = await fillThreeFields(page);
  const originalIds = await editor.locator('.field-editor-item').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.fieldId));
  const handle = editor.getByRole('button', { name: 'Reorder Notes', exact: true });
  await handle.scrollIntoViewIfNeeded();
  const source = (await handle.boundingBox())!;
  const first = (await editor.locator('.editor-field').first().boundingBox())!;
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(source.x + source.width / 2, first.y + 15, { steps: 12 });
  await page.mouse.up();
  expect(await labels(editor)).toEqual(['Notes', 'First field', 'Birth date']);
  await expect(handle).toBeFocused();
  await handle.press('ArrowDown');
  expect(await labels(editor)).toEqual(['First field', 'Notes', 'Birth date']);
  await expect(handle).toBeFocused();
  await expect(editor.getByLabel('Value 2', { exact: true })).toHaveValue('First line\nSecond line');
  const reorderedIds = await editor.locator('.field-editor-item').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.fieldId));
  expect(reorderedIds).toEqual([originalIds[0], originalIds[2], originalIds[1]]);
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(editor).toBeHidden();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const reopened = page.getByRole('dialog', { name: 'Edit', exact: true });
  expect(await labels(reopened)).toEqual(['First field', 'Notes', 'Birth date']);
  expect(await reopened.locator('.field-editor-item').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.fieldId))).toEqual(reorderedIds);
  await expect(reopened.getByLabel('Value 1', { exact: true })).toHaveValue('Alpha');
  await expect(reopened.getByLabel('Value 2', { exact: true })).toHaveValue('First line\nSecond line');
  await expect(reopened.getByLabel('Type 2', { exact: true })).toHaveValue('multiline');
  await expect(reopened.getByLabel('Value 3', { exact: true })).toHaveValue('2024-02-29');
  await expect(reopened.getByLabel('Type 3', { exact: true })).toHaveValue('date');
  await expect(reopened.getByLabel('Chinese label 3', { exact: true })).toHaveValue('出生日期');
  await expect(reopened.locator('.editor-field').nth(2).getByRole('checkbox', { name: 'Sensitive', exact: true })).toBeChecked();
});

test('auto-scrolls long editors while dragging and cancels the reorder with Escape', async ({ page }) => {
  await page.getByRole('button', { name: 'New record', exact: true }).click();
  await page.getByRole('button', { name: 'Personal identity Names, identity documents and personal details.', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'New record', exact: true });
  const originalLabels = await labels(editor);
  const handle = editor.getByRole('button', { name: 'Reorder Full name', exact: true });
  await handle.scrollIntoViewIfNeeded();
  const startScroll = await editor.locator('.editor-scroll').evaluate(node => node.scrollTop);
  const source = (await handle.boundingBox())!;
  const scrollBounds = (await editor.locator('.editor-scroll').boundingBox())!;
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(source.x + source.width / 2, scrollBounds.y + scrollBounds.height - 8, { steps: 8 });
  await expect.poll(() => editor.locator('.editor-scroll').evaluate(node => node.scrollTop)).toBeGreaterThan(startScroll + 100);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(editor).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  expect(await labels(editor)).toEqual(originalLabels);
  await expect(editor.locator('.is-reordering')).toHaveCount(0);
});

test('browses calendar months and years without changing the date until a day is selected', async ({ page }) => {
  const editor = await fillThreeFields(page);
  const date = editor.getByLabel('Value 2', { exact: true });
  await expect(editor.getByRole('button', { name: 'Previous year', exact: true })).toHaveCount(0);
  await editor.getByRole('button', { name: 'Choose date', exact: true }).click();
  const calendar = editor.getByRole('group', { name: 'Date calendar', exact: true });
  await expect(calendar.getByRole('grid')).toHaveAttribute('aria-label', 'February 2024');
  expect(await calendar.locator('.date-picker-header button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')))).toEqual(['Previous year', 'Previous month', 'Next month', 'Next year']);
  await calendar.getByRole('button', { name: 'Previous year', exact: true }).click();
  await expect(calendar.getByRole('grid')).toHaveAttribute('aria-label', 'February 2023');
  await expect(date).toHaveValue('2024-02-29');
  await calendar.getByRole('button', { name: 'Next month', exact: true }).click();
  await expect(calendar.getByRole('grid')).toHaveAttribute('aria-label', 'March 2023');
  await calendar.getByRole('button', { name: 'Previous month', exact: true }).click();
  for (let year = 0; year < 5; year++) await calendar.getByRole('button', { name: 'Next year', exact: true }).click();
  await expect(calendar.getByRole('grid')).toHaveAttribute('aria-label', 'February 2028');
  await expect(date).toHaveValue('2024-02-29');
  await calendar.getByRole('button', { name: 'Tuesday, February 29, 2028', exact: true }).click();
  await expect(calendar).toBeHidden();
  await expect(date).toHaveValue('2028-02-29');
  await editor.getByRole('button', { name: 'Choose date', exact: true }).click();
  await expect(calendar.getByRole('grid')).toHaveAttribute('aria-label', 'February 2028');
  await expect(calendar.getByRole('gridcell', { selected: true }).getByRole('button')).toHaveAccessibleName('Tuesday, February 29, 2028');
  await page.screenshot({ path: 'artifacts/preview-field-editor.png', fullPage: true });
  await page.keyboard.press('Escape');
  await expect(editor).toBeVisible();
  await expect(calendar).toBeHidden();
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Edit', exact: true }).getByLabel('Value 2', { exact: true })).toHaveValue('2028-02-29');
});

test('supports calendar keyboard browsing, Escape and outside dismissal without losing typed dates', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-23T12:00:00'));
  const editor = await fillThreeFields(page);
  const date = editor.getByLabel('Value 2', { exact: true });
  const toggle = editor.getByRole('button', { name: 'Choose date', exact: true });
  const calendar = editor.getByRole('group', { name: 'Date calendar', exact: true });
  await toggle.click();
  await expect(calendar.getByRole('button', { name: 'Thursday, February 29, 2024', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(calendar.getByRole('button', { name: 'Friday, March 1, 2024', exact: true })).toBeFocused();
  await page.keyboard.press('PageDown');
  await expect(calendar.getByRole('button', { name: 'Monday, April 1, 2024', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+PageUp');
  await expect(calendar.getByRole('button', { name: 'Saturday, April 1, 2023', exact: true })).toBeFocused();
  await expect(date).toHaveValue('2024-02-29');
  await page.keyboard.press('Escape');
  await expect(calendar).toBeHidden();
  await expect(toggle).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await toggle.click();
  await editor.getByLabel('Value 1', { exact: true }).click();
  await expect(calendar).toBeHidden();
  await date.fill('2023-02-29');
  await expect(date).toHaveAttribute('aria-invalid', 'true');
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(editor).toBeVisible();
  await expect(date).toBeFocused();
  await expect(date).toHaveValue('2023-02-29');
  await toggle.click();
  await expect(calendar.getByRole('grid')).toHaveAttribute('aria-label', 'February 2024');
  await calendar.getByRole('button', { name: 'Clear date', exact: true }).click();
  await expect(date).toHaveValue('');
  await expect(date).not.toHaveAttribute('aria-invalid', 'true');
  await toggle.click();
  await expect(calendar.getByRole('grid')).toHaveAttribute('aria-label', 'October 2026');
  await expect(date).toHaveValue('');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(date).toHaveValue('2026-10-24');
});

test('treats incomplete manual dates as unsaved changes and prevents invalid persistence', async ({ page }) => {
  const editor = await fillThreeFields(page);
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const reopened = page.getByRole('dialog', { name: 'Edit', exact: true });
  const date = reopened.getByLabel('Value 2', { exact: true });
  await date.fill('2024-02-');
  await reopened.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(reopened).toBeVisible();
  await expect(date).toBeFocused();
  await expect(date).toHaveValue('2024-02-');
  await reopened.getByRole('button', { name: 'Choose date', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await page.keyboard.press('Escape');
  const confirmation = page.getByRole('dialog', { name: 'Discard unsaved changes?', exact: true });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Discard', exact: true }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Edit', exact: true }).getByLabel('Value 2', { exact: true })).toHaveValue('2024-02-29');
});

test('keeps the Chinese calendar fully visible in desktop and compact editors', async ({ page }) => {
  const editor = await fillThreeFields(page);
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByRole('button', { name: 'Language', exact: true }).click();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  const chineseEditor = page.getByRole('dialog', { name: '编辑', exact: true });
  await chineseEditor.getByRole('button', { name: '选择日期', exact: true }).click();
  const calendar = chineseEditor.getByRole('group', { name: '日期日历', exact: true });
  await expect(calendar.getByRole('grid')).toHaveAttribute('aria-label', '2024年2月');
  await expect(calendar.getByRole('button', { name: '2024年2月29日星期四', exact: true })).toBeFocused();
  await page.screenshot({ path: 'artifacts/preview-date-picker-zh.png', fullPage: true });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 900, height: 620 });
  await chineseEditor.getByRole('button', { name: '选择日期', exact: true }).click();
  await expect.poll(async () => {
    const bounds = (await calendar.boundingBox())!;
    const scroll = (await chineseEditor.locator('.editor-scroll').boundingBox())!;
    return bounds.y >= scroll.y && bounds.y + bounds.height <= scroll.y + scroll.height && bounds.x >= 0 && bounds.x + bounds.width <= 900;
  }).toBe(true);
  await page.screenshot({ path: 'artifacts/preview-date-picker-zh-compact.png', fullPage: true });
  await calendar.getByRole('button', { name: '下一年', exact: true }).click();
  await expect(calendar.getByRole('grid')).toHaveAttribute('aria-label', '2025年2月');
  await expect(chineseEditor.getByLabel('内容 2', { exact: true })).toHaveValue('2024-02-29');
  await calendar.getByRole('button', { name: '下个月', exact: true }).click();
  await expect(calendar.getByRole('grid')).toHaveAttribute('aria-label', '2025年3月');
  await expect.poll(async () => {
    const bounds = (await calendar.boundingBox())!;
    const scroll = (await chineseEditor.locator('.editor-scroll').boundingBox())!;
    return bounds.y >= scroll.y && bounds.y + bounds.height <= scroll.y + scroll.height;
  }).toBe(true);
});

test('omits the obsolete student rail destination from new contact templates', async ({ page }) => {
  await page.getByRole('button', { name: 'New record', exact: true }).click();
  await page.getByRole('button', { name: 'Contact details Phone, email, social accounts and addresses.', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'New record', exact: true });
  const fieldLabels = await labels(editor);
  expect(fieldLabels).toContain('Mobile');
  expect(fieldLabels).not.toContain('Student rail destination');
  expect(await editor.getByRole('textbox', { name: /^Chinese label \d+$/ }).evaluateAll(nodes => nodes.map(node => (node as HTMLInputElement).value))).not.toContain('学生票目的地');
});
