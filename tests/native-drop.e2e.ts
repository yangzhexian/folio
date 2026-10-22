import { expect, test, type Page } from '@playwright/test';

const identityId = '00000000-0000-4000-8000-000000000101';
const researchId = '00000000-0000-4000-8000-000000000102';
const timestamp = '2026-01-12T09:00:00.000Z';
const initialSnapshot = {
  dataDir: 'C:\\SyntheticFolio',
  records: [
    { id: identityId, category: 'identity', title: 'Identity record', subtitle: '', tags: [], favorite: false, notes: '', fields: [], createdAt: timestamp, updatedAt: timestamp },
    { id: researchId, category: 'research', title: 'Research record', subtitle: '', tags: [], favorite: false, notes: '', fields: [], createdAt: timestamp, updatedAt: timestamp },
  ],
  attachments: [
    { id: 'passport', recordId: identityId, originalName: 'passport.pdf', fileName: 'identity__passport__123.pdf', relativePath: 'attachments/passport.pdf', absolutePath: 'C:\\SyntheticFolio\\attachments\\passport.pdf', size: 20, createdAt: timestamp },
    { id: 'resume', recordId: identityId, originalName: 'resume.pdf', fileName: 'identity__resume__456.pdf', relativePath: 'attachments/resume.pdf', absolutePath: 'C:\\SyntheticFolio\\attachments\\resume.pdf', size: 30, createdAt: timestamp },
    { id: 'report', recordId: researchId, originalName: 'report.pdf', fileName: 'research__report__789.pdf', relativePath: 'attachments/report.pdf', absolutePath: 'C:\\SyntheticFolio\\attachments\\report.pdf', size: 40, createdAt: timestamp },
  ],
};

// Exercise the real frontend and Tauri event adapters with the package's public
// IPC mocks. Files and backend persistence remain covered by Rust tests.
async function openMockDesktop(page: Page, empty = false) {
  const snapshot = empty ? { ...initialSnapshot, records: [], attachments: [] } : initialSnapshot;
  await page.route('http://127.0.0.1:1420/', async route => {
    const response = await route.fetch();
    const html = await response.text();
    const bootstrap = `
      import { mockIPC, mockWindows } from '/node_modules/@tauri-apps/api/mocks.js';
      globalThis.isTauri = true;
      mockWindows('main');
      const state = globalThis.__folioTest = {
        snapshot: ${JSON.stringify(snapshot)}, calls: [], failNextImport: false, failLoadAfterImport: false, failNextLoad: false,
        blockImport: false, releaseImport: null, importSerial: 0
      };
      mockIPC(async (command, args) => {
        state.calls.push({ command, args });
        if (command === 'load_snapshot') {
          if (state.failNextLoad) { state.failNextLoad = false; throw new Error('Synthetic refresh failure'); }
          return structuredClone(state.snapshot);
        }
        if (command === 'save_record') {
          const saved = { ...args.record, updatedAt: new Date().toISOString() };
          state.snapshot.records = [...state.snapshot.records.filter(record => record.id !== saved.id), saved];
          return structuredClone(saved);
        }
        if (command === 'delete_record') {
          state.snapshot.records = state.snapshot.records.filter(record => record.id !== args.id);
          state.snapshot.attachments = state.snapshot.attachments.filter(file => file.recordId !== args.id);
          return;
        }
        if (command === 'import_dropped_attachments') {
          if (state.blockImport) await new Promise(resolve => { state.releaseImport = resolve; });
          if (state.failNextImport) { state.failNextImport = false; throw new Error('Synthetic import failure'); }
          const record = state.snapshot.records.find(record => record.id === args.recordId);
          if (!record) throw new Error('Missing destination record');
          const files = args.paths.map(path => {
            const originalName = path.split(/[\\\\/]/).pop();
            const id = 'import-' + (++state.importSerial);
            return { id, recordId: record.id, originalName, fileName: record.category + '__' + originalName,
              relativePath: 'attachments/' + id, absolutePath: 'C:/SyntheticFolio/attachments/' + id,
              size: 123, createdAt: new Date().toISOString() };
          });
          state.snapshot.attachments.push(...files);
          if (state.failLoadAfterImport) { state.failLoadAfterImport = false; state.failNextLoad = true; }
          return structuredClone(files);
        }
        if (command.startsWith('plugin:window|')) return;
        throw new Error('Unmocked IPC command: ' + command);
      }, { shouldMockEvents: true });
      await import('/src/main.tsx');
    `;
    const entryScript = /<script type="module" src="\/src\/main\.tsx(?:\?[^\"]*)?"><\/script>/;
    expect(html).toMatch(entryScript);
    await route.fulfill({ response, body: html.replace(entryScript, () => `<script type="module">${bootstrap}</script>`) });
  });
  await page.goto('/');
  await expect(page.locator('.nav-item.selected')).toContainText('All records');
  await expect(page.locator('.record-card')).toHaveCount(empty ? 0 : 2);
  await expect.poll(() => page.evaluate(() => (window as any).__TAURI_INTERNALS__.callbacks.size)).toBeGreaterThanOrEqual(5);
}

