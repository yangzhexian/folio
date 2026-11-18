import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { createReadStream, readFileSync, statSync, writeFileSync } from 'node:fs';

import path from 'node:path';
import { ffmpeg, ffprobe, output, project, run, work } from './tools.mjs';

const directory = output;
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
const chapters = JSON.parse(
  readFileSync(path.join(project, 'src/story.json'), 'utf8'),
);
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
for (const name of ['folio-intro.mp4', 'folio-preview.gif']) {
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
  },
  files: decoded,
};
const generated = JSON.stringify(metadata, null, 2) + '\n';
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
  assert.equal(await player.count(), 1);
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
  for (const chapter of chapters.slice(1)) {
    const time = chapter.start + 0.5;
    await player.evaluate((video, seconds) => { video.currentTime = seconds; }, time);
    await page.waitForFunction((seconds) => {
      const video = document.querySelector('video');
      return !video.seeking && video.readyState >= 2 && Math.abs(video.currentTime - seconds) < 0.1;
    }, time);
  }
  await page.waitForFunction(() =>
    [...document.querySelector('video').textTracks].every((track) => track.cues?.length),
  );
  const meta = await player.evaluate((video) => ({
    width: video.videoWidth,
    height: video.videoHeight,
    duration: video.duration,
    tracks: [...video.textTracks].map((track) => ({
      language: track.language,
      cues: [...track.cues].map((cue) => ({
        text: cue.text,
        start: Math.round(cue.startTime * 1000),
        end: Math.round(cue.endTime * 1000),
      })),
    })),
  }));
  assert.deepEqual([meta.width, meta.height], [2560, 1440]);
  assert.ok(Math.abs(meta.duration - 60) < 0.1, 'Unexpected playback duration');
  assert.deepEqual(meta.tracks.map((track) => track.language), ['en', 'zh']);
  const starts = chapters.map((chapter) => {
    if (chapter.id === 'opening' || chapter.id === 'closing')
      return chapter.start * 1000;
    const action = recorded.cues.find((cue) => cue.id === chapter.id);
    assert.ok(action, 'Missing recorded action ' + chapter.id);
    return Math.round((3 + action.time) * 1000);
  });
  for (const track of meta.tracks) {
    const expected = chapters.map((chapter, index) => {
      const text = chapter[track.language];
      assert.ok(
        text.trim() && !/[\p{P}\p{S}\r\n]/u.test(text),
        'Expected one unpunctuated caption line for ' + chapter.id,
      );
      return { text, start: starts[index], end: starts[index + 1] ?? 60_000 };
    });
    assert.deepEqual(track.cues, expected, 'Caption timing or text differs from the composition');
  }
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  server.close();
}

const metadataFile = path.join(directory, 'render-metadata.json');
if (process.argv.includes('--update')) {
  writeFileSync(metadataFile, generated);
} else {
  assert.deepEqual(JSON.parse(readFileSync(metadataFile, 'utf8')), metadata, 'Update render metadata after exporting the new media');
}
writeFileSync(path.join(work, 'decoded-media.json'), generated);
console.log(JSON.stringify(decoded, null, 2));
console.log('Verified local playback, seeking, timed English and Chinese captions, and the full GIF.');
