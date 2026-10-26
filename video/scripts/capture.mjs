import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Record one real frontend session. Only the native storage boundary is mocked.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.join(root, 'video/public/session');
const framesDir = path.join(root, 'artifacts/video-session-capture');
const origin = process.env.FOLIO_CAPTURE_URL ?? 'http://127.0.0.1:1420';
const viewport = { width: 1920, height: 1200 };
const uiScale = 4 / 3;
const timestamp = '2026-10-26T09:00:00.000Z';
const identityId = '00000000-0000-4000-8000-000000000101';
const field = (id, label, labelZh, value, kind = 'text', sensitive = false) => ({ id, label, labelZh, value, kind, sensitive });
const record = (id, category, title, subtitle, fields, favorite = false) => ({ id, category, title, subtitle, fields, favorite, tags: [], notes: '', createdAt: timestamp, updatedAt: timestamp });
const attachment = (id, fileName, size) => ({ id, recordId: identityId, originalName: fileName, fileName, size, createdAt: timestamp, relativePath: `attachments/${identityId}/${fileName}`, absolutePath: `C:\\Folio\\data\\attachments\\${identityId}\\${fileName}` });
const snapshot = { dataDir: 'C:\\Folio\\data', records: [
  record(identityId, 'identity', 'Personal details', 'Alex Chen, the essentials at hand', [field('full-name', 'Full name', '姓名', 'Alex Chen'), field('email', 'Email', '邮箱', 'alex.chen@example.com', 'email'), field('qq', 'QQ number', 'QQ号', '1000000000'), field('city', 'Current city', '现居城市', 'Shanghai, China'), field('document', 'Document number', '证件号码', 'DEMO-000000', 'text', true)], true),
  record('00000000-0000-4000-8000-000000000102', 'education', 'MSc: Computer Science', 'Example University, 2023-2026', [field('degree', 'Degree', '学位', 'Master of Science')]),
  record('00000000-0000-4000-8000-000000000103', 'experience', 'Work experience', 'Product design, Example Studio', [field('role', 'Role', '职位', 'Product designer')]),
  record('00000000-0000-4000-8000-000000000104', 'research', 'Research portfolio', 'Projects, publications, and ideas', [field('area', 'Research area', '研究方向', 'Human-computer interaction')]),
  record('00000000-0000-4000-8000-000000000105', 'skills', 'Skills and certificates', 'Qualifications ready when you need them', [field('certificate', 'Certificate', '证书', 'English proficiency')]),
], attachments: [] };

