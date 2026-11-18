import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseEnvironment } from './build-desktop.mjs';

if (process.platform !== 'win32') throw new Error('The native smoke test requires Windows with WebView2.');
const root = fileURLToPath(new URL('../', import.meta.url));
const env = releaseEnvironment({ ...process.env, CARGO_TARGET_DIR: path.join(root, 'artifacts/native/target') });

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run('cargo', ['build', '--locked', '--release', '--manifest-path', 'src-tauri/Cargo.toml', '--bin', 'folio-cli']);
run(process.execPath, ['node_modules/@tauri-apps/cli/tauri.js', 'build', '--no-bundle', '--config', 'tests/native/tauri-test.conf.json']);
run(process.execPath, ['tests/native/smoke.mjs']);
