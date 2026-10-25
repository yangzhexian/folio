import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';

const identityId = '00000000-0000-4000-8000-000000000201';
const researchId = '00000000-0000-4000-8000-000000000202';
const timestamp = '2026-01-12T09:00:00.000Z';
const fixtures = Object.fromEntries(['landscape.png', 'portrait.jpg', 'two-pages.pdf', 'broken.pdf'].map(name => [name, readFileSync(resolve('tests/fixtures', name)).toString('base64')]));
const files = [
  { id: 'png', recordId: identityId, fileName: 'identity_landscape.png', originalName: 'preview-group-landscape.png', fixture: 'landscape.png' },
  { id: 'jpeg', recordId: identityId, fileName: 'identity_portrait.JPG', originalName: 'preview-group-portrait.jpg', fixture: 'portrait.jpg' },
  { id: 'pdf', recordId: identityId, fileName: 'identity_pages.pdf', originalName: 'two-pages.pdf', fixture: 'two-pages.pdf' },
  { id: 'broken', recordId: identityId, fileName: 'identity_broken.pdf', originalName: 'broken.pdf', fixture: 'broken.pdf' },
  { id: 'text', recordId: identityId, fileName: 'identity_notes.txt', originalName: 'notes.txt', fixture: null },
  { id: 'other', recordId: researchId, fileName: 'research_other.png', originalName: 'other.png', fixture: 'landscape.png' },
];
const snapshot = {
  dataDir: 'C:\\SyntheticFolioPreview',
  records: [
    { id: identityId, category: 'identity', title: 'Preview examples', subtitle: '', tags: [], favorite: false, notes: '', fields: [], createdAt: timestamp, updatedAt: timestamp },
    { id: researchId, category: 'research', title: 'Separate record', subtitle: '', tags: [], favorite: false, notes: '', fields: [], createdAt: timestamp, updatedAt: timestamp },
  ],
  attachments: files.map(file => ({ ...file, relativePath: `attachments/${file.fileName}`, absolutePath: `C:\\SyntheticFolioPreview\\attachments\\${file.fileName}`, size: file.fixture ? Buffer.from(fixtures[file.fixture], 'base64').length : 10, createdAt: timestamp })),
};

