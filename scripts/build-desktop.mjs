import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const separator = '\u001f';

function pathVariants(value) {
  const absolute = path.resolve(value);
  const paths = new Set([absolute]);
  try { paths.add(realpathSync.native(absolute)); } catch { /* Cargo may create its home on first use. */ }
  for (const candidate of [...paths]) {
    paths.add(candidate.replaceAll('\\', '/'));
    if (process.platform === 'win32' && /^[a-z]:/i.test(candidate)) {
      paths.add(candidate[0].toLowerCase() + candidate.slice(1));
      paths.add(candidate[0].toUpperCase() + candidate.slice(1));
    }
  }
  return [...paths];
}

export function releaseEnvironment(environment = process.env) {
  const home = homedir();
  const mappings = [
    [home, '/user-home'],
    [environment.CARGO_HOME || path.join(home, '.cargo'), '/cargo'],
    [environment.RUSTUP_HOME || path.join(home, '.rustup'), '/rustup'],
    [repository, '/folio'],
  ].flatMap(([source, destination]) => pathVariants(source).map(prefix => [prefix, destination]));
  // rustc uses the last matching prefix. Keep the most specific paths last.
  mappings.sort(([left], [right]) => left.length - right.length);
  const remaps = mappings.map(([source, destination]) => `--remap-path-prefix=${source}=${destination}`);
  // Preserve Cargo's environment precedence. Encoded flags also support paths with spaces.
  const existing = environment.CARGO_ENCODED_RUSTFLAGS !== undefined
    ? environment.CARGO_ENCODED_RUSTFLAGS.split(separator).filter(Boolean)
    : (environment.RUSTFLAGS || '').trim().split(/\s+/u).filter(Boolean);
  return { ...environment, CARGO_ENCODED_RUSTFLAGS: [...existing, ...remaps].join(separator) };
}

function run(command, args, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repository, env: environment, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(command)} failed${signal ? ` (${signal})` : ` with exit code ${code}`}.`));
    });
  });
}

async function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: node scripts/build-desktop.mjs [--backend-only]\nBuild release binaries with portable Rust source paths. By default, build the CLI and the desktop installer.');
    return;
  }
  if (args.length > 1 || (args.length === 1 && args[0] !== '--backend-only')) {
    throw new Error('Unknown build arguments. Use --backend-only or --help.');
  }
  const environment = releaseEnvironment();
  await run('cargo', ['build', '--release', '--manifest-path', 'src-tauri/Cargo.toml', '--bin', 'folio-cli'], environment);
  if (args[0] === '--backend-only') return;
  await run(process.execPath, [path.join(repository, 'node_modules/@tauri-apps/cli/tauri.js'), 'build', '--config', 'src-tauri/tauri.release.conf.json'], environment);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
