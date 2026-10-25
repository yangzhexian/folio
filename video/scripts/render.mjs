import { bundle } from '@remotion/bundler';
import { getVideoMetadata, openBrowser, renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(project, '..');
const output = resolve(repo, 'docs/media');
const stillsOnly = process.argv.includes('--stills');
const previewOnly = process.argv.includes('--preview');
mkdirSync(output, { recursive: true });
const checkDir = resolve(repo, 'artifacts/video-check');
mkdirSync(checkDir, { recursive: true });

const candidates = [process.env.REMOTION_BROWSER_EXECUTABLE, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean);
const browserExecutable = candidates.find(path => existsSync(path));
const serveUrl = await bundle({ entryPoint: resolve(project, 'src/index.tsx'), rootDir: project, publicDir: resolve(project, 'public'), outDir: resolve(project, '.bundle') });
const browser = await openBrowser('chrome', { browserExecutable });
const common = { serveUrl, puppeteerInstance: browser, browserExecutable, logLevel: 'warn' };

try {
  const composition = await selectComposition({ ...common, id: 'FolioIntro' });
  const shots = [60, 210, 430, 615, 690, 840, 990, 1060, 1190];
  for (const frame of shots) {
    await renderStill({ ...common, composition, frame, imageFormat: 'png', output: resolve(checkDir, `frame-${String(frame).padStart(4, '0')}.png`) });
  }
  await renderStill({ ...common, composition, frame: 60, imageFormat: 'png', output: resolve(output, 'folio-poster.png') });
  console.log(`Rendered ${shots.length} review frames and the poster.`);
  if (stillsOnly) process.exitCode = 0;
  else {
    const report = (label) => {
      let previous = -1;
      return ({ progress }) => {
        const step = Math.floor(progress * 10);
        if (step > previous) { previous = step; console.log(`${label}: ${Math.min(step * 10, 100)}%`); }
      };
    };
    if (!previewOnly) {
      await renderMedia({ ...common, composition, codec: 'h264', crf: 20, pixelFormat: 'yuv420p', audioCodec: 'aac', audioBitrate: '192k', concurrency: 4, outputLocation: resolve(output, 'folio-intro.mp4'), onProgress: report('MP4'), metadata: { title: 'Folio — Your details. Within reach.', comment: 'Created with Remotion. Synthetic demonstration data; no personal vault contents.' } });
    }
    const metadata = await getVideoMetadata(resolve(output, 'folio-intro.mp4'));
    const hasAudio = metadata.audioCodec === 'aac';
    if (metadata.width !== 1920 || metadata.height !== 1080 || metadata.fps !== 30 || Math.abs(metadata.durationInSeconds - 42) > .1 || !hasAudio) throw new Error(`Unexpected rendered video metadata: ${JSON.stringify(metadata)}`);
    writeFileSync(resolve(output, 'render-metadata.json'), JSON.stringify({ remotion: JSON.parse(readFileSync(resolve(project, 'node_modules/remotion/package.json'))).version, ...metadata, hasAudio }, null, 2) + '\n');
    console.log(`Verified MP4: ${metadata.width}×${metadata.height}, ${metadata.durationInSeconds}s, audio ${metadata.audioCodec}.`);
    const preview = await selectComposition({ ...common, id: 'FolioPreview' });
    await renderMedia({ ...common, composition: preview, codec: 'gif', scale: .5, concurrency: 4, outputLocation: resolve(output, 'folio-preview.gif'), onProgress: report('GIF') });
    console.log(`Video, preview, and poster are ready in ${output}`);
  }
} finally {
  await browser.close({ silent: true });
}
