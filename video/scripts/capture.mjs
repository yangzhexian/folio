import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Capture the real Folio UI with explicit fictional data. This script never
// connects to the native backend, reads a personal vault, or opens attachments.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.join(root, 'video/public/screens');
const origin = process.env.FOLIO_CAPTURE_URL ?? 'http://127.0.0.1:1420';
const timestamp = '2026-10-24T09:00:00.000Z';
const identityId = '00000000-0000-4000-8000-000000000101';
const contactsId = '00000000-0000-4000-8000-000000000102';
const educationId = '00000000-0000-4000-8000-000000000103';
const skillsId = '00000000-0000-4000-8000-000000000104';
const researchId = '00000000-0000-4000-8000-000000000105';
const experienceId = '00000000-0000-4000-8000-000000000106';

function field(id, label, labelZh, value, kind = 'text', sensitive = false) {
  return { id, label, labelZh, value, kind, sensitive };
}

function record(id, category, title, subtitle, fields, tags, favorite, day) {
  return { id, category, title, subtitle, fields, tags, favorite, notes: '', createdAt: `2026-10-${day}T09:00:00.000Z`, updatedAt: `2026-10-${day}T09:00:00.000Z` };
}

function attachment(id, recordId, originalName, fileName, size) {
  return { id, recordId, originalName, fileName, size, createdAt: timestamp,
    relativePath: `attachments/${recordId}/${fileName}`,
    absolutePath: `C:\\Folio\\data\\vault\\attachments\\${recordId}\\${fileName}` };
}

const snapshot = {
  dataDir: 'C:\\Folio\\data',
  records: [
    record(identityId, 'identity', 'Personal details', 'Alex Chen · The essentials, always at hand', [
      field('full-name', 'Full name', '姓名', 'Alex Chen'),
      field('email', 'Email', '邮箱', 'alex.chen@example.com', 'email'),
      field('city', 'Current city', '现居城市', 'Shanghai / 上海'),
      field('document-number', 'Document number', '证件号码', 'DEMO-000000', 'text', true),
    ], ['Personal', 'Essentials'], true, 24),
    record(contactsId, 'contacts', 'Contact details', 'One place for every way to reach you', [
      field('mobile', 'Mobile phone', '手机号', '+86 138 0000 0000', 'phone'),
      field('qq', 'QQ number', 'QQ号', '1000000000'),
      field('wechat', 'WeChat', '微信号', 'alex_demo'),
      field('address', 'Mailing address', '通讯地址', '100 Example Road, Shanghai'),
    ], ['Contact'], true, 23),
    record(educationId, 'education', 'MSc · Computer Science', 'Example University · 2023–2026', [
      field('graduation', 'Graduation date', '毕业日期', '2026-07-15', 'date'),
      field('institution', 'Institution', '学校', 'Example University'),
      field('degree', 'Degree', '学位', 'Master of Science'),
      field('major', 'Major', '专业', 'Computer Science'),
    ], ['Graduate'], true, 22),
    record(skillsId, 'skills', 'Skills & certificates', 'Qualifications ready when you need them', [
      field('certificate', 'Certificate', '证书', 'English proficiency'),
      field('score', 'Result', '成绩', 'C1 · Advanced'),
      field('issue-date', 'Issued on', '签发日期', '2026-06-18', 'date'),
    ], ['Language', 'Certificates'], false, 21),
    record(researchId, 'research', 'Research portfolio', 'Projects, publications, and ideas', [
      field('area', 'Research area', '研究方向', 'Human–computer interaction'),
      field('project', 'Current project', '当前课题', 'Tools for everyday knowledge work'),
    ], ['Research'], false, 20),
    record(experienceId, 'experience', 'Work experience', 'Product design · Example Studio', [
      field('employer', 'Organization', '单位', 'Example Studio'),
      field('role', 'Role', '职位', 'Product designer'),
      field('start', 'Started on', '开始日期', '2025-06-01', 'date'),
    ], ['Experience'], false, 19),
  ],
  attachments: [
    attachment('photo', identityId, 'portrait.png', 'identity_portrait.png', 246784),
    attachment('identity-document', identityId, 'identity-copy.pdf', 'identity_document.pdf', 438272),
    attachment('degree', educationId, 'degree-certificate.pdf', 'education_degree.pdf', 1258291),
    attachment('transcript', educationId, 'transcript.pdf', 'education_transcript.pdf', 756736),
    attachment('language-certificate', skillsId, 'language-certificate.jpg', 'skills_language.jpg', 983040),
    attachment('cv', experienceId, 'resume.pdf', 'experience_resume.pdf', 180224),
  ],
};