function syntheticPdf() {
  const content = (page) => {
    let stream = '0.95 0.96 0.93 rg 0 0 612 792 re f 0.22 0.36 0.28 rg 0 680 612 112 re f\n';
    const line = (text, x, y, size, white = false) => { stream += `${white ? '1 1 1' : '0.15 0.23 0.19'} rg BT /F1 ${size} Tf ${x} ${y} Td (${text}) Tj ET\n`; };
    line('EXAMPLE UNIVERSITY', 48, 733, 20, true);
    line(page === 1 ? 'Certificate of completion' : 'Academic transcript', 48, 700, 15, true);
    line('Alex Chen', 48, 605, 38);
    line(page === 1 ? 'Master of Science' : 'Course summary', 48, 550, 24);
    line('Computer Science, Class of 2026', 48, 512, 16);
    if (page === 1) { line('Completed on 15 July 2026', 48, 440, 16); line('Awarded for curiosity, craft, and persistence.', 48, 390, 15); }
    else ['Human-Computer Interaction             A', 'Data Systems                                   A', 'Research Methods                            A-', 'Design Studio                                  A', 'Final Thesis                                     A'].forEach((text, i) => line(text, 48, 444 - i * 43, 16));
    line('FICTIONAL DOCUMENT FOR FOLIO DEMONSTRATION', 48, 80, 9);
    line(`Page ${page} of 2`, 48, 55, 10);
    return stream;
  };
  const a = content(1); const b = content(2);
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(a)} >>\nstream\n${a}endstream`, `<< /Length ${Buffer.byteLength(b)} >>\nstream\n${b}endstream`];
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 8\n0000000000 65535 f \n${offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n ').join('\n')}\ntrailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

let vite; let browser; let serverLog = '';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function ready() { try { return (await fetch(origin, { signal: AbortSignal.timeout(1200) })).ok; } catch { return false; } }
try {
  await mkdir(output, { recursive: true }); await mkdir(framesDir, { recursive: true });
  if (!(await ready())) {
    if (process.env.FOLIO_CAPTURE_URL) throw new Error('FOLIO_CAPTURE_URL is unavailable.');
    vite = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '1420', '--strictPort'], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    vite.stdout.on('data', c => { serverLog += c; }); vite.stderr.on('data', c => { serverLog += c; });
    for (let i = 0; i < 60 && !(await ready()); i++) { if (vite.exitCode !== null) throw new Error(serverLog); await wait(250); }
    if (!(await ready())) throw new Error(serverLog);
  }
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true });
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'Asia/Shanghai' });
  const art = await context.newPage();
  await art.setViewportSize({ width: 1200, height: 800 });
  await art.setContent('<html><body style="margin:0;background:#dfe8d8;padding:70px;font-family:Segoe UI;color:#244536"><div style="background:#f9faf5;padding:64px;border-radius:30px;height:530px;box-sizing:border-box"><div style="font-size:22px;letter-spacing:5px">FOLIO / CONTACT CARD</div><h1 style="font-size:76px;margin:32px 0 20px">Alex Chen</h1><p style="font-size:26px">alex.chen@example.com</p><p style="font-size:26px">Shanghai, China</p><p style="font-size:22px;margin-top:36px">Design. Research. Everyday details.</p><p style="font-size:12px;margin-top:40px;color:#6a806e">FICTIONAL EXAMPLE FOR FOLIO PRODUCT DEMONSTRATION</p></div></body></html>');
  const png = await art.screenshot({ path: path.join(output, 'contact-card.png') }); await art.close();
  const pdf = syntheticPdf(); await writeFile(path.join(output, 'certificate.pdf'), pdf);
  snapshot.attachments = [attachment('card', 'identity_contact-card.png', png.length), attachment('certificate', 'identity_a72b416e5a89.pdf', pdf.length)];
  const page = await context.newPage(); const errors = []; const remoteRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url()) && !request.url().startsWith(origin)) remoteRequests.push(request.url()); });
  await page.addInitScript(() => { localStorage.setItem('folio.locale', 'en'); localStorage.setItem('folio.theme', 'light'); localStorage.setItem('folio.accent', 'sage'); });
  await page.route(`${origin}/`, async route => {
    const response = await route.fetch(); const html = await response.text();
    const bootstrap = `import { mockIPC, mockWindows } from '/node_modules/@tauri-apps/api/mocks.js'; globalThis.isTauri = true; mockWindows('main'); const snapshot = ${JSON.stringify(snapshot)}; const fixtures = ${JSON.stringify({ card: png.toString('base64'), certificate: pdf.toString('base64') })}; globalThis.__captureSnapshot = snapshot; mockIPC(async (command, args) => {
      if (command === 'load_snapshot') return structuredClone(snapshot);
      if (command === 'save_record') { const saved = {...args.record, updatedAt: '${timestamp}'}; snapshot.records = snapshot.records.map(record => record.id === saved.id ? saved : record); return structuredClone(saved); }
      if (command === 'read_attachment_preview') return Uint8Array.from(atob(fixtures[args.id]), c => c.charCodeAt(0)).buffer;
      if (command === 'rename_attachment') { const file = snapshot.attachments.find(file => file.id === args.id); file.fileName = 'identity_' + args.name + '.pdf'; file.relativePath = 'attachments/' + file.recordId + '/' + file.fileName; file.absolutePath = 'C:/Folio/data/' + file.relativePath; return structuredClone(file); }
      if (command === 'attachment_path') return snapshot.attachments.find(file => file.id === args.id)?.absolutePath;
      if (command === 'plugin:clipboard-manager|write_text' || command.startsWith('plugin:window|')) return;
      throw new Error('Capture refuses unsupported IPC: ' + command);
    }, {shouldMockEvents: true}); await import('/src/main.tsx');`;
    const entry = /<script type="module" src="\/src\/main\.tsx(?:\?[^\"]*)?"><\/script>/;
    if (!entry.test(html)) throw new Error('Expected Folio Vite frontend.');
    await route.fulfill({ response, body: html.replace(entry, () => `<script type="module">${bootstrap}</script>`) });
  });
  await page.goto(origin); await page.getByRole('heading', { name: 'Personal details', exact: true }).waitFor();
  await page.addStyleTag({ content: `html { zoom: ${uiScale}; } .app-shell { height: 900px; } .modal { max-height: 850px; } .attachment-preview { height: 856px; } * { caret-color: transparent !important; } #tour-cursor { position: fixed; left: 0; top: 0; width: 26px; height: 32px; z-index: 999999; pointer-events: none; transform: translate(1050px, 800px); transition: transform 600ms cubic-bezier(.25,.8,.25,1); filter: drop-shadow(0 2px 2px #0004); } #tour-cursor::after { content: ''; position: absolute; left: -14px; top: -14px; width: 34px; height: 34px; border: 3px solid #648353; border-radius: 50%; opacity: 0; } #tour-cursor.clicked::after { animation: tour-click 550ms ease-out; } @keyframes tour-click { from { transform: scale(.3); opacity: .9; } to { transform: scale(1.6); opacity: 0; } }` });
  await page.evaluate(scale => { const cursor = document.createElement('div'); cursor.id = 'tour-cursor'; cursor.innerHTML = '<svg viewBox="0 0 26 32"><path d="M3 2L22 19L13 20L9 29Z" fill="white" stroke="#203d32" stroke-width="2" stroke-linejoin="round"/></svg>'; document.body.append(cursor); document.addEventListener('pointermove', e => { cursor.style.transform = `translate(${e.clientX / scale}px, ${e.clientY / scale}px)`; }, true); document.addEventListener('pointerdown', () => { cursor.classList.remove('clicked'); void cursor.offsetWidth; cursor.classList.add('clicked'); }, true); }, uiScale);
  await page.evaluate(() => document.fonts.ready); await wait(500);
  await page.screenshot({ path: path.join(output, 'opening.png') });
  const cdp = await context.newCDPSession(page); const frames = []; const writes = []; let start = 0;
  cdp.on('Page.screencastFrame', event => { void cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }); if (!start) start = event.metadata.timestamp; const name = `frame-${String(frames.length).padStart(5, '0')}.jpg`; frames.push({ name, time: event.metadata.timestamp }); writes.push(writeFile(path.join(framesDir, name), Buffer.from(event.data, 'base64'))); });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 94, maxWidth: viewport.width, maxHeight: viewport.height, everyNthFrame: 1 });
  for (let i = 0; !start && i < 50; i++) await wait(50);
  if (!start || Math.abs(Date.now() / 1000 - start) > 5) throw new Error('No correctly timestamped screencast frames.');
  const elapsed = () => Date.now() / 1000 - start;
  const at = async seconds => { const remaining = seconds - elapsed(); if (remaining > 0) await wait(remaining * 1000); };
  const cues = []; const cue = id => { const time = +elapsed().toFixed(3); cues.push({ id, time }); console.log(`Capture: ${id} at ${time}s`); };
  const move = async locator => { const box = await locator.boundingBox(); if (!box) throw new Error('Target has no bounds'); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await wait(620); };
  const click = async locator => { await move(locator); await locator.click(); await wait(240); };
  cue('organize');
  await at(2); cue('search'); const search = page.getByRole('textbox', { name: 'Search records, fields, files…', exact: true }); await click(search); await search.pressSequentially('QQ号', { delay: 260 });
  await at(4.6); await click(page.getByRole('button', { name: 'Copy QQ number', exact: true }).first());
  await at(6.5); await click(page.getByRole('button', { name: 'Clear search', exact: true }).first());
  await at(8.3); cue('edit'); await click(page.getByRole('button', { name: 'Edit', exact: true }));
  await page.locator('.editor-scroll').evaluate(node => { const heading = node.querySelector('.field-editor') ?? node.querySelector('.field-editor-item'); node.scrollTo({ top: heading.offsetTop - node.offsetTop - 20, behavior: 'smooth' }); }); await wait(700);
  const handle = page.getByRole('button', { name: 'Reorder Full name', exact: true }); await move(handle); const from = await handle.boundingBox(); const second = await page.locator('.field-editor-item').nth(1).boundingBox();
  await page.locator('#tour-cursor').evaluate(node => { node.style.transition = 'none'; }); await page.mouse.down();
  for (let i = 1; i <= 32; i++) { await page.mouse.move(from.x + from.width / 2 + Math.sin(i / 32 * Math.PI) * 16, from.y + from.height / 2 + (second.y + second.height - 42 - from.y - from.height / 2) * i / 32); await wait(22); }
  await page.mouse.up(); await page.locator('#tour-cursor').evaluate(node => { node.style.transition = ''; });
  await at(13.7); const value = page.locator('[data-field-id="full-name"] input').nth(2); await click(value); await value.press('End'); await value.pressSequentially(' (Alex)', { delay: 100 });
  await at(16.6); await click(page.getByRole('button', { name: 'Save changes', exact: true })); await page.locator('.editor-scroll').waitFor({ state: 'hidden' });
  await at(19); cue('image'); await click(page.getByRole('button', { name: 'Open file: identity_contact-card.png', exact: true })); await page.locator('.preview-image').waitFor();
  await at(21.5); await click(page.getByRole('button', { name: 'Zoom in', exact: true })); await at(23.5); await click(page.getByRole('button', { name: 'Fit to view', exact: true }));
  await at(25.5); cue('pdf'); await click(page.getByRole('button', { name: 'Next attachment', exact: true })); await page.locator('canvas[data-rendered-page="1"]').waitFor();
  await at(28.3); await click(page.getByRole('button', { name: 'Next page', exact: true })); await page.locator('canvas[data-rendered-page="2"]').waitFor();
  await at(30.5); await click(page.getByRole('button', { name: 'Zoom in', exact: true })); await at(32); await click(page.getByRole('button', { name: 'Fit to view', exact: true }));
  await at(34); cue('files'); await click(page.getByRole('button', { name: 'Close', exact: true })); await click(page.getByRole('button', { name: 'Files 2', exact: true }));
  let row = page.locator('.file-table-row').filter({ hasText: 'identity_a72b416e5a89.pdf' }); await click(row.getByRole('button', { name: 'Rename', exact: true }));
  const rename = page.getByRole('dialog', { name: 'Rename', exact: true }); const filename = rename.getByRole('textbox'); await click(filename); await filename.press('ControlOrMeta+A'); await filename.pressSequentially('certificate', { delay: 95 }); await click(rename.getByRole('button', { name: 'Save changes', exact: true }));
  await at(40.5); row = page.locator('.file-table-row').filter({ hasText: 'identity_certificate.pdf' }); await click(row.getByRole('button', { name: 'Copy path', exact: true }));
  await at(43); cue('appearance'); await click(page.getByRole('button', { name: 'Settings', exact: true })); const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  await at(45); await click(settings.getByRole('button', { name: 'Dark', exact: true })); await at(46.5); await click(settings.getByRole('button', { name: 'Violet', exact: true })); await at(48); await click(settings.getByRole('button', { name: 'Close', exact: true })); await click(page.getByRole('button', { name: 'All records 5', exact: true }));
  await at(50.5); cue('language'); await click(page.getByRole('button', { name: 'Language', exact: true })); await page.getByRole('button', { name: '编辑', exact: true }).waitFor(); await page.mouse.move(1420, 1100);
  await at(53.5); await page.screenshot({ path: path.join(output, 'closing.png') }); const end = Date.now() / 1000; await cdp.send('Page.stopScreencast'); await Promise.all(writes);
  const final = await page.evaluate(() => globalThis.__captureSnapshot);
  if (final.records[0].fields[0].id !== 'email' || final.attachments[1].fileName !== 'identity_certificate.pdf') throw new Error('Recorded edit, drag, or rename did not persist.');
  if (errors.length || remoteRequests.length) throw new Error(JSON.stringify({ errors, remoteRequests }));
  const duration = Math.ceil((end - start) * 30) / 30;
  const concat = ['ffconcat version 1.0', ...frames.flatMap((frame, i) => [`file '${frame.name}'`, `duration ${Math.max(.001, (frames[i + 1]?.time ?? end) - frame.time).toFixed(6)}`]), `file '${frames.at(-1).name}'`].join('\n');
  await writeFile(path.join(framesDir, 'frames.ffconcat'), concat);
  await new Promise((resolve, reject) => { const process = spawn(path.join(root, 'video/node_modules/@remotion/compositor-win32-x64-msvc/ffmpeg.exe'), ['-y', '-hide_banner', '-loglevel', 'warning', '-f', 'concat', '-safe', '0', '-i', path.join(framesDir, 'frames.ffconcat'), '-r', '30', '-fps_mode', 'cfr', '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-t', String(duration), path.join(output, 'continuous.mp4')], { windowsHide: true, stdio: 'inherit' }); process.on('error', reject); process.on('exit', code => code === 0 ? resolve() : reject(new Error(`FFmpeg exited ${code}`))); });
  const manifest = { viewport, uiScale, fps: 30, duration, frameCount: frames.length, cues, data: 'Fictional records and locally generated PNG/PDF only. One continuous actual frontend session.', verification: { fieldOrder: final.records[0].fields.map(field => field.id), renamedFile: final.attachments[1].fileName, browserErrors: errors, remoteRequests } };
  await writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n'); console.log(`Recorded ${duration}s, ${frames.length} observed frames, one continuous session.`);
} finally { await browser?.close(); if (vite && vite.exitCode === null) vite.kill(); }