// Only the native boundary is mocked: image decoding and the local PDF.js worker run normally.
async function openMockDesktop(page: Page, options: { locale?: 'en' | 'zh'; dark?: boolean; blocked?: string[] } = {}) {
  const remoteRequests: string[] = [];
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') remoteRequests.push(request.url());
  });
  await page.addInitScript(({ locale, dark }) => {
    localStorage.setItem('folio.locale', locale);
    localStorage.setItem('folio.theme', dark ? 'dark' : 'light');
  }, { locale: options.locale ?? 'en', dark: options.dark ?? false });
  await page.route('http://127.0.0.1:1420/', async route => {
    const response = await route.fetch();
    const html = await response.text();
    const bootstrap = `
      import { mockIPC, mockWindows } from '/node_modules/@tauri-apps/api/mocks.js';
      globalThis.isTauri = true;
      mockWindows('main');
      const fixtureBytes = ${JSON.stringify(fixtures)};
      const state = globalThis.__folioPreviewTest = {
        snapshot: ${JSON.stringify(snapshot)}, calls: [], blocked: ${JSON.stringify(options.blocked ?? [])}, pending: {}, activeUrls: [], clipboard: '', failures: {}
      };
      const originalCreate = URL.createObjectURL.bind(URL);
      const originalRevoke = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = value => { const url = originalCreate(value); state.activeUrls.push(url); return url; };
      URL.revokeObjectURL = url => { state.activeUrls = state.activeUrls.filter(value => value !== url); originalRevoke(url); };
      mockIPC(async (command, args) => {
        state.calls.push({ command, args });
        if (command === 'load_snapshot') return structuredClone(state.snapshot);
        if (command === 'read_attachment_preview') {
          const file = state.snapshot.attachments.find(file => file.id === args.id);
          if (!file || !file.fixture) throw new Error('Unsupported preview fixture');
          if (state.failures[args.id]) throw new Error(state.failures[args.id]);
          if (state.blocked.includes(args.id)) await new Promise(resolve => (state.pending[args.id] ??= []).push(resolve));
          const bytes = Uint8Array.from(atob(fixtureBytes[file.fixture]), char => char.charCodeAt(0));
          return args.id === 'jpeg' ? bytes : bytes.buffer;
        }
        if (command === 'attachment_path') return state.snapshot.attachments.find(file => file.id === args.id).absolutePath;
        if (command === 'open_attachment' || command === 'reveal_attachment') return;
        if (command === 'plugin:clipboard-manager|write_text') { state.clipboard = args.text; return; }
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
  await expect(page.getByRole('heading', { name: 'Preview examples', exact: true })).toBeVisible();
  return { remoteRequests, pageErrors };
}

function preview(page: Page, locale: 'en' | 'zh' = 'en') {
  return page.getByRole('dialog', { name: locale === 'en' ? 'Attachment preview' : '附件预览', exact: true });
}

async function openFile(page: Page, name: string) {
  await page.locator('.file-open').filter({ hasText: name }).click();
  await expect(preview(page)).toBeVisible();
}

async function expectImage(dialog: Locator, width: number, height: number) {
  const image = dialog.locator('img.preview-image');
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((node: HTMLImageElement) => ({ loaded: node.complete, width: node.naturalWidth, height: node.naturalHeight }))).toEqual({ loaded: true, width, height });
  return image;
}

async function canvasFingerprint(canvas: Locator) {
  return canvas.evaluate((node: HTMLCanvasElement) => node.toDataURL());
}

async function commandIds(page: Page, command: string) {
  return page.evaluate(command => (window as any).__folioPreviewTest.calls.filter((call: any) => call.command === command).map((call: any) => call.args.id), command);
}

test('previews PNG locally, zooms and fits, and keeps native file actions available', async ({ page }) => {
  const observed = await openMockDesktop(page);
  await openFile(page, 'identity_landscape.png');
  const dialog = preview(page);
  const image = await expectImage(dialog, 1200, 900);
  const initialWidth = (await image.boundingBox())!.width;
  await dialog.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect.poll(async () => (await image.boundingBox())!.width).toBeGreaterThan(initialWidth);
  const enlargedWidth = (await image.boundingBox())!.width;
  await dialog.getByRole('button', { name: 'Zoom out', exact: true }).click();
  await expect.poll(async () => (await image.boundingBox())!.width).toBeLessThan(enlargedWidth);
  await dialog.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await dialog.getByRole('button', { name: 'Fit to view', exact: true }).click();
  await expect.poll(async () => Math.abs((await image.boundingBox())!.width - initialWidth)).toBeLessThan(1);
  expect(await commandIds(page, 'open_attachment')).toEqual([]);
  await dialog.getByRole('button', { name: 'Open externally', exact: true }).click();
  await expect.poll(() => commandIds(page, 'open_attachment')).toEqual(['png']);
  await dialog.getByRole('button', { name: 'Copy path', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__folioPreviewTest.clipboard)).toBe('C:\\SyntheticFolioPreview\\attachments\\identity_landscape.png');
  const toast = page.locator('.toast');
  await expect(toast).toContainText('Copied to clipboard');
  await expect.poll(async () => {
    const notice = (await toast.boundingBox())!;
    const toolbar = (await dialog.locator('.preview-toolbar').boundingBox())!;
    return notice.y + notice.height <= toolbar.y;
  }).toBe(true);
  await dialog.getByRole('button', { name: 'Show in folder', exact: true }).click();
  await expect.poll(() => commandIds(page, 'reveal_attachment')).toEqual(['png']);
  await page.screenshot({ path: 'artifacts/preview-attachment-image.png', fullPage: true });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => page.evaluate(() => (window as any).__folioPreviewTest.activeUrls.length)).toBe(0);
  expect(observed.remoteRequests).toEqual([]);
  expect(observed.pageErrors).toEqual([]);
});

test('switches PNG and JPEG attachments within the current record and opens unsupported files externally', async ({ page }) => {
  await openMockDesktop(page);
  await openFile(page, 'identity_landscape.png');
  const dialog = preview(page);
  await expect(dialog.getByRole('button', { name: 'Previous attachment', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Next attachment', exact: true }).click();
  await expectImage(dialog, 900, 1200);
  await expect(dialog).toContainText('identity_portrait.JPG');
  await dialog.getByRole('button', { name: 'Previous attachment', exact: true }).click();
  await expectImage(dialog, 1200, 900);
  await dialog.getByRole('button', { name: 'Next attachment', exact: true }).click();
  await dialog.getByRole('button', { name: 'Next attachment', exact: true }).click();
  await expect(dialog.locator('canvas.preview-pdf-canvas')).toBeVisible();
  await dialog.getByRole('button', { name: 'Next attachment', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Next attachment', exact: true })).toBeDisabled();
  expect(await commandIds(page, 'read_attachment_preview')).not.toContain('other');
  expect(await commandIds(page, 'read_attachment_preview')).not.toContain('text');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('.file-open').filter({ hasText: 'identity_notes.txt' }).click();
  await expect.poll(() => commandIds(page, 'open_attachment')).toEqual(['text']);
  await expect(dialog).toBeHidden();
});

test('renders real PDF pages with local PDF.js, supports page navigation and zoom, and fetches no remote assets', async ({ page }) => {
  const observed = await openMockDesktop(page);
  await openFile(page, 'identity_pages.pdf');
  const dialog = preview(page);
  const canvas = dialog.locator('canvas.preview-pdf-canvas');
  const number = dialog.getByRole('spinbutton', { name: 'Page number', exact: true });
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute('data-rendered-page', '1');
  await expect(number).toHaveValue('1');
  await expect(number).toHaveAttribute('max', '2');
  await expect(dialog.getByRole('button', { name: 'Previous page', exact: true })).toBeDisabled();
  const firstPage = await canvasFingerprint(canvas);
  await dialog.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(number).toHaveValue('2');
  await expect(canvas).toHaveAttribute('data-rendered-page', '2');
  await expect.poll(() => canvasFingerprint(canvas)).not.toBe(firstPage);
  await expect(dialog.getByRole('button', { name: 'Next page', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Previous page', exact: true }).click();
  await expect(number).toHaveValue('1');
  await expect(canvas).toHaveAttribute('data-rendered-page', '1');
  await expect.poll(() => canvasFingerprint(canvas)).toBe(firstPage);
  await number.fill('2');
  await number.press('Enter');
  await expect(number).toHaveValue('2');
  await expect(canvas).toHaveAttribute('data-rendered-page', '2');
  await expect.poll(() => canvasFingerprint(canvas)).not.toBe(firstPage);
  const initialWidth = (await canvas.boundingBox())!.width;
  await dialog.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect.poll(async () => (await canvas.boundingBox())!.width).toBeGreaterThan(initialWidth);
  await dialog.getByRole('button', { name: 'Fit to view', exact: true }).click();
  await expect.poll(async () => Math.abs((await canvas.boundingBox())!.width - initialWidth)).toBeLessThan(1);
  await expect(number).toHaveValue('2');
  await page.screenshot({ path: 'artifacts/preview-attachment-pdf.png', fullPage: true });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(observed.remoteRequests).toEqual([]);
  expect(observed.pageErrors).toEqual([]);
});

test('limits Files view navigation to the current filtered previewable results', async ({ page }) => {
  await openMockDesktop(page);
  await page.getByRole('button', { name: /^Files\s*6$/ }).click();
  await page.getByRole('textbox', { name: 'Search records, fields, files…', exact: true }).fill('preview-group');
  await expect(page.locator('.file-table-row')).toHaveCount(2);
  await openFile(page, 'identity_landscape.png');
  const dialog = preview(page);
  await expectImage(dialog, 1200, 900);
  await expect(dialog.getByRole('button', { name: 'Previous attachment', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Next attachment', exact: true }).click();
  await expectImage(dialog, 900, 1200);
  await expect(dialog.getByRole('button', { name: 'Next attachment', exact: true })).toBeDisabled();
  expect(await commandIds(page, 'read_attachment_preview')).not.toContain('pdf');
  expect(await commandIds(page, 'read_attachment_preview')).not.toContain('other');
});

test('ignores stale loads when switching and closing attachments', async ({ page }) => {
  const observed = await openMockDesktop(page, { blocked: ['png', 'pdf'] });
  await openFile(page, 'identity_landscape.png');
  const dialog = preview(page);
  await expect(dialog.getByRole('status').filter({ hasText: 'Loading preview…' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__folioPreviewTest.pending.png?.length ?? 0)).toBeGreaterThan(0);
  await dialog.getByRole('button', { name: 'Next attachment', exact: true }).click();
  await expectImage(dialog, 900, 1200);
  await page.evaluate(() => {
    const state = (window as any).__folioPreviewTest;
    state.blocked = state.blocked.filter((id: string) => id !== 'png');
    for (const release of state.pending.png) release();
  });
  await expectImage(dialog, 900, 1200);
  await expect(dialog).toContainText('identity_portrait.JPG');
  await dialog.getByRole('button', { name: 'Next attachment', exact: true }).click();
  await expect(dialog.getByRole('status').filter({ hasText: 'Loading preview…' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__folioPreviewTest.pending.pdf?.length ?? 0)).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await openFile(page, 'identity_landscape.png');
  await expectImage(dialog, 1200, 900);
  await page.evaluate(() => {
    const state = (window as any).__folioPreviewTest;
    for (const release of state.pending.pdf) release();
  });
  await expectImage(dialog, 1200, 900);
  await expect(dialog.locator('canvas.preview-pdf-canvas')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => (window as any).__folioPreviewTest.activeUrls.length)).toBe(0);
  expect(observed.pageErrors).toEqual([]);
});

test('shows an actionable error for malformed PDFs and recovers when switching to a valid attachment', async ({ page }) => {
  const observed = await openMockDesktop(page);
  await openFile(page, 'identity_broken.pdf');
  const dialog = preview(page);
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByRole('alert')).toHaveText('This file could not be previewed. You can open it externally.');
  await expect(dialog.getByRole('button', { name: 'Open externally', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Open externally', exact: true }).click();
  await expect.poll(() => commandIds(page, 'open_attachment')).toEqual(['broken']);
  await dialog.getByRole('button', { name: 'Previous attachment', exact: true }).click();
  await expect(dialog.locator('canvas.preview-pdf-canvas')).toBeVisible();
  await expect(dialog.getByRole('alert')).toBeHidden();
  await expect(dialog.getByRole('spinbutton', { name: 'Page number', exact: true })).toHaveValue('1');
  expect(observed.remoteRequests).toEqual([]);
  expect(observed.pageErrors).toEqual([]);
});

test('keeps Chinese dark preview usable at minimum window size, traps focus, and restores it on Escape', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 620 });
  await openMockDesktop(page, { locale: 'zh', dark: true });
  const trigger = page.locator('.file-open').filter({ hasText: 'identity_pages.pdf' });
  await trigger.click();
  const dialog = preview(page, 'zh');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('canvas.preview-pdf-canvas')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const buttons = dialog.getByRole('button');
  for (const button of await buttons.all()) await expect(button).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const bounds = (await dialog.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(900);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(620);
  for (let index = 0; index < 18; index++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
  await page.screenshot({ path: 'artifacts/preview-attachment-zh-dark-compact.png', fullPage: true });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('serializes rapid PDF page and zoom changes and cleans up when closed during rendering', async ({ page }) => {
  const observed = await openMockDesktop(page);
  await openFile(page, 'identity_pages.pdf');
  const dialog = preview(page);
  const canvas = dialog.locator('canvas.preview-pdf-canvas');
  await expect(canvas).toHaveAttribute('data-rendered-page', '1');
  const originalPage = await canvasFingerprint(canvas);
  // Actual keyboard input can arrive before the PDF.js render task has settled.
  for (let repeat = 0; repeat < 4; repeat++) {
    await page.keyboard.press('PageDown');
    await page.keyboard.press('Equal');
    await page.keyboard.press('PageUp');
    await page.keyboard.press('Minus');
  }
  await page.keyboard.press('PageDown');
  await page.keyboard.press('Equal');
  await page.keyboard.press('Equal');
  await page.keyboard.press('Equal');
  await expect(dialog.getByRole('spinbutton', { name: 'Page number', exact: true })).toHaveValue('2');
  await expect(dialog.getByRole('status', { name: 'Zoom', exact: true })).toHaveText('175%');
  await expect(canvas).toHaveAttribute('data-rendered-page', '2');
  await expect.poll(() => canvasFingerprint(canvas)).not.toBe(originalPage);
  await expect(dialog.locator('.preview-loading')).toBeHidden();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await page.keyboard.press('Equal');
  await page.keyboard.press('PageUp');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await openFile(page, 'identity_pages.pdf');
  await expect(canvas).toHaveAttribute('data-rendered-page', '1');
  await expect(dialog.getByRole('status', { name: 'Zoom', exact: true })).toHaveText('100%');
  await expect.poll(() => canvasFingerprint(canvas)).toBe(originalPage);
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => (window as any).__folioPreviewTest.activeUrls.length)).toBe(0);
  expect(observed.remoteRequests).toEqual([]);
  expect(observed.pageErrors).toEqual([]);
});

for (const locale of ['en', 'zh'] as const) {
  test(`localizes native preview errors and retries successfully (${locale})`, async ({ page }) => {
    const observed = await openMockDesktop(page, { locale });
    await page.evaluate(() => { (window as any).__folioPreviewTest.failures.png = 'PREVIEW_TOO_LARGE'; });
    await page.locator('.file-open').filter({ hasText: 'identity_landscape.png' }).click();
    const dialog = preview(page, locale);
    await expect(dialog.getByRole('alert')).toHaveText(locale === 'en' ? 'This file exceeds the preview limit. Open it externally instead.' : '文件超过预览限制，请使用外部应用打开。');
    await expect(dialog.getByRole('button', { name: locale === 'en' ? 'Open externally' : '外部打开', exact: true })).toBeEnabled();
    await expect(dialog.locator('img.preview-image')).toHaveCount(0);
    await page.evaluate(() => { (window as any).__folioPreviewTest.failures.png = 'PREVIEW_UNAVAILABLE'; });
    await dialog.getByRole('button', { name: locale === 'en' ? 'Try again' : '重试', exact: true }).click();
    await expect(dialog.getByRole('alert')).toHaveText(locale === 'en' ? 'This file is unavailable. Try again or open it externally.' : '文件不可用，请重试或使用外部应用打开。');
    await page.evaluate(() => { delete (window as any).__folioPreviewTest.failures.png; });
    await dialog.getByRole('button', { name: locale === 'en' ? 'Try again' : '重试', exact: true }).click();
    await expectImage(dialog, 1200, 900);
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await page.evaluate(() => { (window as any).__folioPreviewTest.failures.pdf = 'PREVIEW_PASSWORD'; });
    await dialog.getByRole('button', { name: locale === 'en' ? 'Next attachment' : '下一个附件', exact: true }).click();
    await dialog.getByRole('button', { name: locale === 'en' ? 'Next attachment' : '下一个附件', exact: true }).click();
    await expect(dialog.getByRole('alert')).toHaveText(locale === 'en' ? 'This PDF requires a password. Open it externally to continue.' : '此 PDF 需要密码，请使用外部应用打开。');
    await page.evaluate(() => { delete (window as any).__folioPreviewTest.failures.pdf; });
    await dialog.getByRole('button', { name: locale === 'en' ? 'Try again' : '重试', exact: true }).click();
    await expect(dialog.locator('canvas.preview-pdf-canvas')).toHaveAttribute('data-rendered-page', '1');
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => (window as any).__folioPreviewTest.activeUrls.length)).toBe(0);
    expect(observed.remoteRequests).toEqual([]);
    expect(observed.pageErrors).toEqual([]);
  });
}
