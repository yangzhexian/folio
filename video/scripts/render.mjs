import { bundle } from '@remotion/bundler';
import {
  openBrowser,
  renderMedia,
  renderStill,
  selectComposition,
} from '@remotion/renderer';
import { join } from 'node:path';
import { chrome, project, output, work } from './tools.mjs';

const proof = process.argv.includes('--proof');
const stills = process.argv.includes('--stills');
const browser = await openBrowser('chrome', { browserExecutable: chrome });
try {
  const serveUrl = await bundle({
    entryPoint: join(project, 'src/index.tsx'),
    rootDir: project,
    publicDir: join(project, 'public'),
    outDir: join(project, '.bundle'),
  });
  const common = {
    serveUrl,
    puppeteerInstance: browser,
    browserExecutable: chrome,
    logLevel: 'warn',
  };
  const composition = await selectComposition({ ...common, id: 'FolioIntro' });
  if (stills) {
    for (const frame of [30, 210, 450, 716, 870, 1110, 1290, 1575, 1760]) {
      await renderStill({
        ...common,
        composition,
        frame,
        output: join(work, 'remotion-' + frame + '.png'),
      });
    }
  } else {
    let previous = -1;
    await renderMedia({
      ...common,
      composition,
      codec: 'h264',
      crf: 19,
      pixelFormat: 'yuv420p',
      audioCodec: 'aac',
      audioBitrate: '160k',
      concurrency: Number(process.env.FOLIO_RENDER_WORKERS ?? 4),
      frameRange: proof ? [0, 179] : undefined,
      outputLocation: join(
        proof ? work : output,
        proof ? 'remotion-proof.mp4' : 'folio-intro.mp4',
      ),
      onProgress: ({ progress }) => {
        const pct = Math.floor(progress * 20) * 5;
        if (pct !== previous) {
          console.log('Remotion ' + pct + '%');
          previous = pct;
        }
      },
    });
  }
} finally {
  await browser.close({ silent: true });
}
