import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { encodeCapture } from './encode-capture.mjs';
import { fileURLToPath } from 'node:url';

// Record one real frontend session. Only the native storage boundary is mocked.
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const checkOnly = process.argv.includes('--check');
const output = path.join(
  root,
  checkOnly ? 'artifacts/video/rehearsal' : 'video/public/session',
);
const framesDir = path.join(
  root,
  checkOnly
    ? 'artifacts/video/rehearsal/frames'
    : 'artifacts/video-session-capture',
);
const captureAddress = new URL(process.env.FOLIO_CAPTURE_URL ?? 'http://127.0.0.1:1432');
const origin = captureAddress.origin;
if (
  captureAddress.protocol !== 'http:' ||
  !['127.0.0.1', 'localhost', '[::1]'].includes(captureAddress.hostname)
)
  throw new Error('Capture requires a loopback development server.');
const viewport = { width: 1920, height: 1200 };
const uiScale = 4 / 3;
const timestamp = '2026-10-26T09:00:00.000Z';
const identityId = '00000000-0000-4000-8000-000000000101';
const field = (
  id,
  label,
  labelZh,
  value,
  kind = 'text',
  sensitive = false,
) => ({ id, label, labelZh, value, kind, sensitive });
const record = (id, category, title, subtitle, fields, favorite = false) => ({
  id,
  category,
  title,
  subtitle,
  fields,
  favorite,
  tags: [],
  notes: '',
  createdAt: timestamp,
  updatedAt: timestamp,
});
const attachment = (id, fileName, size) => ({
  id,
  recordId: identityId,
  originalName: fileName,
  fileName,
  size,
  createdAt: timestamp,
  relativePath: `attachments/${identityId}/${fileName}`,
  absolutePath: `C:\\Folio\\data\\attachments\\${identityId}\\${fileName}`,
});
const snapshot = {
  dataDir: 'C:\\Folio\\data',
  records: [
    record(
      identityId,
      'identity',
      'Personal details',
      'Alex Chen, the essentials at hand',
      [
        field('full-name', 'Full name', '姓名', 'Alex Chen'),
        field('email', 'Email', '邮箱', 'alex.chen@example.com', 'email'),
        field('qq', 'QQ number', 'QQ号', '1000000000'),
        field('city', 'Current city', '现居城市', 'Shanghai, China'),
        field(
          'document',
          'Document number',
          '证件号码',
          'Demo-000000',
          'text',
          true,
        ),
      ],
      true,
    ),
    record(
      '00000000-0000-4000-8000-000000000102',
      'education',
      'MSc in computer science',
      'Example University, 2023-2026',
      [field('degree', 'Degree', '学位', 'Master of Science')],
    ),
    record(
      '00000000-0000-4000-8000-000000000103',
      'experience',
      'Work experience',
      'Product design, Example Studio',
      [field('role', 'Role', '职位', 'Product designer')],
    ),
    record(
      '00000000-0000-4000-8000-000000000104',
      'research',
      'Research portfolio',
      'Projects, publications, and ideas',
      [
        field(
          'area',
          'Research area',
          '研究方向',
          'Human-computer interaction',
        ),
      ],
    ),
    record(
      '00000000-0000-4000-8000-000000000105',
      'skills',
      'Skills and certificates',
      'Qualifications ready when you need them',
      [field('certificate', 'Certificate', '证书', 'English proficiency')],
    ),
  ],
  attachments: [],
};

