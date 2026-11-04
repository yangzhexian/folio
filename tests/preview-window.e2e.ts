import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const timestamp = '2026-11-04T00:00:00.000Z';
const recordId = '00000000-0000-4000-8000-000000000201';
const files = [
  { id: '00000000-0000-4000-8000-000000000301', fileName: 'documents_landscape.png', originalName: 'landscape.png', fixture: 'landscape.png' },
  { id: '00000000-0000-4000-8000-000000000302', fileName: 'documents_pages.pdf', originalName: 'two-pages.pdf', fixture: 'two-pages.pdf' },
].map(file => ({ ...file, recordId, relativePath: `attachments/${file.fileName}`, absolutePath: `C:\\SyntheticPreview\\${file.fileName}`, size: 1024, createdAt: timestamp, revision: 'revision-1' }));
const record = { id: recordId, category: 'documents', title: 'Window examples', subtitle: '', tags: [], favorite: false, fields: [], notes: '', createdAt: timestamp, updatedAt: timestamp };
const fixtureBytes = Object.fromEntries(['landscape.png', 'two-pages.pdf'].map(name => [name, readFileSync(`tests/fixtures/${name}`).toString('base64')]));

async function boot(page: Page, child = true) {
  const errors: string[] = [];
  const remote: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { const url = new URL(request.url()); if (url.protocol.startsWith('http') && !['127.0.0.1', 'localhost'].includes(url.hostname)) remote.push(request.url()); });
  await page.addInitScript(() => { localStorage.setItem('folio.locale', 'en'); });
  await page.route(/http:\/\/127\.0\.0\.1:1420\/(?:\?view=preview)?$/, async route => {
    const response = await route.fetch();
    const bootstrap = `<script type="module">
      import {mockIPC,mockWindows} from '/node_modules/@tauri-apps/api/mocks.js';
      globalThis.isTauri=true;
      mockWindows(${JSON.stringify(child ? 'attachment-preview' : 'main')});
      const bytes=${JSON.stringify(fixtureBytes)};
      const files=${JSON.stringify(files)};
      const state=globalThis.__previewWindowTest={calls:[],session:{revision:1,id:files[0].id,files,pinned:false},bytes,activeUrls:[],blockReads:false,pendingReads:[]};
      const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
      URL.createObjectURL=value=>{const url=create(value);state.activeUrls.push(url);return url;};
      URL.revokeObjectURL=url=>{state.activeUrls=state.activeUrls.filter(item=>item!==url);revoke(url);};
      mockIPC(async(command,args)=>{
        state.calls.push({command,args});
        if(command==='load_snapshot')return {dataDir:'Synthetic',records:[${JSON.stringify(record)}],attachments:state.session.files};
        if(command==='open_preview_window')return true;
        if(command==='load_preview_session'){
          const snapshot=structuredClone(state.session);
          if(state.blockReads)await new Promise(resolve=>state.pendingReads.push(resolve));
          return snapshot;
        }
        if(command==='set_preview_pinned'){state.session.pinned=args.pinned;return args.pinned;}
        if(command==='read_attachment_preview'){
          const file=state.session.files.find(file=>file.id===args.id);
          if(!file)throw 'PREVIEW_UNAVAILABLE';
          return Uint8Array.from(atob(state.bytes[file.fixture]),char=>char.charCodeAt(0)).buffer;
        }
        if(command==='attachment_path')return state.session.files.find(file=>file.id===args.id).absolutePath;
        if(command==='open_attachment'||command==='reveal_attachment'||command==='plugin:clipboard-manager|write_text'||command.startsWith('plugin:window|'))return;
        throw Error('Unmocked command: '+command);
      },{shouldMockEvents:true});
      await import('/src/main.tsx');
    </script>`;
    const html = (await response.text()).replace(/<script type="module" src="\/src\/main\.tsx"><\/script>/, bootstrap);
    await route.fulfill({ response, body: html });
  });
  await page.goto(child ? '/?view=preview' : '/');
  return { errors, remote };
}

