import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// Synthetic data only. Both revisions run the same sidebar, result and field/file projections.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--ref')) throw new Error('Usage: node scripts/bench-ui.mjs [--ref <git-ref>]');
const ref = args[1];
const queries = [
  ['example-041', 'all'], ['手机号 group-03', 'all'], ['ＱＱ　号', 'favorites'],
  ['no-result', 'all'], ['transcript-041', 'files'], ['group-03', 'files'],
];

function fixture(size) {
  const records = [];
  const attachments = [];
  for (let i = 0; i < size; i++) {
    const n = String(i).padStart(5, '0');
    const date = '2025-01-01T00:00:00Z';
    records.push({
      id: n, title: `Example-${n}`, subtitle: '', category: i % 2 ? 'education' : 'identity',
      favorite: i % 7 === 0, tags: [`group-${String(i % 20).padStart(2, '0')}`],
      notes: '', createdAt: date, updatedAt: date,
      fields: [
        { id: `p${n}`, label: 'Mobile', labelZh: '手机', value: `sample-${n}`, kind: 'text', sensitive: false },
        { id: `q${n}`, label: 'QQ number', labelZh: 'QQ 号', value: `demo-${n}`, kind: 'text', sensitive: true },
      ],
    });
    attachments.push({ id: `f${n}`, recordId: n, fileName: `example_${n}.pdf`, originalName: `transcript-${n}.pdf`, relativePath: '', absolutePath: '', size: 100, createdAt: date });
  }
  return { records, attachments };
}

function projector(domain, categories, records, attachments) {
  const index = domain.createLibraryIndex?.(records, attachments, categories);
  return (query, view) => {
    const category = view === 'files' ? 'all' : view;
    const results = index?.search(query, category, view === 'files');
    const hits = results?.records ?? domain.filterRecords(records, attachments, query, category, categories);
    // The previous UI also calculated file search results on the records screen.
    const files = results?.files ?? domain.filterAttachments(records, attachments, query, categories);
    let checksum = index?.favoriteCount ?? records.filter(record => record.favorite).length;
    for (const item of categories) checksum += index ? (index.categoryCounts.get(item.id) ?? 0) : records.filter(record => record.category === item.id).length;
    if (view === 'files') {
      for (const file of files) checksum += (index ? index.recordsById.get(file.recordId) : records.find(record => record.id === file.recordId)).id.length;
    } else {
      for (const record of hits) {
        const count = index ? (index.filesByRecord.get(record.id)?.length ?? 0) : attachments.filter(file => file.recordId === record.id).length;
        const matches = results ? results.fields.get(record.id) ?? [] : domain.findMatchingFields(record, query, categories);
        checksum += Number(record.id) + count + matches.length;
      }
    }
    return checksum;
  };
}

function measure(run, repetitions) {
  const times = [];
  let checksum;
  for (let i = 0; i < repetitions; i++) {
    const start = performance.now();
    const next = run();
    times.push(performance.now() - start);
    if (checksum !== undefined && next !== checksum) throw new Error('Unstable result');
    checksum = next;
  }
  times.sort((a, b) => a - b);
  const percentile = p => Number(times[Math.ceil(p * times.length) - 1].toFixed(2));
  return { p50: percentile(0.5), p95: percentile(0.95), checksum };
}

let temp;
let server;
try {
  if (ref) {
    const sha = execFileSync('git', ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], { cwd: root, encoding: 'utf8' }).trim();
    temp = await mkdtemp(join(tmpdir(), 'folio-bench-ui-'));
    const paths = execFileSync('git', ['ls-tree', '-r', '--name-only', sha, '--', 'src'], { cwd: root, encoding: 'utf8' }).split(/\r?\n/).filter(path => path.endsWith('.ts'));
    for (const path of paths) {
      const destination = join(temp, path);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, execFileSync('git', ['show', `${sha}:${path}`], { cwd: root }));
    }
  }
  server = await createServer({ root: temp ?? root, configFile: false, logLevel: 'error', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, watch: null, hmr: false } });
  const domain = await server.ssrLoadModule('/src/domain.ts');
  const { defaultCategories } = await server.ssrLoadModule('/src/categories.ts');
  for (const size of [100, 1000, 10000]) {
    const { records, attachments } = fixture(size);
    const prepare = () => projector(domain, defaultCategories, records, attachments);
    const browse = () => prepare()('', 'all');
    const firstQuery = () => prepare()('手机号 group-03', 'all');
    const project = prepare();
    const queryBatch = () => queries.reduce((sum, [query, view]) => sum + project(query, view), 0);
    browse();
    firstQuery();
    queryBatch();
    console.log(JSON.stringify({ revision: ref ?? 'working-tree', size, unit: 'ms', samples: 11, browse: measure(browse, 11), firstQuery: measure(firstQuery, 11), queryBatch: measure(queryBatch, 11) }));
  }
} finally {
  await server?.close();
  if (temp) await rm(temp, { recursive: true, force: true });
}