let vite;
let browser;
let serverLog = '';

async function serverReady() {
  try {
    const response = await fetch(origin, { signal: AbortSignal.timeout(1200) });
    return response.ok;
  } catch { return false; }
}

try {
  await mkdir(output, { recursive: true });
  if (!(await serverReady())) {
    if (process.env.FOLIO_CAPTURE_URL) throw new Error('FOLIO_CAPTURE_URL is not available.');
    vite = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '1420', '--strictPort'], {
      cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    vite.stdout.on('data', chunk => { serverLog += chunk; });
    vite.stderr.on('data', chunk => { serverLog += chunk; });
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (await serverReady()) { ready = true; break; }
      if (vite.exitCode !== null) throw new Error(`Vite stopped unexpectedly: ${serverLog}`);
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!ready) throw new Error(`Vite did not start: ${serverLog}`);
  }
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'en-US', timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('folio.locale', 'en');
    localStorage.setItem('folio.theme', 'light');
    localStorage.setItem('folio.accent', 'sage');
  });
  await page.route(`${origin}/`, async route => {
    const response = await route.fetch();
    const html = await response.text();
    const bootstrap = `
      import { mockIPC, mockWindows } from '/node_modules/@tauri-apps/api/mocks.js';
      globalThis.isTauri = true;
      mockWindows('main');
      const snapshot = ${JSON.stringify(snapshot)};
      mockIPC(async (command, args) => {
        if (command === 'load_snapshot') return structuredClone(snapshot);
        if (command === 'save_record') {
          const saved = { ...args.record, updatedAt: '${timestamp}' };
          snapshot.records = [...snapshot.records.filter(record => record.id !== saved.id), saved];
          return structuredClone(saved);
        }
        if (command === 'attachment_path') return snapshot.attachments.find(file => file.id === args.id)?.absolutePath;
        if (command === 'plugin:clipboard-manager|write_text' || command.startsWith('plugin:window|')) return;
        throw new Error('Capture does not permit this IPC command: ' + command);
      }, { shouldMockEvents: true });
      await import('/src/main.tsx');
    `;
    const entry = /<script type="module" src="\/src\/main\.tsx(?:\?[^\"]*)?"><\/script>/;
    if (!entry.test(html)) throw new Error('Capture requires the Folio Vite development server.');
    await route.fulfill({ response, body: html.replace(entry, () => `<script type="module">${bootstrap}</script>`) });
  });
  await page.goto(origin);
  await page.locator('.record-card').nth(5).waitFor();
  await page.getByRole('heading', { name: 'Personal details', exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);

  const manifest = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, image: { width: 2880, height: 1800 }, data: 'Synthetic fixture only; no personal vault or attachment contents were read.', screens: {} };
  async function capture(name) {
    await page.mouse.move(1438, 898);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const targets = {
      sidebar: '.sidebar', searchBox: '.search-box', records: '.record-list', selectedRecord: '.record-card.selected',
      detailTitle: '.detail-title', firstField: '.field-row', maskedField: '.field-row:has(.masked)',
      firstFieldCopy: '.field-row .field-actions button:last-child', attachments: '.attachment-row',
      attachmentName: '.attachment-name .file-open', attachmentActions: '.attachment-row .file-actions',
      searchResults: '.field-search-results', searchResultCopy: '.field-result > .icon-button', matchedField: '.field-found',
      editor: '.modal-wide', firstEditorField: '.editor-field', dragHandle: '.field-drag-handle',
      addField: '.field-editor-item .field-insert', calendar: '.date-picker-panel',
      calendarNavigation: '.date-picker-header', previousYear: '.date-picker-header button:first-child', nextYear: '.date-picker-header button:last-child',
      fileTable: '.file-library', firstFileName: '.file-table-row .file-open', firstFileActions: '.file-table-row .file-actions',
      firstFileCopy: '.file-table-row .file-actions button:nth-child(1)', firstFileFolder: '.file-table-row .file-actions button:nth-child(2)', firstFileRename: '.file-table-row .file-actions button:nth-child(3)',
      themeToggle: '.topbar-actions > .icon-button', languageToggle: '.locale-toggle', settings: '.settings-content',
      themeModes: '.theme-modes', accentColors: '.accent-options', selectedAccent: '.accent-option[aria-pressed="true"]',
    };
    const rects = {};
    for (const [target, selector] of Object.entries(targets)) {
      const element = page.locator(selector).first();
      if (!(await element.count()) || !(await element.isVisible())) continue;
      const bounds = await element.boundingBox();
      if (!bounds || bounds.y + bounds.height < 0 || bounds.y > 900) continue;
      rects[target] = Object.fromEntries(Object.entries(bounds).map(([key, value]) => [key, Math.round(value * 100) / 100]));
    }
    await page.screenshot({ path: path.join(output, `${name}.png`), animations: 'disabled' });
    manifest.screens[name] = { file: `${name}.png`, rects };
    console.log(`Captured ${name}.png (2880 × 1800)`);
  }

  await capture('overview');

  const search = page.getByRole('textbox', { name: 'Search records, fields, files…', exact: true });
  await search.fill('QQ号');
  await page.locator('.field-search-results').waitFor();
  await page.getByRole('button', { name: 'Show field QQ number', exact: true }).click();
  await capture('search');
  await search.fill('');

  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('dialog', { name: 'Edit', exact: true }).waitFor();
  await page.locator('.editor-scroll').evaluate(node => { node.scrollTop = node.querySelector('.editor-section-heading').offsetTop - node.offsetTop - 18; });
  await capture('editor');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();

  await page.locator('.record-card').filter({ hasText: 'MSc · Computer Science' }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Choose date', exact: true }).click();
  await page.locator('.date-picker-panel').waitFor();
  await page.locator('.editor-scroll').evaluate(node => { node.scrollTop = node.querySelector('.editor-section-heading').offsetTop - node.offsetTop - 18; });
  await capture('calendar');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();

  await page.getByRole('button', { name: /^Files\s*6$/ }).click();
  await page.locator('.file-table-row').nth(5).waitFor();
  await capture('files');

  await page.getByRole('button', { name: /^All records\s*6$/ }).click();
  await page.locator('.record-card').filter({ hasText: 'Personal details' }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  await settings.getByRole('button', { name: 'Dark', exact: true }).click();
  await settings.getByRole('button', { name: 'Violet', exact: true }).click();
  await capture('settings');
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  await capture('appearance');

  await page.getByRole('button', { name: 'Language', exact: true }).click();
  await page.getByRole('button', { name: '编辑', exact: true }).waitFor();
  if (await page.locator('html').getAttribute('data-theme') !== 'dark' || await page.locator('html').getAttribute('data-accent') !== 'violet') {
    throw new Error('Language switching must preserve the dark violet appearance.');
  }
  await capture('chinese');

  if (errors.length) throw new Error(`Browser errors during capture: ${errors.join('; ')}`);
  await writeFile(path.join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log('All captures use synthetic records and file metadata only.');
} finally {
  await browser?.close();
  if (vite && vite.exitCode === null) vite.kill();
}
