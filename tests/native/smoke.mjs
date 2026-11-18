import { chromium, expect } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { verifyCategories } from './categories.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(directory, '../..');
const output = path.join(repo, 'artifacts/native');
const runDirectory = path.join(output, 'runs', `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`);
await mkdir(runDirectory, { recursive: true });
const executable = path.join(runDirectory, 'folio.exe');
const cliExecutable = path.join(runDirectory, 'folio-cli.exe');
await copyFile(path.join(output, 'target/release/folio.exe'), executable);
await copyFile(path.join(output, 'target/release/folio-cli.exe'), cliExecutable);
const dataDirectory = path.join(runDirectory, 'data');
const results = { status: 'running', executable, cliExecutable, dataDirectory, checks: [], errors: [], consoleErrors: [], blockedRemoteRequests: [], cliCalls: [], nativeStates: [] };
const check = name => { results.checks.push(name); console.log(`PASS ${name}`); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function cli(command, options = [], payload, expectedCode = 0) {
  const args = ['--data-dir', dataDirectory, command, ...options];
  if (payload !== undefined) args.push('--input', '-');
  const response = spawnSync(cliExecutable, args, { encoding: 'utf8', input: payload === undefined ? undefined : JSON.stringify(payload), windowsHide: true });
  results.cliCalls.push({ command, status: response.status });
  assert.equal(response.status, expectedCode, `${command}: ${response.stderr || response.error?.message}`);
  const result = JSON.parse(expectedCode === 0 ? response.stdout : response.stderr);
  assert.equal(result.ok, expectedCode === 0);
  return expectedCode === 0 ? result.data : result.error;
}
const info = await cli('info');
assert.equal(info.libraryExists, false, 'Only a new synthetic vault may be used');
const { version } = JSON.parse(await readFile(path.join(repo, 'package.json'), 'utf8'));
assert.equal(info.version, version, 'Build native smoke binaries from the current checkout');
const schema = await cli('schema');
assert(schema.capabilities.includes('attachments.replace'));
assert(schema.capabilities.includes('categories.read'));
const defaultIds = ['identity', 'education', 'experience', 'research', 'awards', 'skills', 'contacts', 'documents', 'custom'];
assert.deepEqual(schema.record.properties.category.enum, defaultIds);
assert.equal(schema.categoriesRevision, 'builtin-v1');
const recordId = randomUUID();
const secondRecordId = randomUUID();
const secret = 'SYNTHETIC-PRIVATE-REFERENCE';
const contact = {
  id: recordId, category: 'contacts', title: 'Native synthetic contact', subtitle: '', tags: [], favorite: false, notes: '',
  fields: [
    { id: 'public', label: 'Public name', labelZh: '公开名称', value: 'Native synthetic name', kind: 'text', sensitive: false },
    { id: 'reference', label: 'Private reference', labelZh: '私密编号', value: secret, kind: 'text', sensitive: true },
    { id: 'email', label: 'Private email', labelZh: '私密邮箱', value: 'native@example.invalid', kind: 'email', sensitive: true },
  ],
};
await cli('create', [], { ...contact, id: secondRecordId, title: 'Another synthetic record', fields: [contact.fields[0]] });
await cli('validate', [], contact);
await cli('create', [], contact);
const sources = ['landscape.png', 'portrait.jpg', 'two-pages.pdf'].map(name => path.join(repo, 'tests/fixtures', name));
const attachments = (await cli('attach', ['--record-id', recordId], sources)).attachments;
const png = attachments.find(file => file.originalName === 'landscape.png');
const jpg = attachments.find(file => file.originalName === 'portrait.jpg');
const pdf = attachments.find(file => file.originalName === 'two-pages.pdf');

const port = await new Promise((resolve, reject) => {
  const server = createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => { const selected = server.address().port; server.close(() => resolve(selected)); });
});
const child = spawn(executable, [], {
  cwd: runDirectory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: path.join(runDirectory, 'webview-data'), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows` },
});
let processOutput = '';
child.stdout.on('data', value => { processOutput += value; });
child.stderr.on('data', value => { processOutput += value; });
child.on('error', error => { processOutput += String(error); });
function osWindows(action = 'list', handle, size) {
  assert(Number.isInteger(child.pid) && child.pid > 0);
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(directory, 'window-state.ps1'), '-ApplicationProcessId', String(child.pid), '-Action', action];
  if (handle !== undefined) args.push('-WindowHandle', String(handle));
  if (size) args.push('-Width', String(size.width), '-Height', String(size.height));
  const response = spawnSync('powershell.exe', args, { encoding: 'utf8', windowsHide: true });
  assert.equal(response.status, 0, response.stderr || response.error?.message);
  return JSON.parse(response.stdout.trim());
}
let browser;
let main;
let preview;
let context;
let mainHandle;
let previewHandle;
const observed = new WeakSet();
function observe(page) {
  if (observed.has(page)) return;
  observed.add(page);
  page.on('pageerror', error => results.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') results.consoleErrors.push(message.text()); });
}
async function invoke(page, command, args = {}) {
  return page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
}
async function focusPreview() {
  osWindows('activate', previewHandle);
  await invoke(main, 'plugin:event|emit_to', { target: { kind: 'AnyLabel', label: 'attachment-preview' }, event: 'tauri://focus', payload: true });
  await preview.evaluate(() => window.dispatchEvent(new Event('focus')));
}
async function nativeState() {
  const state = osWindows().find(window => window.handle === previewHandle);
  assert(state, 'Native preview HWND disappeared');
  const queries = await Promise.all([
    invoke(main, 'plugin:window|is_minimized', { label: 'attachment-preview' }),
    invoke(main, 'plugin:window|is_maximized', { label: 'attachment-preview' }),
    invoke(main, 'plugin:window|is_always_on_top', { label: 'attachment-preview' }),
  ]);
  assert.deepEqual(queries, [state.minimized, state.maximized, state.alwaysOnTop]);
  results.nativeStates.push(state);
  return state;
}
async function discoverPreview() {
  await expect.poll(() => context.pages().filter(page => !page.isClosed() && new URL(page.url()).searchParams.get('view') === 'preview').length, { timeout: 15000 }).toBe(1);
  preview = context.pages().find(page => !page.isClosed() && new URL(page.url()).searchParams.get('view') === 'preview');
  observe(preview);
  await expect(preview.getByRole('region', { name: 'Attachment preview', exact: true })).toBeVisible();
  await expect.poll(() => osWindows().filter(window => window.handle !== mainHandle && window.width >= 600 && window.height >= 420).length).toBe(1);
  previewHandle = osWindows().find(window => window.handle !== mainHandle && window.width >= 600 && window.height >= 420).handle;
  assert.equal(new URL(preview.url()).search, '?view=preview');
  return preview;
}
const openFile = file => main.locator('.file-open').filter({ hasText: file.fileName }).click();
const imageSize = () => preview.locator('img.preview-image').evaluate(node => [node.naturalWidth, node.naturalHeight]);
const imageWidth = async () => (await preview.locator('img.preview-image').boundingBox()).width;
async function resizePreview(width, height) {
  const scale = await preview.evaluate(() => devicePixelRatio);
  osWindows('resize', previewHandle, { width: Math.round(width * scale), height: Math.round(height * scale) });
  const native = osWindows().find(window => window.handle === previewHandle);
  await expect.poll(() => preview.evaluate(({ width, height }) => Math.max(Math.abs(innerWidth * devicePixelRatio - width), Math.abs(innerHeight * devicePixelRatio - height)), { width: native.clientWidth, height: native.clientHeight })).toBeLessThanOrEqual(2);
  await preview.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function selectInPreview(file) {
  const session = await invoke(preview, 'load_preview_session');
  const targetIndex = session.files.findIndex(item => item.id === file.id);
  assert(targetIndex >= 0);
  for (let attempt = 0; attempt <= session.files.length; attempt++) {
    const name = await preview.locator('.preview-filename strong').innerText();
    const currentIndex = session.files.findIndex(item => item.fileName === name);
    if (currentIndex === targetIndex) return;
    await preview.getByRole('button', { name: currentIndex < targetIndex ? 'Next attachment' : 'Previous attachment', exact: true }).click();
  }
  throw new Error(`Could not switch preview to ${file.fileName}`);
}

try {
  let endpoint;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null) throw new Error(`Folio exited early: ${processOutput}`);
    try { const response = await fetch(`http://127.0.0.1:${port}/json/version`); if (response.ok) { endpoint = await response.json(); break; } } catch {}
    await pause(250);
  }
  assert(endpoint?.webSocketDebuggerUrl, `WebView2 CDP unavailable: ${processOutput}`);
  browser = await chromium.connectOverCDP(endpoint.webSocketDebuggerUrl);
  context = browser.contexts()[0];
  context.on('page', observe);
  await context.route('**/*', route => {
    const url = route.request().url();
    if (/^https?:/.test(url) && !/^https?:\/\/(?:tauri|ipc)\.localhost(?:[:/]|$)/.test(url)) {
      results.blockedRemoteRequests.push(url);
      return route.abort();
    }
    return route.continue();
  });
  await expect.poll(() => context.pages().some(page => /tauri\.localhost|tauri:\/\//.test(page.url()))).toBe(true);
  main = context.pages().find(page => /tauri\.localhost|tauri:\/\//.test(page.url()));
  observe(main);
  await main.waitForFunction(() => typeof window.__TAURI_INTERNALS__?.invoke === 'function');
  const loaded = await invoke(main, 'load_snapshot');
  assert.equal(path.resolve(loaded.dataDir).toLowerCase(), dataDirectory.toLowerCase());
  assert.deepEqual(new Set(loaded.records.map(record => record.id)), new Set([recordId, secondRecordId]));
  mainHandle = osWindows().find(window => window.title === 'Folio native smoke')?.handle;
  assert(mainHandle, 'The unique test main window must exist');
  assert.equal(osWindows().find(window => window.handle === mainHandle).visible, false);
  assert.notEqual(await main.evaluate(() => localStorage.getItem('folio.hideSensitiveFields')), 'false');
  await main.evaluate(() => localStorage.setItem('folio.locale', 'en'));
  await main.reload();
  await expect(main.getByRole('heading', { name: contact.title, exact: true })).toBeVisible();
  const secretRow = main.locator('.field-row[data-field-id="reference"]');
  await expect(secretRow.locator('.field-value')).toHaveText('••••••••••••');
  await main.getByRole('button', { name: 'Show sensitive fields', exact: true }).click();
  await expect(secretRow.locator('.field-value')).toHaveText(secret);
  await expect(main.getByRole('button', { name: 'Hide sensitive fields', exact: true })).toBeVisible();
  await main.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = main.getByRole('dialog', { name: 'Settings', exact: true });
  await expect(settings.getByRole('switch', { name: 'Hide sensitive fields', exact: true })).toBeChecked();
  await settings.getByRole('switch', { name: 'Hide sensitive fields', exact: true }).click();
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  await main.reload();
  await expect(secretRow.locator('.field-value')).toHaveText(secret);
  await expect(main.getByRole('button', { name: /^(Show sensitive fields|Hide sensitive fields|Show value|Hide value)$/ })).toHaveCount(0);
  await main.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(settings.getByRole('switch', { name: 'Hide sensitive fields', exact: true })).not.toBeChecked();
  await settings.getByRole('switch', { name: 'Hide sensitive fields', exact: true }).click();
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(secretRow.locator('.field-value')).toHaveText('••••••••••••');
  await main.screenshot({ path: path.join(runDirectory, 'native-sensitive.png') });
  check('Real WebView2 defaults to masking, reveals the record, persists the setting, and resets masking');

  await openFile(png);
  await discoverPreview();
  const originalPreview = preview;
  const originalHandle = previewHandle;
  await expect.poll(imageSize, { timeout: 15000 }).toEqual([1200, 900]);
  await expect(preview.getByRole('button', { name: /^(Close|关闭)$/ })).toHaveCount(0);
  await expect(preview.locator('.preview-close, .tool-divider')).toHaveCount(0);
  await expect(main.getByRole('dialog', { name: 'Attachment preview', exact: true })).toHaveCount(0);
  await main.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(settings).toBeVisible();
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  await main.getByRole('textbox', { name: 'Search records, fields, files…' }).fill('synthetic');
  await expect(main.locator('.record-card')).toHaveCount(2);
  await main.getByRole('textbox', { name: 'Search records, fields, files…' }).fill('');
  check('Actual native child preview opens while the main library remains interactive');

  await verifyCategories({ main, preview, cli, invoke, osWindows, mainHandle, recordId, contact, repo, runDirectory, focusPreview, check });

  assert.equal((await nativeState()).alwaysOnTop, false);
  await preview.getByRole('button', { name: 'Keep on top', exact: true }).click();
  await expect(preview.getByRole('button', { name: 'Stop keeping on top', exact: true })).toHaveAttribute('aria-pressed', 'true');
  assert.equal((await nativeState()).alwaysOnTop, true);
  assert.equal((await invoke(preview, 'load_preview_session')).pinned, true);
  await preview.getByRole('button', { name: 'Stop keeping on top', exact: true }).click();
  assert.equal((await nativeState()).alwaysOnTop, false);
  check('Pin and unpin match both the Rust window query and the Win32 topmost flag');

  osWindows('minimize', previewHandle);
  await expect.poll(async () => (await nativeState()).minimized).toBe(true);
  await openFile(pdf);
  await expect.poll(async () => (await nativeState()).minimized).toBe(false);
  assert.equal(preview, originalPreview);
  assert.equal(osWindows().find(window => window.handle === originalHandle)?.handle, originalHandle);
  await expect(preview.locator('.preview-filename strong')).toHaveText(pdf.fileName);
  assert.equal(context.pages().filter(page => !page.isClosed() && new URL(page.url()).searchParams.get('view') === 'preview').length, 1);
  osWindows('maximize', previewHandle);
  await expect.poll(async () => (await nativeState()).maximized).toBe(true);
  osWindows('restore', previewHandle);
  await expect.poll(async () => (await nativeState()).maximized).toBe(false);
  check('Native minimize/maximize/restore work and another open reuses and restores the same child');

  await selectInPreview(png);
  await expect.poll(imageSize).toEqual([1200, 900]);
  await resizePreview(1150, 900);
  const wideImage = await imageWidth();
  const wideViewport = await preview.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  await resizePreview(700, 900);
  await expect.poll(() => preview.evaluate(() => window.innerWidth)).toBeLessThan(wideViewport.width);
  await expect.poll(imageWidth).toBeLessThan(wideImage - 10);
  const narrowImage = await imageWidth();
  const tallViewport = await preview.evaluate(() => innerHeight);
  await resizePreview(700, 500);
  await expect.poll(() => preview.evaluate(() => innerHeight)).toBeLessThan(tallViewport);
  await expect.poll(imageWidth).toBeLessThan(narrowImage - 10);
  await resizePreview(1000, 760);
  const fittedImage = await imageWidth();
  await preview.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect.poll(imageWidth).toBeGreaterThan(fittedImage);
  await preview.getByRole('button', { name: 'Fit to view', exact: true }).click();
  await expect.poll(async () => Math.abs(await imageWidth() - fittedImage)).toBeLessThan(1);
  await preview.screenshot({ path: path.join(runDirectory, 'native-child-image.png') });
  check('Actual native width and height changes recalculate image fit, zoom, and reset');

  await selectInPreview(jpg);
  await expect.poll(imageSize).toEqual([900, 1200]);
  await selectInPreview(pdf);
  const canvas = preview.locator('canvas.preview-pdf-canvas');
  await expect(canvas).toHaveAttribute('data-rendered-page', '1', { timeout: 20000 });
  await expect(preview.getByRole('button', { name: /^(Close|关闭)$/ })).toHaveCount(0);
  const firstPage = await canvas.evaluate(node => node.toDataURL());
  await expect(preview.getByRole('spinbutton', { name: 'Page number', exact: true })).toHaveAttribute('max', '2');
  await preview.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-rendered-page', '2');
  assert.notEqual(await canvas.evaluate(node => node.toDataURL()), firstPage);
  const fittedCanvas = (await canvas.boundingBox()).width;
  await preview.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect.poll(async () => (await canvas.boundingBox()).width).toBeGreaterThan(fittedCanvas);
  await preview.getByRole('button', { name: 'Fit to view', exact: true }).click();
  await expect.poll(async () => Math.abs((await canvas.boundingBox()).width - fittedCanvas)).toBeLessThan(1);
  await preview.getByRole('button', { name: 'Previous page', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-rendered-page', '1');
  await preview.screenshot({ path: path.join(runDirectory, 'native-child-pdf.png') });
  await resizePreview(660, 500);
  await expect(preview.locator('.preview-viewport')).toHaveAttribute('aria-busy', 'false');
  await expect(preview.getByRole('button', { name: 'Next page', exact: true })).toBeInViewport();
  assert.equal(await preview.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await preview.screenshot({ path: path.join(runDirectory, 'native-child-pdf-compact.png') });
  await resizePreview(1000, 760);
  await expect(preview.locator('.preview-viewport')).toHaveAttribute('aria-busy', 'false');
  check('Child attachment navigation, packaged PDF worker, distinct pages, paging and zoom work');

  for (const locale of ['en', 'zh']) {
    if (locale === 'zh') await main.locator('.locale-toggle').click();
    const labels = locale === 'en'
      ? { rename: 'Rename', fileName: 'File name', save: 'Save changes', cancel: 'Cancel', conflict: /attachment changed elsewhere/i }
      : { rename: '重命名', fileName: '文件名', save: '保存更改', cancel: '取消', conflict: /此附件已在其他地方更新/ };
    await main.locator('.attachment-row').filter({ has: main.locator('.file-open').filter({ hasText: png.fileName }) }).getByRole('button', { name: labels.rename, exact: true }).click();
    const rename = main.getByRole('dialog', { name: labels.rename, exact: true });
    const proposal = `desktop-proposal-${locale}`;
    await rename.getByLabel(labels.fileName, { exact: true }).fill(proposal);
    const before = (await cli('get', ['--id', recordId])).attachments.find(file => file.id === png.id);
    await cli('attachment-rename', ['--record-id', recordId, '--attachment-id', before.id, '--expected-revision', before.revision], { name: `external-native-${locale}` });
    const externallyRenamed = (await cli('get', ['--id', recordId])).attachments.find(file => file.id === png.id);
    await rename.getByRole('button', { name: labels.save, exact: true }).click();
    await expect(main.getByRole('alert')).toContainText(labels.conflict);
    await expect(main.getByRole('alert')).not.toContainText('ATTACHMENT_CONFLICT');
    await expect(rename.getByLabel(labels.fileName, { exact: true })).toHaveValue(proposal);
    await assert.rejects(() => invoke(main, 'remove_attachment', { id: before.id, expectedRevision: before.revision }), /ATTACHMENT_CONFLICT/);
    const after = (await cli('get', ['--id', recordId])).attachments.find(file => file.id === png.id);
    assert.equal(after.fileName, externallyRenamed.fileName);
    assert.equal(after.revision, externallyRenamed.revision);
    await main.screenshot({ path: path.join(runDirectory, `native-attachment-conflict-${locale}.png`) });
    await rename.getByRole('button', { name: labels.cancel, exact: true }).click();
    Object.assign(png, after);
    check(`Native ${locale} rename keeps its proposal and stale rename/removal preserve the CLI attachment revision`);
  }
  await main.locator('.locale-toggle').click();
  await focusPreview();
  await expect(preview.getByRole('region', { name: 'Attachment preview', exact: true })).toBeVisible();

  await selectInPreview(png);
  const current = (await cli('get', ['--id', recordId])).attachments.find(file => file.id === png.id);
  await cli('attachment-replace', ['--record-id', recordId, '--attachment-id', current.id, '--expected-revision', current.revision], { path: sources[1] });
  await focusPreview();
  await expect.poll(imageSize).toEqual([900, 1200]);
  const replaced = (await cli('get', ['--id', recordId])).attachments.find(file => file.id === png.id);
  assert.notEqual(replaced.revision, current.revision);
  await expect(preview.locator('.preview-filename strong')).toHaveText(replaced.fileName);
  await cli('attachment-delete', ['--record-id', recordId, '--attachment-id', replaced.id, '--expected-revision', replaced.revision]);
  await focusPreview();
  await expect(preview.locator('.preview-filename strong')).not.toHaveText(replaced.fileName);
  await expect(preview.locator('.preview-position')).toHaveText(/\/ 2$/);
  assert.equal((await invoke(preview, 'load_preview_session')).files.some(file => file.id === replaced.id), false);
  await preview.screenshot({ path: path.join(runDirectory, 'native-child-after-cli.png') });
  check('CLI replacement reloads bytes for the same attachment ID and deletion removes it from the open child');

  osWindows('close', previewHandle);
  await expect.poll(() => originalPreview.isClosed()).toBe(true);
  await invoke(main, 'plugin:event|emit', { event: 'tauri://focus', payload: true });
  await expect(main.locator('.file-open')).toHaveCount(2);
  await openFile(pdf);
  await discoverPreview();
  await expect(preview.locator('canvas.preview-pdf-canvas')).toHaveAttribute('data-rendered-page', '1', { timeout: 20000 });
  assert.equal((await nativeState()).alwaysOnTop, false);
  check('Closing and reopening creates a healthy fresh child with pin state reset');

  const remaining = (await cli('get', ['--id', recordId])).attachments;
  for (const attachment of remaining) await cli('attachment-delete', ['--record-id', recordId, '--attachment-id', attachment.id, '--expected-revision', attachment.revision]);
  await focusPreview();
  await expect(preview.getByRole('alert')).toHaveText('This attachment is no longer available.');
  await expect(preview.getByRole('button', { name: /^(Close|关闭)$/ })).toHaveCount(0);
  check('Native image, PDF and empty states have no internal Close button; native OS closing remains available');

  osWindows('close', mainHandle);
  await expect.poll(() => child.exitCode, { timeout: 15000 }).not.toBe(null);
  assert.equal(osWindows().length, 0, 'Closing main must remove its preview and all test windows');
  check('Closing the main native window cleans up the child and exits the test process');
  assert.equal(results.errors.length, 0, `Page errors: ${results.errors}`);
  assert.equal(results.blockedRemoteRequests.length, 0, `Unexpected remote requests: ${results.blockedRemoteRequests}`);
  assert(!results.consoleErrors.some(value => /content security policy|refused to|csp/i.test(value)), `CSP errors: ${results.consoleErrors}`);
  results.status = 'passed';
} catch (error) {
  results.status = 'failed';
  results.failure = error.stack || String(error);
  console.error(results.failure);
  await main?.screenshot({ path: path.join(runDirectory, 'failure-main.png') }).catch(() => {});
  await preview?.screenshot({ path: path.join(runDirectory, 'failure-preview.png') }).catch(() => {});
  process.exitCode = 1;
} finally {
  results.processOutput = processOutput;
  await writeFile(path.join(runDirectory, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
  await writeFile(path.join(output, 'latest-results.json'), `${JSON.stringify({ runDirectory, ...results }, null, 2)}\n`);
  await browser?.close().catch(() => {});
  if (child.exitCode === null) child.kill();
  console.log(`Native integration results: ${path.join(runDirectory, 'results.json')}`);
}
