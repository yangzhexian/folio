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
const previewScale = .75;
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
  const session = JSON.parse(readFileSync(resolve(project, 'public/session/manifest.json')));
  const formatTime = seconds => {
    const milliseconds = Math.round(seconds * 1000);
    return `${String(Math.floor(milliseconds / 60000)).padStart(2, '0')}:${String(Math.floor(milliseconds / 1000) % 60).padStart(2, '0')}.${String(milliseconds % 1000).padStart(3, '0')}`;
  };
  const captions = {
    organize: 'Keep identity, education, experience, and supporting files together.',
    search: 'Search familiar words and synonyms. Copy the exact field value you need.',
    edit: 'Drag a field into place. Edit its value, then save the same record.',
    image: 'Open a PNG or JPG inside Folio. Zoom in, then fit the image to the view.',
    pdf: 'Switch directly to the next PDF attachment. Turn a page and zoom in.',
    files: 'Close the preview, rename the document, and copy its managed file path.',
    appearance: 'Choose dark mode and a new accent color.',
    language: 'Switch between English and Chinese while preserving your workspace.',
  };
  const captionCues = [{ time: 0, text: '[Soft instrumental music] Folio. Your details. Within reach.' }, ...session.cues.map(cue => ({ time: 3 + cue.time, text: captions[cue.id] })), { time: 3 + session.duration, text: 'Folio. Less searching. More ready. [Music fades]' }];
  writeFileSync(resolve(output, 'folio-intro.en.vtt'), 'WEBVTT\n\n' + captionCues.map((cue, index) => `${formatTime(cue.time)} --> ${formatTime(captionCues[index + 1]?.time ?? composition.durationInFrames / composition.fps)}\n${cue.text}\n`).join('\n'));
  const playerFile = resolve(output, 'index.html');
  const seconds = (composition.durationInFrames / composition.fps).toFixed(1);
  const player = readFileSync(playerFile, 'utf8').replace(/Folio product introduction, [\d.]+ seconds/g, `Folio product introduction, ${seconds} seconds`).replace(/<small>.*<\/small>/, `<small>${seconds} seconds, 2560 × 1440, 30 fps. One continuous application session, English titles and Chinese captions, original instrumental soundtrack. All records and attachments shown are fictional.</small>`);
  writeFileSync(playerFile, player);
  const shots = [...new Set([60, ...session.cues.map(cue => Math.round((3 + cue.time + 1.7) * 30)), 450, 558, 990, 1200, 1500, composition.durationInFrames - 60])].sort((a, b) => a - b);
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
    if (metadata.width !== 2560 || metadata.height !== 1440 || metadata.fps !== 30 || Math.abs(metadata.durationInSeconds - composition.durationInFrames / composition.fps) > .1 || !hasAudio) throw new Error(`Unexpected rendered video metadata: ${JSON.stringify(metadata)}`);
    const renderMetadata = { source: { file: 'video/public/session/continuous.mp4', durationSeconds: session.duration, viewport: session.viewport, continuous: true, cues: session.cues }, remotion: JSON.parse(readFileSync(resolve(project, 'node_modules/remotion/package.json'))).version, ...metadata, hasAudio };
    console.log(`Verified MP4: ${metadata.width}×${metadata.height}, ${metadata.durationInSeconds}s, audio ${metadata.audioCodec}.`);
    const preview = await selectComposition({ ...common, id: 'FolioPreview' });
    // A global palette without error-diffusion noise preserves crisp interface
    // text and lets unchanged rectangles compress efficiently in the long GIF.
    const gifFilter = 'split[v],palettegen,[v]paletteuse=dither=0:diff_mode=rectangle';
    await renderMedia({ ...common, composition: preview, codec: 'gif', scale: previewScale, concurrency: 4, outputLocation: resolve(output, 'folio-preview.gif'), onProgress: report('GIF'), ffmpegOverride: ({ args }) => args.map(argument => argument === 'split[v],palettegen,[v]paletteuse' ? gifFilter : argument) });
    writeFileSync(resolve(output, 'render-metadata.json'), JSON.stringify({ ...renderMetadata, preview: { file: 'docs/media/folio-preview.gif', width: preview.width * previewScale, height: preview.height * previewScale, fps: preview.fps, frames: preview.durationInFrames, durationSeconds: preview.durationInFrames / preview.fps, fullWorkflow: true, playbackRate: preview.props.playbackRate, dither: 'none', frameDifferenceMode: 'rectangle' } }, null, 2) + '\n');
    console.log(`Video, preview, and poster are ready in ${output}`);
  }
} finally {
  await browser.close({ silent: true });
}
