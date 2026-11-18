import { copyFile, mkdir, link, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { ffmpeg, run } from './tools.mjs';

// Chrome timestamps describe sparse repaint events. Select the newest observed
// frame at each 30 Hz tick, including the final hold when the screen is idle.
export async function encodeCapture({
  frames,
  start,
  duration,
  directory,
  output,
}) {
  const sequence = join(directory, 'cfr');
  await mkdir(sequence, { recursive: true });
  let index = 0;
  for (let frame = 0; frame < duration * 30; frame++) {
    const when = start + frame / 30;
    while (index + 1 < frames.length && frames[index + 1].time <= when) index++;
    const source = join(directory, frames[index].name);
    const target = join(sequence, String(frame).padStart(5, '0') + '.jpg');
    try {
      await unlink(target);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    try {
      await link(source, target);
    } catch {
      await copyFile(source, target);
    }
  }
  run(ffmpeg, [
    '-y',
    '-v',
    'error',
    '-framerate',
    '30',
    '-start_number',
    '0',
    '-i',
    join(sequence, '%05d.jpg'),
    '-frames:v',
    String(duration * 30),
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-crf',
    '15',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    output,
  ]);
}
