import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
const base = event.pull_request?.base.sha ?? event.before;
const all = !base || /^0+$/.test(base);
const changed = all ? [] : execFileSync('git', ['diff', '--no-renames', '--name-only', '-z', base, process.env.GITHUB_SHA], { encoding: 'utf8' }).split('\0');
const automation = /^(?:\.github\/workflows\/|scripts\/ci-scope\.mjs$)/;
const native = /^(?:src\/|src-tauri\/|tests\/native\/|tests\/fixtures\/|scripts\/(?:check-(?:native\.mjs|upgrade\.ps1)|build-desktop\.mjs)|skills\/folio-data-entry\/|package(?:-lock)?\.json|index\.html|(?:vite|tsconfig)[^/]*$)/;
const media = /^(?:video\/|docs\/media\/)/;
for (const [name, match] of Object.entries({ native, media })) {
  const run = all || changed.some(file => automation.test(file) || match.test(file));
  appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${run}\n`);
}
