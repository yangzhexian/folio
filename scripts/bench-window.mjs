import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { preview } from 'vite';

const builds = process.argv.slice(2);
if (builds.length !== 2) throw new Error('Usage: node scripts/bench-window.mjs <baseline-dist> <candidate-dist>');
const samples = Number(process.env.FOLIO_BENCH_SAMPLES || 5);
if (!Number.isInteger(samples) || samples < 3) throw new Error('Use at least three samples.');
const mocks = await readFile(new URL('../node_modules/@tauri-apps/api/mocks.js', import.meta.url), 'utf8');
const sizes = (process.env.FOLIO_BENCH_SIZES || '100,1000,10000').split(',').map(Number);
if (sizes.some(size => !Number.isInteger(size) || size < 2)) throw new Error('Fixture sizes must be integers of at least two records.');

function fixture(size) {
  const date = '2026-01-01T00:00:00.000Z';
  const records = Array.from({ length: size }, (_, index) => {
    const id = String(index).padStart(6, '0');
    return { id, title: 'Sample ' + id, category: 'contacts', subtitle: '', favorite: false, tags: [], notes: '',
      fields: [{ id: 'contact', label: 'Email', labelZh: '邮箱', kind: 'email', sensitive: false, value: 'sample' + id + '@example.invalid' }], createdAt: date, updatedAt: date };
  });
  const attachments = records.map(record => {
    const name = 'contacts_' + record.id + '.png';
    return { id: 'file-' + record.id, recordId: record.id, originalName: name, fileName: name, relativePath: name, absolutePath: '/synthetic/' + name, createdAt: date, size: 64 };
  });
  return { records, attachments, dataDir: '/synthetic' };
}

async function measure(browser, origin, size) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  try {
    const page = await context.newPage();
    const session = await context.newCDPSession(page);
    await session.send('Performance.enable');
    async function heapMiB() {
      const { metrics } = await session.send('Performance.getMetrics');
      return metrics.find(metric => metric.name === 'JSHeapUsedSize').value / 1048576;
    }
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.route('**/__folio_mocks.js', route => route.fulfill({ contentType: 'text/javascript', body: mocks }));
    await page.route(origin + '/', async route => {
      const response = await route.fetch();
      const html = await response.text();
      // Start the normal release bundle after the public Tauri mock has supplied the snapshot.
      const entry = /<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/;
      assert.match(html, entry);
      const body = html.replace(entry, (_, source) => `<script type="module">
        import { mockIPC, mockWindows } from '/__folio_mocks.js';
        globalThis.isTauri = true;
        mockWindows('main');
        const snapshot = (${fixture.toString()})(${size});
        mockIPC(command => command === 'load_snapshot' ? snapshot : undefined, {shouldMockEvents:true});
        await import(${JSON.stringify(source)});
        const frame = () => new Promise(requestAnimationFrame);
        while (!document.querySelector('.record-card')) await frame();
        await frame(); await frame();
        window.__folioReady = performance.now();
      </script>`);
      await route.fulfill({ response, body });
    });
    await page.goto(origin);
    await page.waitForFunction(() => window.__folioReady > 0, null, { timeout: 90000 });
    const atReady = await heapMiB();
    const result = await page.evaluate(async () => {
      const input = document.querySelector('.search-box input');
      const frame = () => new Promise(requestAnimationFrame);
      const start = performance.now();
      // Use the native setter so React observes the same input event as normal typing.
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'sample000001@example.invalid');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const deadline = start + 30000;
      while (document.querySelectorAll('.record-card').length !== 1) {
        if (performance.now() > deadline) throw new Error('Search did not narrow to one record.');
        await frame();
      }
      await frame(); await frame();
      return { readyMs: window.__folioReady, searchMs: performance.now() - start, match: document.querySelector('.record-card').textContent };
    });
    assert.match(result.match, /Sample 000001/);
    assert.deepEqual(errors, []);
    return { ...result, sampledHeapMiB: Math.max(atReady, await heapMiB()) };
  } finally { await context.close(); }
}

function summarize(rows, key) {
  const values = rows.map(row => row[key]).sort((a, b) => a - b);
  return Object.fromEntries([['p50', 0.5], ['p95', 0.95]].map(([label, q]) => [label, Math.round(values[Math.ceil(q * values.length) - 1])]));
}

const servers = [];
let browser;
try {
  for (const dir of builds) servers.push(await preview({ configFile: false, build: { outDir: path.resolve(dir) }, preview: { host: '127.0.0.1', port: 0 } }));
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
  for (const size of sizes) {
    const rows = [[], []];
    for (let pass = 0; pass < samples; pass++) {
      for (const index of pass % 2 ? [1, 0] : [0, 1]) {
        const { port } = servers[index].httpServer.address();
        rows[index].push(await measure(browser, 'http://127.0.0.1:' + port, size));
      }
    }
    for (const [i, name] of ['baseline', 'candidate'].entries()) {
      console.log(JSON.stringify({ size, build: name, samples, readyMs: summarize(rows[i], 'readyMs'), searchMs: summarize(rows[i], 'searchMs'), sampledHeapMiB: summarize(rows[i], 'sampledHeapMiB') }));
    }
  }
} finally {
  await browser?.close();
  for (const server of servers) await server.close();
}
