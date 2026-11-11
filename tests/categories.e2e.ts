import { expect, test, type Locator, type Page } from '@playwright/test';

const builtinCategories = [
  { id: 'identity', nameEn: 'Identity', nameZh: '个人信息', icon: 'user-round' },
  { id: 'education', nameEn: 'Education', nameZh: '教育经历', icon: 'graduation-cap' },
  { id: 'experience', nameEn: 'Experience', nameZh: '工作经历', icon: 'briefcase-business' },
  { id: 'research', nameEn: 'Research', nameZh: '项目与研究', icon: 'flask-conical' },
  { id: 'awards', nameEn: 'Awards', nameZh: '荣誉奖励', icon: 'award' },
  { id: 'skills', nameEn: 'Skills', nameZh: '技能证书', icon: 'badge-check' },
  { id: 'contacts', nameEn: 'Contacts', nameZh: '家庭与联系人', icon: 'users' },
  { id: 'documents', nameEn: 'Documents', nameZh: '文件资料', icon: 'file-text' },
  { id: 'custom', nameEn: 'Custom', nameZh: '自定义', icon: 'sliders-horizontal' },
];
const identityId = '00000000-0000-4000-8000-000000000901';
const initialSnapshot = {
  dataDir: 'C:\\SyntheticCategories', attachments: [], categories: builtinCategories, categoriesRevision: 'builtin-v1',
  records: [
    { id: identityId, category: 'identity', title: 'Synthetic identity', subtitle: '', tags: [], favorite: false, notes: '', fields: [{ id: 'name', label: 'Name', labelZh: '姓名', value: 'Jordan Vale', kind: 'text', sensitive: false }], createdAt: '2026-11-10T09:00:00.000Z', updatedAt: '2026-11-11T09:00:00.000Z' },
    { id: '00000000-0000-4000-8000-000000000902', category: 'education', title: 'Synthetic education', subtitle: '', tags: [], favorite: false, notes: '', fields: [], createdAt: '2026-11-09T09:00:00.000Z', updatedAt: '2026-11-10T09:00:00.000Z' },
  ],
};

async function openLibrary(page: Page, locale: 'en' | 'zh' = 'en') {
  await page.addInitScript(value => {
    if (!localStorage.getItem('folio.locale')) localStorage.setItem('folio.locale', value);
  }, locale);
  await page.route('http://127.0.0.1:1420/', async route => {
    const response = await route.fetch();
    const html = await response.text();
    const bootstrap = `
      import { mockIPC, mockWindows } from '/node_modules/@tauri-apps/api/mocks.js';
      globalThis.isTauri = true;
      mockWindows('main');
      const stored = sessionStorage.getItem('synthetic.categories.snapshot');
      const state = globalThis.__folioCategories = {
        snapshot: stored ? JSON.parse(stored) : ${JSON.stringify(initialSnapshot)}, calls: [], revision: 0,
        bootstrapStatus: 'loading', bootstrapError: null,
        persist() { sessionStorage.setItem('synthetic.categories.snapshot', JSON.stringify(this.snapshot)); },
      };
      mockIPC(async (command, args) => {
        state.calls.push({ command, args: structuredClone(args) });
        if (command === 'load_snapshot') return structuredClone(state.snapshot);
        if (command === 'save_categories') {
          if (args.expectedRevision !== state.snapshot.categoriesRevision) throw 'CATEGORY_CONFLICT';
          state.snapshot.categories = structuredClone(args.categories);
          state.snapshot.categoriesRevision = 'mock-catalog-' + (++state.revision);
          state.persist();
          return { categories: structuredClone(state.snapshot.categories), revision: state.snapshot.categoriesRevision };
        }
        if (command === 'save_record') {
          if (!state.snapshot.categories.some(category => category.id === args.record.category)) throw 'UNKNOWN_CATEGORY';
          const saved = { ...args.record, updatedAt: new Date().toISOString() };
          state.snapshot.records = [...state.snapshot.records.filter(record => record.id !== saved.id), saved];
          state.persist();
          return structuredClone(saved);
        }
        if (command.startsWith('plugin:window|')) return;
        throw new Error('Unmocked synthetic command: ' + command);
      }, { shouldMockEvents: true });
      try { await import('/src/main.tsx'); state.bootstrapStatus = 'ready'; }
      catch (error) { state.bootstrapError = String(error); state.bootstrapStatus = 'error'; }
    `;
    const entry = /<script type="module" src="\/src\/main\.tsx(?:\?[^\"]*)?"><\/script>/;
    expect(html).toMatch(entry);
    await route.fulfill({ response, body: html.replace(entry, () => `<script type="module">${bootstrap}</script>`) });
  });
  await page.goto('/');
  await ready(page);
  await expect(page.getByRole('heading', { name: 'Synthetic identity', exact: true })).toBeVisible();
}

