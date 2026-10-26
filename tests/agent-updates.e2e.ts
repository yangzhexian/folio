import { expect, test, type Page } from '@playwright/test';

const recordId = '00000000-0000-4000-8000-000000000701';
const addedId = '00000000-0000-4000-8000-000000000702';
const originalRevision = '2026-10-26T01:00:00.000Z';
const externalRevision = '2026-10-26T02:00:00.000Z';
const initialSnapshot = {
  dataDir: 'C:\\SyntheticAgentUpdates', attachments: [],
  records: [{
    id: recordId, category: 'contacts', title: 'Synthetic contact', subtitle: '', tags: [], favorite: false, notes: '',
    fields: [{ id: 'email', label: 'Email', labelZh: '邮箱', value: 'before@example.invalid', kind: 'email', sensitive: false }],
    createdAt: originalRevision, updatedAt: originalRevision,
  }],
};

async function openMockDesktop(page: Page, locale: 'en' | 'zh' = 'en') {
  await page.addInitScript(value => localStorage.setItem('folio.locale', value), locale);
  await page.route('http://127.0.0.1:1420/', async route => {
    const response = await route.fetch();
    const html = await response.text();
    const bootstrap = `
      import { mockIPC, mockWindows } from '/node_modules/@tauri-apps/api/mocks.js';
      globalThis.isTauri = true;
      mockWindows('main');
      const state = globalThis.__folioAgentUpdates = {
        snapshot: ${JSON.stringify(initialSnapshot)}, calls: [], blockSave: false, releaseSave: null,
        blockNextLoad: false, releaseLoad: null,
      };
      mockIPC(async (command, args) => {
        state.calls.push({ command, args });
        if (command === 'load_snapshot') {
          const snapshot = structuredClone(state.snapshot);
          if (state.blockNextLoad) {
            state.blockNextLoad = false;
            await new Promise(resolve => { state.releaseLoad = resolve; });
          }
          return snapshot;
        }
        if (command === 'save_record') {
          if (state.blockSave) await new Promise(resolve => { state.releaseSave = resolve; });
          const existing = state.snapshot.records.find(record => record.id === args.record.id);
          if (existing && existing.updatedAt !== args.record.updatedAt) throw 'RECORD_CONFLICT';
          const saved = { ...args.record, updatedAt: '2026-10-26T03:00:00.000Z' };
          state.snapshot.records = [...state.snapshot.records.filter(record => record.id !== saved.id), saved];
          return structuredClone(saved);
        }
        if (command.startsWith('plugin:window|')) return;
        throw new Error('Unmocked synthetic command: ' + command);
      }, { shouldMockEvents: true });
      await import('/src/main.tsx');
    `;
    const entry = /<script type="module" src="\/src\/main\.tsx(?:\?[^\"]*)?"><\/script>/;
    expect(html).toMatch(entry);
    await route.fulfill({ response, body: html.replace(entry, () => `<script type="module">${bootstrap}</script>`) });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Synthetic contact', exact: true })).toBeVisible();
}

async function simulateAgentUpdate(page: Page, addRecord = false) {
  await page.evaluate(({ recordId, addedId, revision, addRecord }) => {
    const state = (window as any).__folioAgentUpdates;
    const record = state.snapshot.records.find((item: any) => item.id === recordId);
    record.title = 'Updated by local agent';
    record.fields[0].value = 'agent@example.invalid';
    record.updatedAt = revision;
    if (addRecord) state.snapshot.records.push({ ...structuredClone(record), id: addedId, title: 'Created by local agent', fields: [] });
  }, { recordId, addedId, revision: externalRevision, addRecord });
}

async function focusWindow(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function loadCount(page: Page) {
  return page.evaluate(() => (window as any).__folioAgentUpdates.calls.filter((call: any) => call.command === 'load_snapshot').length);
}

test('refreshes externally entered records and values when the desktop window regains focus', async ({ page }) => {
  await openMockDesktop(page);
  const previousLoads = await loadCount(page);
  await simulateAgentUpdate(page, true);
  await expect(page.getByRole('heading', { name: 'Synthetic contact', exact: true })).toBeVisible();
  await focusWindow(page);
  await expect.poll(() => loadCount(page)).toBeGreaterThan(previousLoads);
  await expect(page.locator('.record-card')).toHaveCount(2);
  await expect(page.getByRole('heading', { name: 'Updated by local agent', exact: true })).toBeVisible();
  await expect(page.locator('.field-value')).toHaveText('agent@example.invalid');
  await expect(page.locator('.record-title').filter({ hasText: 'Created by local agent' })).toHaveCount(1);
});

test('refreshes through the native window focus event without resetting selection', async ({ page }) => {
  await openMockDesktop(page);
  await simulateAgentUpdate(page, true);
  await page.evaluate(() => (window as any).__TAURI_INTERNALS__.invoke('plugin:event|emit', { event: 'tauri://focus', payload: true }));
  await expect(page.locator('.record-card')).toHaveCount(2);
  await expect(page.getByRole('heading', { name: 'Updated by local agent', exact: true })).toBeVisible();
  await page.locator('.record-card').filter({ hasText: 'Created by local agent' }).click();
  await focusWindow(page);
  await expect(page.getByRole('heading', { name: 'Created by local agent', exact: true })).toBeVisible();
});

for (const { locale, focus } of [
  { locale: 'en', focus: true },
  { locale: 'zh', focus: true },
  { locale: 'en', focus: false },
] as const) {
  test(`keeps a draft and refuses to overwrite an agent revision, then reloads after discard (${locale}, ${focus ? 'with focus' : 'without focus'})`, async ({ page }) => {
    await openMockDesktop(page, locale);
    const labels = locale === 'en'
      ? { edit: 'Edit', title: 'Title', save: 'Save changes', cancel: 'Cancel', discard: 'Discard', conflict: /changed elsewhere/i }
      : { edit: '编辑', title: '标题', save: '保存更改', cancel: '取消', discard: '放弃更改', conflict: /其他地方更新/ };
    await page.getByRole('button', { name: labels.edit, exact: true }).click();
    const editor = page.getByRole('dialog', { name: labels.edit, exact: true });
    await editor.getByLabel(labels.title, { exact: true }).fill('My unsaved title');
    const previousLoads = await loadCount(page);
    await simulateAgentUpdate(page);
    if (focus) await focusWindow(page);
    expect(await loadCount(page)).toBe(previousLoads);
    await expect(editor.getByLabel(labels.title, { exact: true })).toHaveValue('My unsaved title');
    await editor.getByRole('button', { name: labels.save, exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(labels.conflict);
    await expect(page.getByRole('alert')).not.toContainText('RECORD_CONFLICT');
    await expect(editor).toBeVisible();
    await expect(editor.getByLabel(labels.title, { exact: true })).toHaveValue('My unsaved title');
    expect(await page.evaluate(() => (window as any).__folioAgentUpdates.snapshot.records[0].title)).toBe('Updated by local agent');
    expect(await page.evaluate(() => (window as any).__folioAgentUpdates.snapshot.records[0].updatedAt)).toBe(externalRevision);
    await editor.getByRole('button', { name: labels.cancel, exact: true }).click();
    await page.getByRole('button', { name: labels.discard, exact: true }).click();
    await expect(editor).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Updated by local agent', exact: true })).toBeVisible();
    await expect(page.locator('.field-value')).toHaveText('agent@example.invalid');
    await page.getByRole('button', { name: labels.edit, exact: true }).click();
    await editor.getByLabel(labels.title, { exact: true }).fill('Saved from current revision');
    await editor.getByRole('button', { name: labels.save, exact: true }).click();
    await expect(editor).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Saved from current revision', exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as any).__folioAgentUpdates.snapshot.records[0].fields[0].value)).toBe('agent@example.invalid');
  });
}

test('defers focus refresh while a save is active and retains records created by an agent', async ({ page }) => {
  await openMockDesktop(page);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit', exact: true });
  await editor.getByLabel('Title', { exact: true }).fill('Saved by desktop');
  await page.evaluate(() => { (window as any).__folioAgentUpdates.blockSave = true; });
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).__folioAgentUpdates.releaseSave)).toBe('function');
  const previousLoads = await loadCount(page);
  await page.evaluate(({ addedId, revision }) => {
    const state = (window as any).__folioAgentUpdates;
    state.snapshot.records.push({ ...structuredClone(state.snapshot.records[0]), id: addedId, title: 'Created during save', updatedAt: revision, fields: [] });
  }, { addedId, revision: externalRevision });
  await focusWindow(page);
  expect(await loadCount(page)).toBe(previousLoads);
  await expect(editor.getByLabel('Title', { exact: true })).toHaveValue('Saved by desktop');
  await page.evaluate(() => {
    const state = (window as any).__folioAgentUpdates;
    state.blockSave = false;
    state.releaseSave();
  });
  await expect(editor).toBeHidden();
  await expect(page.locator('.record-card')).toHaveCount(2);
  await expect(page.getByRole('heading', { name: 'Saved by desktop', exact: true })).toBeVisible();
  await expect(page.locator('.record-title')).toContainText(['Saved by desktop', 'Created during save']);
});

test('does not apply an older focus snapshot after a desktop save finishes', async ({ page }) => {
  await openMockDesktop(page);
  await page.evaluate(() => { (window as any).__folioAgentUpdates.blockNextLoad = true; });
  await focusWindow(page);
  await expect.poll(() => page.evaluate(() => typeof (window as any).__folioAgentUpdates.releaseLoad)).toBe('function');
  await page.evaluate(() => { (window as any).__folioAgentUpdates.blockSave = true; });
  await page.getByRole('button', { name: 'Add to favorites', exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).__folioAgentUpdates.releaseSave)).toBe('function');
  await page.evaluate(() => {
    const state = (window as any).__folioAgentUpdates;
    state.blockSave = false;
    state.releaseSave();
  });
  const favorite = page.getByRole('button', { name: 'Remove from favorites', exact: true });
  await expect(favorite).toBeEnabled();
  const loadsAfterSave = await loadCount(page);
  await page.evaluate(() => (window as any).__folioAgentUpdates.releaseLoad());
  await expect.poll(() => loadCount(page)).toBeGreaterThan(loadsAfterSave);
  await expect(favorite).toBeEnabled();
  expect(await page.evaluate(() => (window as any).__folioAgentUpdates.snapshot.records[0].favorite)).toBe(true);
});

test('queues a focus event received while an older snapshot is still loading', async ({ page }) => {
  await openMockDesktop(page);
  await page.evaluate(() => { (window as any).__folioAgentUpdates.blockNextLoad = true; });
  await focusWindow(page);
  await expect.poll(() => page.evaluate(() => typeof (window as any).__folioAgentUpdates.releaseLoad)).toBe('function');
  const loadsInFlight = await loadCount(page);
  await simulateAgentUpdate(page, true);
  await focusWindow(page);
  expect(await loadCount(page)).toBe(loadsInFlight);
  await page.evaluate(() => (window as any).__folioAgentUpdates.releaseLoad());
  await expect.poll(() => loadCount(page)).toBeGreaterThan(loadsInFlight);
  await expect(page.locator('.record-card')).toHaveCount(2);
  await expect(page.getByRole('heading', { name: 'Updated by local agent', exact: true })).toBeVisible();
  await expect(page.locator('.field-value')).toHaveText('agent@example.invalid');
});