async function signal(page: Page) {
  await page.evaluate(async () => { const { emit } = await import('/node_modules/@tauri-apps/api/event.js'); await emit('folio:preview-session'); });
}

test('native open sends only IDs and leaves the main library usable', async ({ page }) => {
  const observed = await boot(page, false);
  await page.locator('.file-open').filter({ hasText: files[0].fileName }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__previewWindowTest.calls.filter((call: any) => call.command === 'open_preview_window'))).toEqual([{ command: 'open_preview_window', args: { id: files[0].id, ids: files.map(file => file.id) } }]);
  await expect(page.getByRole('dialog', { name: 'Attachment preview' })).toHaveCount(0);
  const search = page.getByRole('textbox', { name: 'Search records, fields, files…', exact: true });
  await search.fill('Window');
  await expect(search).toHaveValue('Window');
  expect(await page.locator('main').evaluate(node => node.inert)).toBe(false);
  expect(await page.evaluate(() => Object.keys(localStorage).some(key => key.includes('preview')))).toBe(false);
  expect(observed.errors).toEqual([]);
  expect(observed.remote).toEqual([]);
});

test('standalone viewer loads scoped metadata, pins, resizes, flips PDF pages, and closes', async ({ page }) => {
  const observed = await boot(page);
  const viewer = page.getByRole('region', { name: 'Attachment preview', exact: true });
  await expect(viewer.locator('.preview-image')).toBeVisible();
  await viewer.getByRole('button', { name: 'Keep on top', exact: true }).click();
  await expect(viewer.getByRole('button', { name: 'Stop keeping on top', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await viewer.getByRole('button', { name: 'Next attachment', exact: true }).click();
  const canvas = viewer.locator('.preview-pdf-canvas');
  await expect(canvas).toHaveAttribute('data-rendered-page', '1');
  await viewer.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-rendered-page', '2');
  await viewer.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(viewer.getByRole('status', { name: 'Zoom', exact: true })).toHaveText('125%');
  await page.setViewportSize({ width: 600, height: 420 });
  for (const button of await viewer.getByRole('button').all()) await expect(button).toBeInViewport();
  await expect(canvas).toHaveAttribute('data-rendered-page', '2');
  await viewer.getByRole('button', { name: 'Stop keeping on top', exact: true }).click();
  await expect(viewer.getByRole('button', { name: 'Keep on top', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await viewer.getByRole('button', { name: 'Close', exact: true }).click();
  const calls = await page.evaluate(() => (window as any).__previewWindowTest.calls);
  expect(calls.filter((call: any) => call.command === 'set_preview_pinned').map((call: any) => call.args)).toEqual([{ pinned: true }, { pinned: false }]);
  expect(calls.some((call: any) => call.command === 'plugin:window|close')).toBe(true);
  expect(calls.some((call: any) => call.command === 'load_snapshot')).toBe(false);
  expect(new URL(page.url()).search).toBe('?view=preview');
  expect(observed.errors).toEqual([]);
  expect(observed.remote).toEqual([]);
});

test('a new request reuses the viewer and refreshes selected scope without storing document metadata', async ({ page }) => {
  const observed = await boot(page);
  const viewer = page.getByRole('region', { name: 'Attachment preview', exact: true });
  await expect(viewer.locator('.preview-image')).toBeVisible();
  await viewer.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.evaluate(() => {
    const state = (window as any).__previewWindowTest;
    state.session = { ...state.session, revision: 2, id: state.session.files[1].id, files: [state.session.files[1]] };
  });
  await signal(page);
  await expect(viewer.locator('.preview-pdf-canvas')).toHaveAttribute('data-rendered-page', '1');
  await expect(viewer.getByRole('status', { name: 'Zoom', exact: true })).toHaveText('100%');
  await expect(viewer.getByRole('button', { name: 'Next attachment', exact: true })).toBeDisabled();
  await expect(viewer.getByRole('button', { name: 'Previous attachment', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => (window as any).__previewWindowTest.activeUrls)).toEqual([]);
  expect(observed.errors).toEqual([]);
});

test('replacement revision reloads the same attachment and deleted scope releases its resources', async ({ page }) => {
  const observed = await boot(page);
  const viewer = page.getByRole('region', { name: 'Attachment preview', exact: true });
  const image = viewer.locator('.preview-image');
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(1200);
  await page.evaluate(() => {
    const state = (window as any).__previewWindowTest;
    state.session.files[0].revision = 'replacement-revision';
    state.bytes['landscape.png'] = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lHcAAAAASUVORK5CYII=';
  });
  await signal(page);
  await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(1);
  await expect.poll(() => page.evaluate(() => (window as any).__previewWindowTest.activeUrls.length)).toBe(1);
  await page.evaluate(() => { (window as any).__previewWindowTest.session.files = []; });
  await signal(page);
  await expect(page.getByRole('alert')).toHaveText('This attachment is no longer available.');
  await expect.poll(() => page.evaluate(() => (window as any).__previewWindowTest.activeUrls.length)).toBe(0);
  expect(observed.errors).toEqual([]);
});

test('standalone preferences follow shared storage in Chinese and dark mode', async ({ page }) => {
  const observed = await boot(page);
  await expect(page.locator('.preview-image')).toBeVisible();
  await page.evaluate(() => {
    localStorage.setItem('folio.locale', 'zh');
    localStorage.setItem('folio.theme', 'dark');
    localStorage.setItem('folio.accent', 'violet');
    window.dispatchEvent(new StorageEvent('storage', { key: 'folio.locale', newValue: 'zh' }));
  });
  const viewer = page.getByRole('region', { name: '附件预览', exact: true });
  await expect(viewer).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'violet');
  await expect(viewer.getByRole('button', { name: '窗口置顶', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => (window as any).__previewWindowTest.calls.some((call: any) => call.command === 'plugin:window|close'))).toBe(true);
  expect(observed.errors).toEqual([]);
  expect(observed.remote).toEqual([]);
});

test('slow metadata polling settles and stale reads cannot undo a successful pin', async ({ page }) => {
  const observed = await boot(page);
  const viewer = page.getByRole('region', { name: 'Attachment preview', exact: true });
  await expect(viewer.locator('.preview-image')).toBeVisible();
  await page.evaluate(() => { (window as any).__previewWindowTest.blockReads = true; });
  await signal(page);
  await expect.poll(() => page.evaluate(() => (window as any).__previewWindowTest.pendingReads.length)).toBe(1);
  await viewer.getByRole('button', { name: 'Keep on top', exact: true }).click();
  await expect(viewer.getByRole('button', { name: 'Stop keeping on top', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => {
    const state = (window as any).__previewWindowTest;
    state.blockReads = false;
    for (const resolve of state.pendingReads.splice(0)) resolve();
  });
  await expect(viewer.getByRole('button', { name: 'Stop keeping on top', exact: true })).toHaveAttribute('aria-pressed', 'true');
  // Let two timer ticks occur during one read, then ensure its changed metadata is still accepted.
  await page.evaluate(() => {
    const state = (window as any).__previewWindowTest;
    state.session.files[0].fileName = 'documents_after_slow_read.png';
    state.blockReads = true;
  });
  await signal(page);
  await expect.poll(() => page.evaluate(() => (window as any).__previewWindowTest.pendingReads.length)).toBe(1);
  await page.clock.install();
  await page.clock.fastForward(4500);
  await page.evaluate(() => {
    const state = (window as any).__previewWindowTest;
    state.blockReads = false;
    state.pendingReads.shift()();
  });
  await expect(viewer.locator('.preview-filename')).toHaveText('documents_after_slow_read.png');
  expect(observed.errors).toEqual([]);
});
