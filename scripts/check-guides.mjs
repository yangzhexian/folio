import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = file => readFile(path.join(root, file), 'utf8');
const manifest = JSON.parse(await read('package.json'));
const lock = JSON.parse(await read('package-lock.json'));
const config = JSON.parse(await read('src-tauri/tauri.conf.json'));
const cargo = (await read('src-tauri/Cargo.toml')).match(/^version\s*=\s*"([^"]+)"/m)?.[1];
const cargoLock = (await read('src-tauri/Cargo.lock')).match(/\[\[package\]\]\s+name = "folio"\s+version = "([^"]+)"/)?.[1];
for (const version of [lock.version, lock.packages[''].version, config.version, cargo, cargoLock]) assert.equal(version, manifest.version, 'Application versions disagree');

const folder = 'docs/development';
const guides = ['AGENTS.md', 'README.md', ...((await readdir(path.join(root, folder))).filter(f => f.endsWith('.md')).map(f => path.join(folder, f)))];
for (const skill of ['folio-development', 'folio-data-entry']) {
  const guide = `skills/${skill}/SKILL.md`;
  const src = await read(guide);
  assert(src.startsWith(`---\nname: ${skill}\ndescription: `) || src.replaceAll('\r\n', '\n').startsWith(`---\nname: ${skill}\ndescription: `), `Invalid skill metadata in ${guide}`);
  guides.push(guide);
}
for (const file of guides) {
  const content = await read(file);
  for (const match of content.matchAll(/\]\(([^\s)]+)\)/g)) {
    const href = match[1].split('#')[0];
    if (!href || /^[a-z][\w+.-]*:/i.test(href)) continue;
    try { await access(path.resolve(root, path.dirname(file), decodeURIComponent(href))); }
    catch { throw new Error(`Missing local guide link in ${file}: ${href}`); }
  }
}
console.log(`Verified ${guides.length} guides and application version ${manifest.version}.`);
