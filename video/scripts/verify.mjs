import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const directory = path.join(root, 'docs/media');
const contentTypes = { '.html': 'text/html', '.mp4': 'video/mp4', '.vtt': 'text/vtt', '.png': 'image/png', '.gif': 'image/gif' };
const server = createServer(async (request, response) => {
  const fileName = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/^\//, '') || 'index.html';
  const file = path.resolve(directory, fileName);
  if (!file.startsWith(directory + path.sep)) { response.writeHead(403).end(); return; }
  try {
    const size = statSync(file).size;
    const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? '');
    response.setHeader('Content-Type', contentTypes[path.extname(file)] ?? 'application/octet-stream');
    response.setHeader('Accept-Ranges', 'bytes');
    if (range) {
      const start = Number(range[1]); const end = Math.min(size - 1, range[2] ? Number(range[2]) : size - 1);
      response.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
      createReadStream(file, { start, end }).pipe(response);
    } else { response.writeHead(200, { 'Content-Length': size }); createReadStream(file).pipe(response); }
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  const expected = JSON.parse(await readFile(path.join(root, 'video/public/session/manifest.json'))).duration + 7;
  await page.waitForFunction(() => document.querySelector('video').readyState >= 2);
  const metadata = await page.locator('video').evaluate(video => ({ width: video.videoWidth, height: video.videoHeight, duration: video.duration }));
  if (metadata.width !== 2560 || metadata.height !== 1440 || Math.abs(metadata.duration - expected) > .1) throw new Error(`Unexpected browser metadata: ${JSON.stringify(metadata)}`);
  await page.locator('video').evaluate(async video => { video.muted = true; video.textTracks[0].mode = 'showing'; await video.play(); });
  await page.waitForFunction(() => document.querySelector('video').currentTime > 1);
  await page.locator('video').evaluate(video => video.pause());
  const chapters = [6, 15, 24, 33, 42, 51, 55, 59];
  for (const time of chapters) {
    await page.locator('video').evaluate((video, target) => new Promise(resolve => { video.addEventListener('seeked', resolve, { once: true }); video.currentTime = target; }), time);
    await page.waitForFunction(() => document.querySelector('video').readyState >= 2 && !document.querySelector('video').seeking);
  }
  const captions = await page.locator('video').evaluate(video => video.textTracks[0].cues.length);
  if (captions !== 10 || errors.length) throw new Error(JSON.stringify({ captions, errors }));
  const report = { ...metadata, captions, checkedSeekSeconds: chapters, playbackAdvanced: true, errors };
  await mkdir(path.join(root, 'artifacts/video-check'), { recursive: true });
  await writeFile(path.join(root, 'artifacts/video-check/browser-playback.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await browser?.close(); server.close(); }