function syntheticPdf() {
  const content = (page) => {
    let stream =
      '0.95 0.96 0.93 rg 0 0 612 792 re f 0.22 0.36 0.28 rg 0 680 612 112 re f\n';
    const line = (text, x, y, size, white = false) => {
      stream += `${white ? '1 1 1' : '0.15 0.23 0.19'} rg BT /F1 ${size} Tf ${x} ${y} Td (${text}) Tj ET\n`;
    };
    line('Example University', 48, 733, 20, true);
    line(
      page === 1 ? 'Certificate of completion' : 'Academic transcript',
      48,
      700,
      15,
      true,
    );
    line('Alex Chen', 48, 605, 38);
    line(page === 1 ? 'Master of Science' : 'Course summary', 48, 550, 24);
    line('Computer science, class of 2026', 48, 512, 16);
    if (page === 1) {
      line('Completed on 15 July 2026', 48, 440, 16);
      line('Awarded for curiosity, craft, and persistence.', 48, 390, 15);
    } else
      [
        'Human computer interaction             A',
        'Data systems                                   A',
        'Research methods                            A-',
        'Design studio                                  A',
        'Final thesis                                     A',
      ].forEach((text, i) => line(text, 48, 444 - i * 43, 16));
    line('Fictional document for the Folio demonstration', 48, 80, 9);
    line(`Page ${page} of 2`, 48, 55, 10);
    return stream;
  };
  const a = content(1);
  const b = content(2);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(a)} >>\nstream\n${a}endstream`,
    `<< /Length ${Buffer.byteLength(b)} >>\nstream\n${b}endstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 8\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => String(offset).padStart(10, '0') + ' 00000 n ')
    .join(
      '\n',
    )}\ntrailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

