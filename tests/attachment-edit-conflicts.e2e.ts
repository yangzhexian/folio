import { expect, test, type Page } from '@playwright/test';

async function openDesktop(page: Page, locale: string) {
  await page.addInitScript(language => localStorage.setItem('folio.locale', language), locale);
  await page.route('http://127.0.0.1:1420/', async route => {
    const response = await route.fetch();
    const bootstrap = `
      import { mockIPC, mockWindows } from '/node_modules/@tauri-apps/api/mocks.js';
      globalThis.isTauri = true;
      mockWindows('main');
      const timestamp = '2026-01-01T00:00:00.000Z';
      const record = { id: '00000000-0000-4000-8000-000000000401', category: 'documents', title: 'Attachment conflict example', subtitle: '', tags: [], favorite: false, notes: '', fields: [], createdAt: timestamp, updatedAt: timestamp };
      const file = { id: '00000000-0000-4000-8000-000000000402', recordId: record.id, originalName: 'example.txt', fileName: 'documents_example.txt', relativePath: 'attachments/example.txt', absolutePath: 'C:/Synthetic/example.txt', size: 10, createdAt: timestamp, revision: 'first-revision' };
      const state = globalThis.__attachmentConflict = { snapshot: { records: [record], attachments: [file], dataDir: 'C:/Synthetic' }, calls: [] };
      mockIPC((command, args) => {
        state.calls.push({ command, args });
        if (command === 'load_snapshot') return structuredClone(state.snapshot);
        if (command === 'rename_attachment' || command === 'remove_attachment') {
          const current = state.snapshot.attachments.find(item => item.id === args.id);
          if (args.expectedRevision !== current.revision) throw new Error('ATTACHMENT_CONFLICT');
          if (command === 'remove_attachment') state.snapshot.attachments = [];
          else { current.fileName = 'documents_' + args.name + '.txt'; current.revision = 'saved-revision'; }
          return current;
        }
        if (command.startsWith('plugin:window|')) return;
        throw new Error('Unmocked command: ' + command);
      }, { shouldMockEvents: true });
      await import('/src/main.tsx');
    `;
    await route.fulfill({ response, body: (await response.text()).replace(/<script type="module" src="\/src\/main\.tsx(?:\?[^\"]*)?"><\/script>/, () => `<script type="module">${bootstrap}</script>`) });
  });
  await page.goto('/');
  await expect(page.locator('.attachment-row')).toHaveCount(1);
}

for (const locale of ['en', 'zh']) {
  const labels = locale === 'en'
    ? { rename: 'Rename', remove: 'Remove', close: 'Close', save: 'Save changes', name: 'File name', conflict: 'This attachment changed elsewhere.' }
    : { rename: '重命名', remove: '移除', close: '关闭', save: '保存更改', name: '文件名', conflict: '此附件已在其他地方更新。' };

  for (const action of ['rename', 'remove'] as const) {
    test(`protects a stale attachment ${action} and recovers with the current revision (${locale})`, async ({ page }) => {
      await openDesktop(page, locale);
      await page.locator('.attachment-row').getByRole('button', { name: labels[action], exact: true }).click();
      const dialog = page.getByRole('dialog');
      if (action === 'rename') await dialog.getByRole('textbox', { name: labels.name }).fill('proposed');
      await page.evaluate(() => {
        const file = (window as any).__attachmentConflict.snapshot.attachments[0];
        file.fileName = 'documents_external.txt';
        file.revision = 'external-revision';
      });
      await dialog.getByRole('button', { name: action === 'rename' ? labels.save : labels.remove, exact: true }).click();
      await expect(page.locator('.toast')).toContainText(labels.conflict);
      await expect(dialog).toBeVisible();
      if (action === 'rename') await expect(dialog.getByRole('textbox', { name: labels.name })).toHaveValue('proposed');
      expect(await page.evaluate(() => (window as any).__attachmentConflict.snapshot.attachments[0].fileName)).toBe('documents_external.txt');
      await dialog.getByRole('button', { name: labels.close, exact: true }).click();
      await expect(page.locator('.attachment-name strong')).toHaveText('documents_external.txt');
      await page.locator('.attachment-row').getByRole('button', { name: labels[action], exact: true }).click();
      if (action === 'rename') await dialog.getByRole('textbox', { name: labels.name }).fill('current');
      await dialog.getByRole('button', { name: action === 'rename' ? labels.save : labels.remove, exact: true }).click();
      await expect(dialog).toHaveCount(0);
      if (action === 'rename') await expect(page.locator('.attachment-name strong')).toHaveText('documents_current.txt');
      else await expect(page.locator('.attachment-row')).toHaveCount(0);
    });
  }
}
