import { execFileSync, spawnSync } from 'node:child_process';

// Inspect the Git index so a locally ignored vault is never opened or enumerated.
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const privateFile = /(?:^|\/)(?:\.env(?:\..*)?|\.folio-operation\.lock|(?:local-data|data|vault|artifacts|test-results|playwright-report)\/|id_(?:rsa|ed25519)$)|\.(?:sqlite3?|db)(?:-(?:wal|shm|journal))?$|\.(?:pfx|p12|key|pem|dmp|log)$/i;
const issues = files.filter(file => privateFile.test(file));
const sensitiveText = [
  '-----BEGIN ([A-Z0-9]+ )*PRIVATE KEY-----',
  'gh[pousr]_[A-Za-z0-9]{30,}',
  'github_pat_[A-Za-z0-9_]{50,}',
  '[A-Za-z]:[/\\\\]+Users[/\\\\]+[^/\\\\[:space:]]+[/\\\\]',
  '/(Users|home)/[A-Za-z0-9_.-]+/',
].join('|');
const scan = spawnSync('git', ['grep', '--cached', '-Ilz', '-E', '-e', sensitiveText, '--'], { encoding: 'utf8' });
if (scan.error) throw scan.error;
if (scan.status !== 0 && scan.status !== 1) throw new Error(scan.stderr || 'Unable to check staged text.');
issues.push(...scan.stdout.split('\0').filter(Boolean));
if (issues.length) {
  console.error('Review these indexed paths before publishing:\n' + [...new Set(issues)].join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Checked ${files.length} indexed paths and text blobs for local data and common credentials.`);
}
