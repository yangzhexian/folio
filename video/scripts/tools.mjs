import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

export const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const repo = resolve(project, '..');
export const output = join(repo, 'docs/media');
export const work = join(repo, 'artifacts/video');
mkdirSync(work, { recursive: true });
const require = createRequire(import.meta.url);
const platform =
  process.platform === 'win32'
    ? 'win32-x64-msvc'
    : process.platform === 'darwin'
      ? 'darwin-' + process.arch
      : 'linux-' + process.arch + '-gnu';
let compositor;
try {
  compositor = dirname(
    require.resolve('@remotion/compositor-' + platform + '/package.json'),
  );
} catch {
  /* A system FFmpeg installation can also be used. */
}
function binary(name) {
  const file =
    compositor &&
    join(compositor, name + (process.platform === 'win32' ? '.exe' : ''));
  const override = process.env[name.toUpperCase() + '_PATH'];
  if (override) return override;
  if (
    spawnSync(name, ['-version'], { windowsHide: true, stdio: 'ignore' })
      .status === 0
  )
    return name;
  const packages = join(
    process.env.LOCALAPPDATA ?? '',
    'Microsoft/WinGet/Packages',
  );
  if (process.platform === 'win32' && existsSync(packages)) {
    for (const pkg of readdirSync(packages).filter((p) =>
      p.startsWith('Gyan.FFmpeg_'),
    )) {
      for (const version of readdirSync(join(packages, pkg)).sort().reverse()) {
        const candidate = join(packages, pkg, version, 'bin', name + '.exe');
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return file && existsSync(file) ? file : name;
}
export const ffmpeg = binary('ffmpeg');
export const ffprobe = binary('ffprobe');
export const chrome = [
  process.env.REMOTION_BROWSER_EXECUTABLE,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
]
  .filter(Boolean)
  .find(existsSync);
export function run(bin, args, options = {}) {
  const proc = spawnSync(bin, args, {
    windowsHide: true,
    stdio: 'inherit',
    ...options,
  });
  if (proc.error) throw proc.error;
  if (proc.status !== 0) throw new Error(bin + ' exited ' + proc.status);
  return proc.stdout;
}