async function ready(page: Page) {
  await page.waitForFunction(() => ['ready', 'error'].includes((window as any).__folioCategories?.bootstrapStatus));
  expect(await page.evaluate(() => (window as any).__folioCategories.bootstrapError)).toBeNull();
}

async function manager(page: Page, locale: 'en' | 'zh' = 'en') {
  await page.getByRole('button', { name: locale === 'en' ? 'Manage collections' : '管理分类', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: locale === 'en' ? 'Collections' : '分类', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

const row = (dialog: Locator, id: string) => dialog.locator(`[data-category-id="${id}"]`);
const nav = (page: Page, name: string) => page.locator('.sidebar .nav-item').filter({ has: page.locator('span', { hasText: new RegExp(`^${name}$`) }) });
const categoryCalls = (page: Page) => page.evaluate(() => (window as any).__folioCategories.calls.filter((call: any) => call.command === 'save_categories'));
const storedSnapshot = (page: Page) => page.evaluate(() => (window as any).__folioCategories.snapshot);

async function saveManager(dialog: Locator, locale: 'en' | 'zh' = 'en') {
  await dialog.getByRole('button', { name: locale === 'en' ? 'Save changes' : '保存更改', exact: true }).click();
  await expect(dialog).toBeHidden();
}

test('renames a built-in collection everywhere without changing existing record identities or fields', async ({ page }) => {
  await openLibrary(page);
  const dialog = await manager(page);
  await expect(dialog.locator('[data-category-id]')).toHaveCount(9);
  await row(dialog, 'identity').getByLabel('English name', { exact: true }).fill('Personal profile');
  await row(dialog, 'identity').getByLabel('Chinese name', { exact: true }).fill('个人档案');
  await saveManager(dialog);
  await expect(nav(page, 'Personal profile')).toBeVisible();
  await expect(page.locator('.record-card').filter({ hasText: 'Synthetic identity' }).locator('.record-meta')).toContainText('Personal profile');
  await expect(page.locator('.detail-category')).toHaveText('Personal profile');
  const search = page.getByRole('textbox', { name: 'Search records, fields, files…' });
  for (const name of ['Personal profile', '个人档案']) {
    await search.fill(name);
    await expect(page.locator('.record-card .record-title strong')).toHaveText(['Synthetic identity']);
  }
  await search.fill('');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit', exact: true });
  await expect(editor.getByRole('combobox', { name: 'Collection', exact: true })).toHaveValue('identity');
  await expect(editor.getByRole('combobox', { name: 'Collection', exact: true }).locator('option:checked')).toHaveText('Personal profile');
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Language', exact: true }).click();
  await expect(nav(page, '个人档案')).toBeVisible();
  await expect(page.locator('.detail-category')).toHaveText('个人档案');
  const state = await storedSnapshot(page);
  expect(state.records).toEqual(initialSnapshot.records);
  expect((await categoryCalls(page))[0].args.expectedRevision).toBe('builtin-v1');
  await page.reload();
  await ready(page);
  await expect(nav(page, '个人档案')).toBeVisible();
  await expect(page.locator('.detail-category')).toHaveText('个人档案');
});

test('adds a collection, assigns a new record to it, and retains filtering and selection after reload', async ({ page }) => {
  await openLibrary(page);
  const dialog = await manager(page);
  await dialog.getByRole('button', { name: 'New collection', exact: true }).click();
  const added = dialog.locator('[data-category-id]').last();
  await expect(added.getByLabel('English name', { exact: true })).toBeFocused();
  const newId = (await added.getAttribute('data-category-id'))!;
  expect(newId).toMatch(/^collection-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  await added.getByLabel('English name', { exact: true }).fill('Travel');
  await added.getByLabel('Chinese name', { exact: true }).fill('旅行');
  await saveManager(dialog);
  await nav(page, 'Travel').click();
  await expect(page.locator('.record-card')).toHaveCount(0);
  await page.getByRole('button', { name: 'New record', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'New record', exact: true });
  await expect(editor.getByRole('combobox', { name: 'Collection', exact: true })).toHaveValue(newId);
  await editor.getByLabel('Title', { exact: true }).fill('Synthetic trip');
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(editor).toBeHidden();
  await expect(nav(page, 'Travel')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.record-card')).toHaveCount(1);
  await expect(page.locator('.detail-category')).toHaveText('Travel');
  expect((await storedSnapshot(page)).records.find((record: any) => record.title === 'Synthetic trip').category).toBe(newId);
  await page.reload();
  await ready(page);
  await nav(page, 'Travel').click();
  await expect(page.getByRole('heading', { name: 'Synthetic trip', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const reopened = page.getByRole('dialog', { name: 'Edit', exact: true });
  await expect(reopened.getByRole('combobox', { name: 'Collection', exact: true })).toHaveValue(newId);
  await reopened.getByRole('button', { name: 'Cancel', exact: true }).click();
  // A restored backup can omit the selected collection. Refresh must recover to
  // All records rather than leaving a filter that has no navigation entry.
  await page.evaluate(snapshot => {
    const state = (window as any).__folioCategories;
    state.snapshot = snapshot;
    state.persist();
    window.dispatchEvent(new Event('focus'));
  }, initialSnapshot);
  await expect(nav(page, 'All records')).toHaveAttribute('aria-current', 'page');
  await expect(nav(page, 'Travel')).toHaveCount(0);
  await expect(page.locator('.record-card')).toHaveCount(2);
  await expect(page.getByRole('heading', { name: 'Synthetic identity', exact: true })).toBeVisible();
});

test('persists collection order and icons with bilingual labels', async ({ page }) => {
  await openLibrary(page);
  const dialog = await manager(page);
  const handle = row(dialog, 'experience').getByRole('button', { name: 'Drag to reorder; use arrow keys to move', exact: true });
  const source = (await handle.boundingBox())!;
  const target = (await row(dialog, 'identity').boundingBox())!;
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(source.x + source.width / 2, target.y + target.height / 2, { steps: 12 });
  await expect(row(dialog, 'identity')).toHaveClass(/drop-target/);
  await page.mouse.up();
  await expect(dialog.locator('[data-category-id]').first()).toHaveAttribute('data-category-id', 'experience');
  await expect(handle).toBeFocused();
  await handle.press('ArrowDown');
  await handle.press('ArrowDown');
  await expect(dialog.locator('[data-category-id]').nth(2)).toHaveAttribute('data-category-id', 'experience');
  const education = row(dialog, 'education');
  await education.getByRole('button', { name: 'Move up', exact: true }).click();
  await expect(dialog.locator('[data-category-id]').first()).toHaveAttribute('data-category-id', 'education');
  await expect(education.getByRole('button', { name: 'Move up', exact: true })).toBeDisabled();
  await education.getByRole('button', { name: 'Choose icon', exact: true }).click();
  await dialog.getByRole('button', { name: 'Book', exact: true }).click();
  await saveManager(dialog);
  await expect(nav(page, 'Education').locator('svg.lucide-book-open')).toHaveCount(1);
  expect((await storedSnapshot(page)).categories.slice(0, 2).map((category: any) => category.id)).toEqual(['education', 'identity']);
  expect((await storedSnapshot(page)).categories[0].icon).toBe('book-open');
  await page.getByRole('button', { name: 'Language', exact: true }).click();
  const chinese = await manager(page, 'zh');
  await expect(chinese.locator('[data-category-id]').first()).toHaveAttribute('data-category-id', 'education');
  await expect(row(chinese, 'education').getByLabel('英文名称', { exact: true })).toHaveValue('Education');
  await expect(row(chinese, 'education').getByLabel('中文名称', { exact: true })).toHaveValue('教育经历');
  await row(chinese, 'education').getByRole('button', { name: '下移', exact: true }).click();
  await saveManager(chinese, 'zh');
  await expect(nav(page, '教育经历').locator('svg.lucide-book-open')).toHaveCount(1);
  await page.reload();
  await ready(page);
  const persisted = await manager(page, 'zh');
  await expect(persisted.locator('[data-category-id]').nth(1)).toHaveAttribute('data-category-id', 'education');
});

test('validates names before saving and lets users keep or discard unsaved catalog edits', async ({ page }) => {
  await openLibrary(page);
  const dialog = await manager(page);
  const identity = row(dialog, 'identity');
  await identity.getByLabel('English name', { exact: true }).fill('   ');
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('alert')).toBeVisible();
  expect(await categoryCalls(page)).toHaveLength(0);
  await identity.getByLabel('English name', { exact: true }).fill(' eDuCaTiOn ');
  await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  expect(await categoryCalls(page)).toHaveLength(0);
  await identity.getByLabel('English name', { exact: true }).fill('Unsaved personal profile');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Discard unsaved changes?', exact: true });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(identity.getByLabel('English name', { exact: true })).toHaveValue('Unsaved personal profile');
  await page.keyboard.press('Escape');
  await confirmation.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(nav(page, 'Identity')).toBeVisible();
  expect((await storedSnapshot(page)).categories).toEqual(builtinCategories);
  const reopened = await manager(page);
  await expect(row(reopened, 'identity').getByLabel('English name', { exact: true })).toHaveValue('Identity');
  await reopened.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(confirmation).toBeHidden();
});

test('keeps keyboard focus when dismissing the icon picker or removing an unsaved collection', async ({ page }) => {
  await openLibrary(page);
  const dialog = await manager(page);
  const trigger = row(dialog, 'identity').getByRole('button', { name: 'Choose icon', exact: true });
  await trigger.click();
  const picker = row(dialog, 'identity').getByRole('group', { name: 'Choose icon', exact: true });
  await picker.getByRole('button', { name: 'Book', exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(trigger).toBeFocused();
  await expect(dialog.getByRole('button', { name: 'Remove new collection', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'New collection', exact: true }).click();
  const added = dialog.locator('[data-category-id]').last();
  await expect(added.getByLabel('English name', { exact: true })).toBeFocused();
  await added.getByRole('button', { name: 'Remove new collection', exact: true }).click();
  await expect(dialog.locator('[data-category-id]')).toHaveCount(9);
  await expect(row(dialog, 'custom').getByLabel('English name', { exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(await categoryCalls(page)).toHaveLength(0);
});

for (const locale of ['en', 'zh'] as const) {
  test(`preserves a conflicting catalog draft and reloads the latest revision after discard (${locale})`, async ({ page }) => {
    await openLibrary(page, locale);
    const text = locale === 'en'
      ? { english: 'English name', save: 'Save changes', cancel: 'Cancel', discard: 'Discard', conflict: /changed elsewhere/i }
      : { english: '英文名称', save: '保存更改', cancel: '取消', discard: '放弃更改', conflict: /其他地方更新/ };
    const dialog = await manager(page, locale);
    await row(dialog, 'identity').getByLabel(text.english, { exact: true }).fill('My pending profile');
    await page.evaluate(() => {
      const state = (window as any).__folioCategories;
      state.snapshot.categories[0].nameEn = 'External profile';
      state.snapshot.categories[0].nameZh = '外部档案';
      state.snapshot.categoriesRevision = 'external-catalog';
      state.persist();
      window.dispatchEvent(new Event('focus'));
    });
    await dialog.getByRole('button', { name: text.save, exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(text.conflict);
    await expect(page.getByRole('alert')).not.toContainText('CATEGORY_CONFLICT');
    await expect(row(dialog, 'identity').getByLabel(text.english, { exact: true })).toHaveValue('My pending profile');
    expect((await storedSnapshot(page)).categories[0].nameEn).toBe('External profile');
    await dialog.getByRole('button', { name: text.cancel, exact: true }).click();
    await page.getByRole('button', { name: text.discard, exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(nav(page, locale === 'en' ? 'External profile' : '外部档案')).toBeVisible();
    const fresh = await manager(page, locale);
    await expect(row(fresh, 'identity').getByLabel(text.english, { exact: true })).toHaveValue('External profile');
    await row(fresh, 'identity').getByLabel(text.english, { exact: true }).fill('Reconciled profile');
    await saveManager(fresh, locale);
    expect((await categoryCalls(page)).at(-1).args.expectedRevision).toBe('external-catalog');
    expect((await storedSnapshot(page)).categories[0].nameEn).toBe('Reconciled profile');
  });

  test(`keeps a long catalog editable and its footer reachable in a compact window (${locale})`, async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 620 });
    await openLibrary(page, locale);
    await page.getByRole('button', { name: locale === 'en' ? 'Settings' : '设置', exact: true }).click();
    const settings = page.getByRole('dialog', { name: locale === 'en' ? 'Settings' : '设置', exact: true });
    await settings.getByRole('button', { name: locale === 'en' ? 'Manage collections' : '管理分类', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: locale === 'en' ? 'Collections' : '分类', exact: true });
    const add = dialog.getByRole('button', { name: locale === 'en' ? 'New collection' : '新增分类', exact: true });
    for (let index = 0; index < 4; index++) {
      await add.click();
      const added = dialog.locator('[data-category-id]').last();
      await expect(added.getByLabel(locale === 'en' ? 'English name' : '英文名称', { exact: true })).toBeFocused();
      await added.getByLabel(locale === 'en' ? 'English name' : '英文名称', { exact: true }).fill(`Synthetic collection ${index + 1}`);
      await added.getByLabel(locale === 'en' ? 'Chinese name' : '中文名称', { exact: true }).fill(`测试分类 ${index + 1}`);
    }
    const save = dialog.getByRole('button', { name: locale === 'en' ? 'Save changes' : '保存更改', exact: true });
    await expect(save).toBeInViewport();
    await expect(dialog.getByRole('button', { name: locale === 'en' ? 'Close' : '关闭', exact: true })).toBeInViewport();
    expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `artifacts/preview-categories-${locale}-compact.png`, fullPage: true });
    await saveManager(dialog, locale);
    expect((await storedSnapshot(page)).categories).toHaveLength(13);
  });
}
