import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, delimiter, join } from 'node:path';
import {
  chrome,
  ffmpeg,
  ffprobe,
  project,
  output,
  work,
  run,
} from './tools.mjs';

const proof = process.argv.includes('--proof');
const duration = proof ? 6 : 60;
const folder = join(work, proof ? 'hyperframes-proof' : 'hyperframes');
const assets = join(folder, 'assets');
mkdirSync(assets, { recursive: true });
for (const asset of ['continuous.mp4', 'opening.png', 'closing.png'])
  copyFileSync(join(project, 'public/session', asset), join(assets, asset));
copyFileSync(
  join(project, 'public/audio/folio.wav'),
  join(assets, 'folio.wav'),
);
copyFileSync(
  join(project, 'node_modules/gsap/dist/gsap.min.js'),
  join(assets, 'gsap.min.js'),
);
const cues = JSON.parse(readFileSync(join(project, 'src/story.json'), 'utf8'));
const session = JSON.parse(
  readFileSync(join(project, 'public/session/manifest.json'), 'utf8'),
);
for (const cue of cues) {
  const recorded = session.cues.find((c) => c.id === cue.id);
  if (recorded) cue.start = 3 + recorded.time;
}
const chapters = cues.filter((c) => c.start < duration);
const captions = chapters
  .map(
    (c) =>
      '<div class="cue" id="cue-' +
      c.id +
      '"><em>' +
      c.label +
      '</em><strong>' +
      c.en +
      '</strong><span>' +
      c.zh +
      '</span></div>',
  )
  .join('\n');
const animations = chapters
  .map(
    (c, i) =>
      "tl.fromTo('#cue-" +
      c.id +
      "',{opacity:0,y:10},{opacity:1,y:0,immediateRender:false,duration:.36}," +
      c.start +
      ");tl.set('#cue-" +
      c.id +
      "',{opacity:0}," +
      (chapters[i + 1]?.start ?? duration) +
      ');',
  )
  .join('\n');
const html = readFileSync(join(project, 'hyperframes.html'), 'utf8')
  .replaceAll('@DURATION@', String(duration))
  .replaceAll('@VIDEO_START@', '3')
  .replaceAll('@VIDEO_LENGTH@', String(duration - (proof ? 3 : 6)))
  .replace('@CAPTIONS@', captions)
  .replace(
    '/* GENERATED_CAPTIONS */',
    "tl.set('.cue',{opacity:0},0);\n" + animations,
  );
writeFileSync(join(folder, 'index.html'), html);
const cli = join(project, 'node_modules/hyperframes/bin/hyperframes.mjs');
const env = {
  ...process.env,
  PATH: dirname(ffmpeg) + delimiter + process.env.PATH,
  HYPERFRAMES_FFMPEG_PATH: ffmpeg,
  HYPERFRAMES_FFPROBE_PATH: ffprobe,
  DO_NOT_TRACK: '1',
  PRODUCER_HEADLESS_SHELL_PATH: chrome ?? '',
};
run(
  process.execPath,
  [
    cli,
    'render',
    folder,
    '--output',
    join(
      proof ? work : output,
      proof ? 'hyperframes-proof.mp4' : 'folio-hyperframes.mp4',
    ),
    '--fps',
    '30',
    '--workers',
    process.env.FOLIO_RENDER_WORKERS ?? '3',
    '--quality',
    'standard',
    '--frames-cache-dir',
    join(work, 'hf-cache'),
  ],
  { env },
);