let vite;
let browser;
let serverLog = '';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function ready() {
  try {
    return (await fetch(origin, { signal: AbortSignal.timeout(1200) })).ok;
  } catch {
    return false;
  }
}
try {
  await mkdir(output, { recursive: true });
  await mkdir(framesDir, { recursive: true });
  if (!(await ready())) {
    if (process.env.FOLIO_CAPTURE_URL)
      throw new Error('FOLIO_CAPTURE_URL is unavailable.');
    vite = spawn(
      process.execPath,
      [
        path.join(root, 'node_modules/vite/bin/vite.js'),
        '--host',
        '127.0.0.1',
        '--port',
        '1432',
        '--strictPort',
      ],
      { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    vite.stdout.on('data', (c) => {
      serverLog += c;
    });
    vite.stderr.on('data', (c) => {
      serverLog += c;
    });
    for (let i = 0; i < 360 && !(await ready()); i++) {
      if (vite.exitCode !== null) throw new Error(serverLog);
      await wait(250);
    }
    if (!(await ready())) throw new Error(serverLog);
  }
  browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome',
    headless: true,
  });
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    locale: 'en-US',
    timezoneId: 'Asia/Shanghai',
  });
  const art = await context.newPage();
  await art.setViewportSize({ width: 1200, height: 800 });
  await art.setContent(
    '<html><body style="margin:0;background:#dfe8d8;padding:70px;font-family:Segoe UI;color:#244536"><div style="background:#f9faf5;padding:64px;border-radius:30px;height:530px;box-sizing:border-box"><div style="font-size:22px;letter-spacing:1px">Folio contact card</div><h1 style="font-size:76px;margin:32px 0 20px">Alex Chen</h1><p style="font-size:26px">alex.chen@example.com</p><p style="font-size:26px">Shanghai, China</p><p style="font-size:22px;margin-top:36px">Design and research</p><p style="font-size:12px;margin-top:40px;color:#6a806e">Fictional contact for the Folio demonstration</p></div></body></html>',
  );
  const png = await art.screenshot({
    path: path.join(output, 'contact-card.png'),
  });
  await art.close();
  const pdf = syntheticPdf();
  await writeFile(path.join(output, 'certificate.pdf'), pdf);
  const incoming = {
    ...attachment('card', 'identity_c01dc0ffee01.png', png.length),
    originalName: 'contact-card.png',
  };
  snapshot.attachments = [
    attachment('certificate', 'identity_a72b416e5a89.pdf', pdf.length),
  ];
  const page = await context.newPage();
  const errors = [];
  const remoteRequests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (/^https?:/.test(request.url()) && !request.url().startsWith(origin))
      remoteRequests.push(request.url());
  });
  await page.addInitScript(() => {
    localStorage.setItem('folio.locale', 'en');
    localStorage.setItem('folio.theme', 'light');
    localStorage.setItem('folio.accent', 'sage');
  });
  await page.route(
    (url) => url.origin === origin && url.pathname === '/',
    async (route) => {
      const child =
        new URL(route.request().url()).searchParams.get('view') === 'preview';
      const response = await route.fetch();
      const html = await response.text();
      const bootstrap = `import { mockIPC, mockWindows } from '/node_modules/@tauri-apps/api/mocks.js'; globalThis.isTauri = true; mockWindows(${JSON.stringify(child ? 'attachment-preview' : 'main')}); const snapshot = ${JSON.stringify(snapshot)}; const fixtures = ${JSON.stringify({ card: png.toString('base64'), certificate: pdf.toString('base64') })}; globalThis.__captureSnapshot = snapshot; mockIPC(async (command, args) => {
      if (command === 'import_dropped_attachments') { if(args.recordId !== snapshot.records[0].id || args.paths.length !== 1 || !args.paths[0].endsWith('/contact-card.png')) throw Error('Unexpected drop target'); const file = ${JSON.stringify(incoming)}; snapshot.attachments.unshift(file); return [structuredClone(file)]; }
      if (command === 'open_preview_window') { globalThis.__tourSession = {revision:2,id:args.id,ids:args.ids}; window.dispatchEvent(new Event('tour-open-viewer')); return true; }
      if (command === 'load_preview_session') { const owner=window.parent; return {revision:owner.__tourSession.revision,id:owner.__tourSession.id,files:owner.__tourSession.ids.map(id=>owner.__captureSnapshot.attachments.find(f=>f.id===id)),pinned:!!globalThis.__tourPinned}; }
      if (command === 'set_preview_pinned') return globalThis.__tourPinned = args.pinned;
      if (command === 'save_categories') { snapshot.categories = args.categories; return { categories: args.categories, revision: 'tour-v2' }; }
        if (command === 'load_snapshot') return structuredClone(snapshot);
      if (command === 'save_record') { const saved = {...args.record, updatedAt: '${timestamp}'}; snapshot.records = snapshot.records.map(record => record.id === saved.id ? saved : record); return structuredClone(saved); }
      if (command === 'read_attachment_preview') return Uint8Array.from(atob(fixtures[args.id]), c => c.charCodeAt(0)).buffer;
      if (command === 'rename_attachment') { const file = snapshot.attachments.find(file => file.id === args.id); file.fileName = 'identity_' + args.name + '.pdf'; file.relativePath = 'attachments/' + file.recordId + '/' + file.fileName; file.absolutePath = 'C:/Folio/data/' + file.relativePath; return structuredClone(file); }
      if (command === 'attachment_path') return snapshot.attachments.find(file => file.id === args.id)?.absolutePath;
      if (command === 'plugin:clipboard-manager|write_text' || command.startsWith('plugin:window|')) return;
      throw new Error('Capture refuses unsupported IPC: ' + command);
    }, {shouldMockEvents: true}); await import('/src/main.tsx');`;
      const entry =
        /<script type="module" src="\/src\/main\.tsx(?:\?[^\"]*)?"><\/script>/;
      if (!entry.test(html)) throw new Error('Expected Folio Vite frontend.');
      await route.fulfill({
        response,
        body: html.replace(
          entry,
          () => `<script type="module">${bootstrap}</script>`,
        ),
      });
    },
  );
  await page.goto(origin);
  await page
    .getByRole('heading', { name: 'Personal details', exact: true })
    .waitFor();
  await page.addStyleTag({
    content: `html { zoom: ${uiScale}; } .app-shell { height: 900px; } .modal { max-height: 850px; } .attachment-preview { height: 856px; } * { caret-color: transparent !important; } #tour-cursor { position: fixed; left: 0; top: 0; width: 26px; height: 32px; z-index: 999999; pointer-events: none; transform: translate(1050px, 800px); transition: transform 600ms cubic-bezier(.25,.8,.25,1); filter: drop-shadow(0 2px 2px #0004); } #tour-cursor::after { content: ''; position: absolute; left: -14px; top: -14px; width: 34px; height: 34px; border: 3px solid #648353; border-radius: 50%; opacity: 0; } #tour-cursor.clicked::after { animation: tour-click 550ms ease-out; } @keyframes tour-click { from { transform: scale(.3); opacity: .9; } to { transform: scale(1.6); opacity: 0; } }`,
  });
  await page.evaluate((scale) => {
    const cursor = document.createElement('div');
    cursor.id = 'tour-cursor';
    cursor.innerHTML =
      '<svg viewBox="0 0 26 32"><path d="M3 2L22 19L13 20L9 29Z" fill="#182024" stroke="white" stroke-width="2" stroke-linejoin="round"/></svg>';
    document.body.append(cursor);
    document.addEventListener(
      'pointermove',
      (e) => {
        cursor.style.transform = `translate(${e.clientX / scale}px, ${e.clientY / scale}px)`;
      },
      true,
    );
    document.addEventListener(
      'pointerdown',
      () => {
        cursor.classList.remove('clicked');
        void cursor.offsetWidth;
        cursor.classList.add('clicked');
      },
      true,
    );
  }, uiScale);
  await page.evaluate(() => {
    window.addEventListener('tour-open-viewer', () => {
      const existing = document.getElementById('tour-viewer');
      if (existing) {
        existing.style.visibility = 'visible';
        existing.animate(
          [
            { transform: 'translate(32px,40px) scale(.7)', opacity: 0 },
            { transform: 'none', opacity: 1 },
          ],
          { duration: 420, easing: 'cubic-bezier(.2,.7,.3,1)' },
        );
        void existing
          .querySelector('iframe')
          .contentWindow.__TAURI_INTERNALS__.invoke('plugin:event|emit', {
            event: 'folio:preview-session',
            payload: null,
          });
        return;
      }
      const viewer = document.createElement('div');
      viewer.id = 'tour-viewer';
      viewer.innerHTML =
        '<header><button aria-label="Close preview window"></button><i></i><i></i><span>Folio preview</span></header><iframe title="Folio preview" src="/?view=preview"></iframe>';
      document.body.append(viewer);
      viewer.querySelector('button').onclick = () => viewer.remove();
      const titlebar = viewer.querySelector('header');
      titlebar.addEventListener('pointerdown', (event) => {
        if (event.target.closest('button')) return;
        const start = { x: event.clientX, y: event.clientY };
        titlebar.setPointerCapture(event.pointerId);
        const move = (point) => {
          viewer.style.translate =
            (point.clientX - start.x) / 1.3333333333333333 +
            'px ' +
            (point.clientY - start.y) / 1.3333333333333333 +
            'px';
        };
        titlebar.addEventListener('pointermove', move);
        titlebar.addEventListener(
          'pointerup',
          () => titlebar.removeEventListener('pointermove', move),
          { once: true },
        );
      });
    });
  });
  await page.addStyleTag({
    content:
      '#tour-viewer{position:fixed;z-index:9000;inset:7% 12% 9% 16%;background:#fff;border:1px solid #717e7980;border-radius:14px;overflow:hidden;box-shadow:0 22px 70px #14282155;animation:bring-in .48s cubic-bezier(.2,.76,.2,1);transform-origin:80% 80%}#tour-viewer header{height:32px;display:flex;align-items:center;gap:7px;padding:0 12px;background:#e6e9e5;color:#57645c;font:600 12px Segoe UI,sans-serif}#tour-viewer header button,#tour-viewer header i{border:0;border-radius:100%;height:12px;width:12px;padding:0;background:#ed7064}#tour-viewer header i{background:#f5c05a}#tour-viewer header i+i{background:#66bd74}#tour-viewer header span{position:absolute;left:45%}#tour-viewer iframe{border:0;width:100%;height:calc(100% - 32px)}@keyframes bring-in{from{transform:translate(35px,45px) scale(.69);opacity:0}to{transform:none;opacity:1}}',
  });
  // Prepare the local reader, including its PDF worker, before recording so
  // first-time development-server compilation does not enter the product tour.
  await page.evaluate(() => {
    window.__tourSession = {
      revision: 1,
      id: 'certificate',
      ids: ['certificate'],
    };
    window.dispatchEvent(new Event('tour-open-viewer'));
    document.getElementById('tour-viewer').style.visibility = 'hidden';
  });
  await page
    .frameLocator('#tour-viewer iframe')
    .locator('canvas[data-rendered-page="1"]')
    .waitFor({ state: 'attached', timeout: 60000 });
  if ((await page.locator('.sidebar .brand').innerText()).trim() !== 'Folio') throw new Error('The captured sidebar must use the Folio wordmark.');
  await page.evaluate(() => document.fonts.ready);
  await wait(500);
  await page.screenshot({ path: path.join(output, 'opening.png') });
  const cdp = await context.newCDPSession(page);
  const frames = [];
  const writes = [];
  let start = 0;
  cdp.on('Page.screencastFrame', (event) => {
    void cdp
      .send('Page.screencastFrameAck', { sessionId: event.sessionId })
      .catch(() => {});
    if (!start) start = event.metadata.timestamp;
    const name = `frame-${String(frames.length).padStart(5, '0')}.jpg`;
    frames.push({ name, time: event.metadata.timestamp });
    writes.push(
      writeFile(path.join(framesDir, name), Buffer.from(event.data, 'base64')),
    );
  });
  await cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 94,
    maxWidth: viewport.width,
    maxHeight: viewport.height,
    everyNthFrame: 1,
  });
  for (let i = 0; !start && i < 50; i++) await wait(50);
  if (!start || Math.abs(Date.now() / 1000 - start) > 5)
    throw new Error('No correctly timestamped screencast frames.');
  const elapsed = () => Date.now() / 1000 - start;
  const at = async (seconds) => {
    const remaining = seconds - elapsed();
    if (!checkOnly && remaining > 0) await wait(remaining * 1000);
  };
  const cues = [];
  const cue = (id) => {
    const time = +elapsed().toFixed(3);
    cues.push({ id, time });
    console.log(`Capture: ${id} at ${time}s`);
  };
  const move = async (locator) => {
    const box = await locator.boundingBox();
    if (!box) throw new Error('Target has no bounds');
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(point.x, point.y);
    await page.evaluate(
      ({ point, scale }) => {
        document.querySelector('#tour-cursor').style.transform =
          `translate(${point.x / scale}px,${point.y / scale}px)`;
      },
      { point, scale: uiScale },
    );
    await wait(checkOnly ? 40 : 410);
  };
  const click = async (locator) => {
    await move(locator);
    const nested = await locator.evaluate(
      (node) =>
        node.ownerDocument.defaultView !== node.ownerDocument.defaultView.top,
    );
    if (nested) await locator.evaluate((node) => node.click());
    else await locator.click();
    await wait(checkOnly ? 30 : 180);
  };
  cue('organize');
  await at(0.5);
  await click(
    page.getByRole('button', { name: 'Show sensitive fields', exact: true }),
  );
  await at(2.1);
  await click(
    page.getByRole('button', { name: 'Hide sensitive fields', exact: true }),
  );
  await at(3.3);
  cue('search');
  const search = page.getByRole('textbox', {
    name: 'Search records, fields, files…',
    exact: true,
  });
  await click(search);
  await search.pressSequentially('QQ号', { delay: 260 });
  await at(5.8);
  await click(
    page.getByRole('button', { name: 'Copy QQ number', exact: true }).first(),
  );
  await at(7.1);
  await click(
    page.getByRole('button', { name: 'Clear search', exact: true }).first(),
  );
  await at(8.3);
  cue('edit');
  await click(page.getByRole('button', { name: 'Edit', exact: true }));
  await page.locator('.editor-scroll').evaluate((node) => {
    const heading =
      node.querySelector('.field-editor') ??
      node.querySelector('.field-editor-item');
    node.scrollTo({
      top: heading.offsetTop - node.offsetTop - 20,
      behavior: 'smooth',
    });
  });
  await wait(700);
  const editor = page.getByRole('dialog', { name: 'Edit', exact: true });
  await click(
    editor.getByRole('button', {
      name: 'Add field after Full name',
      exact: true,
    }),
  );
  const alias = editor.getByLabel('Label 2', { exact: true });
  await click(alias);
  await alias.pressSequentially('Alias', { delay: 95 });
  const fieldValue = editor.getByLabel('Value 2', { exact: true });
  await click(fieldValue);
  await fieldValue.pressSequentially('Alex', { delay: 95 });
  const items = editor.locator('.field-editor-item');
  await items.first().scrollIntoViewIfNeeded();
  const handle = editor.getByRole('button', {
    name: 'Reorder Alias',
    exact: true,
  });
  await move(handle);
  const from = await handle.boundingBox();
  const first = await items.first().boundingBox();
  await page
    .locator('#tour-cursor')
    .evaluate((node) => (node.style.transition = 'none'));
  await page.mouse.down();
  for (let n = 1; n <= 26; n++) {
    await page.mouse.move(
      from.x + from.width / 2 + Math.sin((n / 26) * Math.PI) * 14,
      from.y +
        from.height / 2 +
        ((first.y + Math.min(46, first.height / 4) - from.y - from.height / 2) *
          n) /
          26,
    );
    await wait(checkOnly ? 4 : 24);
  }
  await page.mouse.up();
  await page
    .locator('#tour-cursor')
    .evaluate((node) => (node.style.transition = ''));
  if (
    (await items.first().getByRole('textbox').first().inputValue()) !== 'Alias'
  )
    throw Error('The inserted field did not move to first position.');
  await at(17);
  await click(
    editor.getByRole('button', { name: 'Save changes', exact: true }),
  );
  await editor.waitFor({ state: 'hidden' });

  await at(18.4);
  cue('import');
  await page.evaluate(() => {
    const chip = document.createElement('div');
    chip.id = 'tour-file';
    chip.textContent = '▧   contact-card.png';
    chip.style.cssText =
      'position:fixed;left:58px;top:555px;padding:13px 19px;background:#f2f5ed;color:#234333;border:1px solid #85977d;border-radius:9px;box-shadow:0 4px 12px #172b283d;z-index:99997;font:600 16px Segoe UI,sans-serif;pointer-events:none';
    document.body.append(chip);
  });
  const nativeDrop = (phase) =>
    page.evaluate(
      (phase) =>
        window.__TAURI_INTERNALS__.invoke('plugin:event|emit', {
          event: 'tauri://drag-' + phase,
          payload: {
            paths: ['C:/Folio-Demo/contact-card.png'],
            position: { x: 1080, y: 720 },
          },
        }),
      phase,
    );
  await page.mouse.move(100, 755);
  await wait(300);
  await page.mouse.down();
  await nativeDrop('enter');
  await page.locator('.drop-overlay').waitFor();
  await page
    .locator('#tour-cursor')
    .evaluate((node) => (node.style.transition = 'none'));
  for (let n = 1; n <= 24; n++) {
    const x = 100 + (n / 24) * 960,
      y = 755 - (n / 24) * 130;
    await page.mouse.move(x, y);
    await page.locator('#tour-file').evaluate(
      (node, p) => {
        node.style.left = p.x + 'px';
        node.style.top = p.y + 'px';
      },
      { x: x / uiScale + 12, y: y / uiScale + 14 },
    );
    await wait(checkOnly ? 2 : 30);
  }
  await page.mouse.up();
  await nativeDrop('drop');
  await page.locator('#tour-file').evaluate((node) => node.remove());
  await page
    .locator('#tour-cursor')
    .evaluate((node) => (node.style.transition = ''));
  const card = page.getByRole('button', {
    name: 'Open file: identity_c01dc0ffee01.png',
    exact: true,
  });
  await card.waitFor();
  await at(21.7);
  cue('image');
  await click(card);
  const viewer = page.frameLocator('#tour-viewer iframe');
  await viewer.locator('.preview-image').waitFor();
  await at(23.1);
  await click(viewer.getByRole('button', { name: 'Zoom in', exact: true }));
  await at(24.6);
  cue('pin');
  await click(viewer.getByRole('button', { name: 'Keep on top', exact: true }));
  const pinned = viewer.getByRole('button', {
    name: 'Stop keeping on top',
    exact: true,
  });
  await pinned.waitFor();
  await at(26);
  const header = page.locator('#tour-viewer header');
  await move(header);
  const base = await header.boundingBox();
  await page.mouse.down();
  await page.mouse.move(
    base.x + base.width / 2 + 140,
    base.y + base.height / 2 + 38,
    { steps: 22 },
  );
  await page.mouse.up();
  const shifted = await header.boundingBox();
  if (shifted.x - base.x < 80)
    throw Error('Viewer drag did not move the window.');
  await at(28);
  await click(
    page.locator('.sidebar .nav-item').filter({ hasText: 'Education' }),
  );
  await page
    .getByRole('heading', { name: 'MSc in computer science', exact: true })
    .waitFor();
  await pinned.waitFor();
  await at(30);
  cue('pdf');
  await click(
    viewer.getByRole('button', { name: 'Next attachment', exact: true }),
  );
  await viewer.locator('canvas[data-rendered-page="1"]').waitFor();
  await at(32.6);
  await click(viewer.getByRole('button', { name: 'Next page', exact: true }));
  await viewer.locator('canvas[data-rendered-page="2"]').waitFor();
  await at(35);
  cue('files');
  await click(viewer.getByRole('button', { name: 'Copy path', exact: true }));
  await at(37);
  await click(page.getByRole('button', { name: 'Close preview window' }));
  await at(38.5);
  cue('collections');
  await click(
    page.getByRole('button', { name: 'Manage collections', exact: true }),
  );
  const manager = page.getByRole('dialog', {
    name: 'Collections',
    exact: true,
  });
  const education = manager.locator('[data-category-id="education"]');
  await at(40);
  await click(education.getByRole('button', { name: 'Move up', exact: true }));
  await at(41.2);
  await click(
    education.getByRole('button', { name: 'Choose icon', exact: true }),
  );
  await click(manager.getByRole('button', { name: 'Book', exact: true }));
  await at(43);
  const categoryName = education.getByLabel('English name', { exact: true });
  await click(categoryName);
  await categoryName.press('ControlOrMeta+A');
  await categoryName.pressSequentially('Learning', { delay: 100 });
  await at(46);
  await click(
    manager.getByRole('button', { name: 'Save changes', exact: true }),
  );
  await page
    .locator('.sidebar .nav-item')
    .filter({ hasText: 'Learning' })
    .locator('svg.lucide-book-open')
    .waitFor();
  await at(48);
  cue('appearance');
  await click(page.getByRole('button', { name: 'All records 5', exact: true }));
  await click(
    page.getByRole('button', { name: 'Switch to dark theme', exact: true }),
  );
  await at(50.5);
  cue('language');
  await click(page.getByRole('button', { name: 'Language', exact: true }));
  await page.getByRole('button', { name: '编辑', exact: true }).waitFor();
  await at(53);
  await page.screenshot({ path: path.join(output, 'closing.png') });
  const end = Date.now() / 1000;
  await cdp.send('Page.stopScreencast');
  await Promise.all(writes);
  const final = await page.evaluate(() => globalThis.__captureSnapshot);
  const inserted = final.records[0].fields[0];
  if (
    inserted.label !== 'Alias' ||
    inserted.value !== 'Alex' ||
    final.records[0].fields.length !== 6 ||
    final.attachments[0].originalName !== 'contact-card.png' ||
    final.categories[0].nameEn !== 'Learning' ||
    final.categories[0].icon !== 'book-open'
  )
    throw Error(
      'Recorded field, file or collection state differs from the storyboard.',
    );
  if (errors.length || remoteRequests.length)
    throw new Error(JSON.stringify({ errors, remoteRequests }));
  if (checkOnly) {
    console.log('All storyboard actions verified.');
  } else {
    const duration = 54;
    const timings = Object.fromEntries(cues.map((cue) => [cue.id, cue.time]));
    if (
      timings.pin - timings.image > 5 ||
      timings.pdf - timings.pin < 4 ||
      timings.files - timings.pdf < 3
    )
      throw Error(
        'Reader startup or interaction pacing falls outside the storyboard.',
      );
    if (end - start > duration)
      throw new Error('Session exceeded the reserved 54 seconds.');
    await encodeCapture({
      frames,
      start,
      duration,
      directory: framesDir,
      output: path.join(output, 'continuous.mp4'),
    });
    const manifest = {
      viewport,
      uiScale,
      fps: 30,
      duration,
      observedFrames: frames.length,
      encodedFrames: duration * 30,
      cues,
      data: 'Fictional records and locally generated PNG/PDF only. One continuous actual frontend session.',
      verification: {
        fieldOrder: final.records[0].fields.map((field) => field.id),
        insertedField: {
          label: inserted.label,
          value: inserted.value,
          position: 0,
        },
        importedFile: final.attachments[0].fileName,
        viewer: {
          pinned: true,
          dragged: true,
          backgroundRecord: 'MSc in computer science',
          pdfPage: 2,
        },
        firstCollection: final.categories[0],
        browserErrors: errors,
        remoteRequests,
      },
    };
    await writeFile(
      path.join(output, 'manifest.json'),
      JSON.stringify(manifest, null, 2) + '\n',
    );
    console.log(
      `Recorded ${duration}s, ${frames.length} observed frames, one continuous session.`,
    );
  }
} finally {
  await browser?.close();
  if (vite && vite.exitCode === null) vite.kill();
}