async function emitDrop(page: Page, paths: string[], eventType: 'drop' | 'enter' | 'leave' = 'drop') {
  await page.evaluate(({ paths, eventType }) => (window as any).__TAURI_INTERNALS__.invoke('plugin:event|emit', {
    event: 'tauri://drag-' + eventType, payload: { paths, position: { x: 500, y: 300 } },
  }), { paths, eventType });
}

async function importCalls(page: Page) {
  return page.evaluate(() => (window as any).__folioTest.calls.filter((call: any) => call.command === 'import_dropped_attachments'));
}

test('imports native dropped paths into the open record and deduplicates repeated paths', async ({ page }) => {
  await openMockDesktop(page);
  await expect(page.getByRole('heading', { name: 'Identity record', exact: true })).toBeVisible();
  await emitDrop(page, ['C:\\fixtures\\visa.pdf'], 'enter');
  await expect(page.locator('.drop-overlay')).toBeVisible();
  await expect(page.locator('.drop-overlay')).toContainText('Identity record');
  await page.screenshot({ path: 'artifacts/preview-file-drop.png', fullPage: true });
  await emitDrop(page, [], 'leave');
  await expect(page.locator('.drop-overlay')).toBeHidden();
  await emitDrop(page, ['C:\\fixtures\\visa.pdf', 'C:\\fixtures\\visa.pdf']);
  await expect(page.getByRole('status')).toContainText('Files added');
  const calls = await importCalls(page);
  expect(calls).toHaveLength(1);
  expect(calls[0].args).toEqual({ recordId: identityId, paths: ['C:\\fixtures\\visa.pdf'] });
  await expect(page.locator('.attachment-name strong').filter({ hasText: 'visa.pdf' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Identity record', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('lets Files view drops choose an existing record and cancels without importing', async ({ page }) => {
  await openMockDesktop(page);
  await page.getByRole('button', { name: /^Files\s*3$/ }).click();
  await emitDrop(page, ['C:\\fixtures\\lab.pdf']);
  const chooser = page.getByRole('dialog', { name: 'Add files', exact: true });
  await expect(chooser).toBeVisible();
  await page.setViewportSize({ width: 900, height: 620 });
  await page.screenshot({ path: 'artifacts/preview-file-target.png', fullPage: true });
  await chooser.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await importCalls(page)).toHaveLength(0);
  await emitDrop(page, ['C:\\fixtures\\lab.pdf']);
  await chooser.getByRole('combobox', { name: 'Add to', exact: true }).selectOption(researchId);
  await chooser.getByRole('button', { name: 'Add files', exact: true }).click();
  await expect(chooser).toBeHidden();
  const calls = await importCalls(page);
  expect(calls).toHaveLength(1);
  expect(calls[0].args.recordId).toBe(researchId);
  await expect(page.getByRole('heading', { name: 'Research record', exact: true })).toBeVisible();
  await expect(page.locator('.attachment-name strong').filter({ hasText: 'lab.pdf' })).toBeVisible();
});

test('creates a document for an empty-library drop and rolls it back when import fails', async ({ page }) => {
  await openMockDesktop(page, true);
  await page.evaluate(() => { (window as any).__folioTest.failNextImport = true; });
  await emitDrop(page, ['C:\\fixtures\\certificate.pdf']);
  const chooser = page.getByRole('dialog', { name: 'Add files', exact: true });
  await expect(chooser.getByRole('combobox', { name: 'Add to', exact: true })).toHaveValue('__new__');
  await expect(chooser.getByRole('textbox', { name: 'Record title', exact: true })).toHaveValue('certificate');
  await chooser.getByRole('textbox', { name: 'Record title', exact: true }).fill('Synthetic certificate');
  await chooser.getByRole('button', { name: 'Add files', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Synthetic import failure');
  await expect(chooser).toBeVisible();
  expect(await page.evaluate(() => (window as any).__folioTest.snapshot.records.length)).toBe(0);
  await chooser.getByRole('button', { name: 'Add files', exact: true }).click();
  await expect(chooser).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Synthetic certificate', exact: true })).toBeVisible();
  const records = await page.evaluate(() => (window as any).__folioTest.snapshot.records);
  expect(records).toHaveLength(1);
  expect(records[0].category).toBe('documents');
  await expect(page.locator('.attachment-name strong').filter({ hasText: 'certificate.pdf' })).toBeVisible();
});

test('retries only the reload when refreshing after a successful import fails', async ({ page }) => {
  await openMockDesktop(page, true);
  await page.evaluate(() => { (window as any).__folioTest.failLoadAfterImport = true; });
  await emitDrop(page, ['C:\\fixtures\\completed.pdf']);
  const chooser = page.getByRole('dialog', { name: 'Add files', exact: true });
  await chooser.getByRole('button', { name: 'Add files', exact: true }).click();
  await expect(chooser).toBeHidden();
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
  await expect(page.getByText('Synthetic refresh failure', { exact: false }).first()).toBeVisible();
  expect(await importCalls(page)).toHaveLength(1);
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'completed', exact: true })).toBeVisible();
  await expect(page.locator('.record-card')).toHaveCount(1);
  await expect(page.locator('.attachment-name strong')).toHaveCount(1);
  expect(await importCalls(page)).toHaveLength(1);
  expect(await page.evaluate(() => (window as any).__folioTest.snapshot.records.length)).toBe(1);
});

test('rejects drops during modal editing or an active import without duplicating commands', async ({ page }) => {
  await openMockDesktop(page);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit', exact: true });
  await emitDrop(page, ['C:\\fixtures\\blocked.pdf']);
  await expect(page.getByRole('alert')).toContainText('Close the dialog before adding files.');
  expect(await importCalls(page)).toHaveLength(0);
  await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.evaluate(() => { (window as any).__folioTest.blockImport = true; });
  await emitDrop(page, ['C:\\fixtures\\first.pdf']);
  await expect.poll(() => importCalls(page).then(calls => calls.length)).toBe(1);
  await emitDrop(page, ['C:\\fixtures\\second.pdf']);
  await expect(page.getByRole('alert')).toContainText('Wait for the current operation to finish.');
  expect(await importCalls(page)).toHaveLength(1);
  await page.evaluate(() => { (window as any).__folioTest.releaseImport(); });
  await expect(page.getByRole('status')).toContainText('Files added');
});

test('filters individual file names, exposes full names, and distinguishes empty search results', async ({ page }) => {
  await openMockDesktop(page);
  await expect(page.locator('.attachment-name strong').filter({ hasText: 'passport' })).toHaveAttribute('title', 'identity__passport__123.pdf');
  await page.getByRole('button', { name: /^Files\s*3$/ }).click();
  const search = page.getByRole('textbox', { name: 'Search records, fields, files…' });
  await search.fill('passport');
  await expect(page.locator('.file-table-row')).toHaveCount(1);
  await expect(page.locator('.file-name strong')).toHaveText('identity__passport__123.pdf');
  await expect(page.locator('.file-name strong')).toHaveAttribute('title', 'identity__passport__123.pdf');
  await search.fill('Identity record');
  await expect(page.locator('.file-table-row')).toHaveCount(2);
  await search.fill('nonexistent.pdf');
  await expect(page.getByRole('heading', { name: 'No matching files', exact: true })).toBeVisible();
  await page.locator('.file-library').getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(page.locator('.file-table-row')).toHaveCount(3);
});
