import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { ffmpeg, output, project, work, run } from './tools.mjs';

const video = join(output, 'folio-intro.mp4');
const gif = join(output, 'folio-preview.gif');
const palette = join(work, 'folio-palette.png');
const source = ['-v', 'error', '-y', '-i', video];
const scale = 'fps=12,scale=1920:1080:flags=lanczos';
run(ffmpeg, [
  ...source,
  '-vf',
  scale + ',palettegen=stats_mode=diff',
  '-frames:v',
  '1',
  palette,
]);
run(ffmpeg, [
  ...source,
  '-i',
  palette,
  '-lavfi',
  scale + '[small];[small][1:v]paletteuse=dither=none:diff_mode=rectangle',
  '-loop',
  '0',
  gif,
]);
run(ffmpeg, [
  '-v',
  'error',
  '-y',
  '-ss',
  '24',
  '-i',
  video,
  '-vf',
  'scale=1920:1080:flags=lanczos',
  '-frames:v',
  '1',
  join(output, 'folio-poster.png'),
]);
const cues = JSON.parse(
  readFileSync(join(project, 'src/story.json'), 'utf8'),
);
const session = JSON.parse(
  readFileSync(join(project, 'public/session/manifest.json'), 'utf8'),
);
for (const cue of cues)
  cue.start =
    3 + (session.cues.find((c) => c.id === cue.id)?.time ?? cue.start - 3);
const time = (seconds) =>
  new Date(Math.round(seconds * 1000)).toISOString().slice(11, 23);
for (const lang of ['en', 'zh']) {
  writeFileSync(
    join(output, 'folio-intro.' + lang + '.vtt'),
    'WEBVTT\n\n' +
      cues
        .map(
          (cue, i) =>
            time(cue.start) +
            ' --> ' +
            time(cues[i + 1]?.start ?? 60) +
            '\n' +
            cue[lang] +
            '\n',
        )
        .join('\n'),
  );
}
console.log('Exported the full-length GIF, poster and caption tracks.');
