import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { createReadStream, readFileSync, statSync, writeFileSync } from 'node:fs';

import { ffmpeg, ffprobe, project, run, work } from './tools.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const directory = path.join(root, 'docs/media');
const contentTypes = {
  '.html': 'text/html',
  '.mp4': 'video/mp4',
  '.vtt': 'text/vtt',
  '.png': 'image/png',
  '.gif': 'image/gif',
};
const recorded = JSON.parse(
  readFileSync(path.join(project, 'public/session/manifest.json'), 'utf8'),
);
const chapterCount = JSON.parse(
  readFileSync(path.join(project, 'src/story.json'), 'utf8'),
).length;
const source = JSON.parse(
  run(
    ffprobe,
    [
      '-v',
      'error',
      '-count_frames',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height,duration,nb_read_frames',
      '-of',
      'json',
      path.join(project, 'public/session/continuous.mp4'),
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  ),
).streams[0];
if (
  source.width !== recorded.viewport.width ||
  source.height !== recorded.viewport.height ||
  Number(source.nb_read_frames) !== recorded.encodedFrames ||
  Math.abs(Number(source.duration) - recorded.duration) > 0.001
)
  throw new Error(
    'The source recording differs from its measured timing manifest.',
  );
const decoded = [];
for (const name of [
  'folio-intro.mp4',
  'folio-hyperframes.mp4',
  'folio-preview.gif',
  'folio-hyperframes.gif',
]) {
  const file = path.join(directory, name);
  const gif = name.endsWith('.gif');
  // count_frames makes ffprobe decode every frame, including GIF disposal and timing.
  const result = run(
    ffprobe,
    [
      '-v',
      'error',
      '-count_frames',
      '-show_entries',
      'stream=codec_type,codec_name,width,height,duration,nb_read_frames,r_frame_rate:format=duration',
      '-of',
      'json',
      file,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  );
  const probe = JSON.parse(result);
  const v = probe.streams.find((s) => s.codec_type === 'video');
  const a = probe.streams.find((s) => s.codec_type === 'audio');
  const duration = Number(probe.format.duration);
  const frames = Number(v?.nb_read_frames);
  if (
    !v ||
    v.codec_name !== (gif ? 'gif' : 'h264') ||
    v.width !== (gif ? 1920 : 2560) ||
    v.height !== (gif ? 1080 : 1440) ||
    Math.abs(duration - 60) > 0.11 ||
    frames !== (gif ? 720 : 1800) ||
    (!gif &&
      (a?.codec_name !== 'aac' ||
        v.r_frame_rate !== '30/1' ||
        Math.abs(Number(a.duration) - 60) > 0.11)) ||
    (gif && a)
  )
    throw new Error(name + ': ' + result);
  if (!gif)
    run(ffmpeg, [
      '-v',
      'error',
      '-xerror',
      '-i',
      file,
      '-map',
      '0:a',
      '-f',
      'null',
      '-',
    ]);
  decoded.push({
    name,
    width: v.width,
    height: v.height,
    frames,
    durationSeconds: duration,
    frameRate: frames / 60,
    videoCodec: v.codec_name,
    audioCodec: a?.codec_name ?? null,
    bytes: statSync(file).size,
  });
}
const metadata = {
  durationSeconds: 60,
  source: 'video/public/session/continuous.mp4',
  sourceDurationSeconds: recorded.duration,
  versions: {
    remotion: JSON.parse(
      readFileSync(path.join(project, 'node_modules/remotion/package.json')),
    ).version,
    hyperframes: JSON.parse(
      readFileSync(path.join(project, 'node_modules/hyperframes/package.json')),
    ).version,
  },
  files: decoded,
};
const generated = JSON.stringify(metadata, null, 2) + '\n';
if (process.argv.includes('--update'))
  writeFileSync(path.join(directory, 'render-metadata.json'), generated);
else if (
  JSON.stringify(
    JSON.parse(
      readFileSync(path.join(directory, 'render-metadata.json'), 'utf8'),
    ),
  ) !== JSON.stringify(metadata)
)
  throw new Error(
    'Media metadata is out of date. Run video verification with --update after rendering.',
  );
writeFileSync(path.join(work, 'decoded-media.json'), generated);
console.log(JSON.stringify(decoded, null, 2));
const server = createServer(async (request, response) => {
  const fileName =
    decodeURIComponent(
      new URL(request.url, 'http://localhost').pathname,
    ).replace(/^\//, '') || 'index.html';
  const file = path.resolve(directory, fileName);
  if (!file.startsWith(directory + path.sep)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const size = statSync(file).size;
    const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? '');
    response.setHeader(
      'Content-Type',
      contentTypes[path.extname(file)] ?? 'application/octet-stream',
    );
    response.setHeader('Accept-Ranges', 'bytes');
    if (range) {
      const start = Number(range[1]);
      const end = Math.min(size - 1, range[2] ? Number(range[2]) : size - 1);
      response.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Content-Length': end - start + 1,
      });
      createReadStream(file, { start, end }).pipe(response);
    } else {
      response.writeHead(200, { 'Content-Length': size });
      createReadStream(file).pipe(response);
    }
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome',
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin);
  const player = page.locator('video');
  await page.waitForFunction(
    () => document.querySelector('video').readyState >= 2,
  );
  await player.evaluate(async (v) => {
    v.muted = true;
    v.textTracks[0].mode = 'hidden';
    v.textTracks[1].mode = 'hidden';
    await v.play();
  });
  await page.waitForFunction(
    () => document.querySelector('video').currentTime > 0.2,
  );
  await player.evaluate((v) => v.pause());
  for (const version of ['remotion', 'hyperframes']) {
    await page
      .getByRole('button', {
        name: version === 'remotion' ? /Field Guide/ : /Night Desk/,
      })
      .click();
    await page.waitForFunction(
      (v) =>
        document.querySelector('video').currentSrc.includes(v) &&
        document.querySelector('video').readyState >= 2,
      version === 'remotion' ? 'folio-intro' : 'folio-hyperframes',
    );
    if (version === 'hyperframes') {
      await page.waitForFunction(
        () => Math.abs(document.querySelector('video').currentTime - 58) < 0.2,
      );
    }
    for (const time of [6, 15, 24, 31, 42, 52, 58]) {
      await player.evaluate(
        (v, t) =>
          new Promise((resolve) => {
            if (Math.abs(v.currentTime - t) < 0.05) {
              resolve();
              return;
            }
            v.addEventListener('seeked', resolve, { once: true });
            v.currentTime = t;
          }),
        time,
      );
      await page.waitForFunction(
        () =>
          document.querySelector('video').readyState >= 2 &&
          !document.querySelector('video').seeking,
      );
    }
    const meta = await player.evaluate((v) => ({
      width: v.videoWidth,
      height: v.videoHeight,
      duration: v.duration,
      cues: [...v.textTracks].map((t) => t.cues?.length),
    }));
    if (
      meta.width !== 2560 ||
      meta.height !== 1440 ||
      Math.abs(meta.duration - 60) > 0.1 ||
      meta.cues.some((n) => n !== chapterCount)
    )
      throw new Error('Invalid player: ' + JSON.stringify(meta));
  }
  if (errors.length) throw new Error(JSON.stringify(errors));
  console.log(
    'Both versions play and seek in Chrome. Timestamp switching and both caption tracks passed.',
  );
} finally {
  await browser?.close();
  server.close();
}
