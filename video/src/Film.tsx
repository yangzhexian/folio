import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
} from 'remotion';
import story from './story.json';
import session from '../public/session/manifest.json';
import './film.css';

const smooth = (t: number) => {
  const v = Math.max(0, Math.min(1, t));
  return v * v * (3 - 2 * v);
};
const tween = (time: number, at: number, span: number) =>
  smooth((time - at) / span);
const steps = story.map((cue) => ({
  ...cue,
  start: ['opening', 'closing'].includes(cue.id)
    ? cue.start
    : 3 + (session.cues.find((c) => c.id === cue.id)?.time ?? cue.start - 3),
}));
function focus(time: number, at: number, until: number) {
  return tween(time, at, 1.2) * (1 - tween(time, until, 1.3));
}

export function FolioFilm() {
  const frame = useCurrentFrame();
  const time = frame / 30;
  const arrival = tween(time, 0.6, 2.35);
  const departure = tween(time, 56.9, 2.1);
  const screen = arrival * (1 - departure);
  const search = focus(time, 5.9, 10.5);
  const file = focus(time, 24.6, 27.6) + focus(time, 32.5, 39.4);
  const edit = focus(time, 12, 20.9);
  const moveX = -158 * file + 166 * search;
  const moveY = 132 * search + 82 * (1 - arrival) - 21 * file;
  const scale =
    0.22 + 0.78 * screen + 0.29 * search + 0.12 * edit + 0.235 * file;
  const cue = steps.filter((c) => c.start <= time).at(-1)!;
  const caption = smooth((time - cue.start) / 0.48);
  const book = Math.max(1 - tween(time, 0.65, 1.75), departure);
  return (
    <AbsoluteFill className="film">
      <Audio src={staticFile('audio/folio.wav')} volume={0.82} />
      <div className="canvas">
        <div className="ruled" />
        <header className="mast">
          <b>
            folio<span>.</span>
          </b>
          <span>DESKTOP FIELD GUIDE</span>
        </header>
        <div className="tabs" style={{ opacity: 1 - 0.65 * screen }}>
          {['01', '02', '03'].map((n, i) => (
            <i
              key={n}
              style={{
                transform:
                  'translateY(' +
                  ((i - 1) * 11 + (1 - screen) * 45 * i) +
                  'px) rotate(' +
                  (i - 1) * (3 + book * 6) +
                  'deg)',
              }}
            >
              {n}
            </i>
          ))}
        </div>
        <div
          className="book"
          style={{
            opacity: book,
            transform: 'translateY(' + (1 - book) * -32 + 'px)',
          }}
        >
          <small>PERSONAL INFORMATION LIBRARY</small>
          <strong>
            Folio<span>.</span>
          </strong>
          <em>
            {time < 30
              ? 'A field guide to your details'
              : 'Everything in its place'}
          </em>
        </div>
        <div
          className="mac"
          style={{
            opacity: screen,
            transform:
              'translate(' + moveX + 'px,' + moveY + 'px) scale(' + scale + ')',
          }}
        >
          <div className="chrome">
            <i />
            <i />
            <i />
            <b>Folio</b>
          </div>
          <div className="display">
            {frame < 90 && <Img src={staticFile('session/opening.png')} />}
            <Sequence from={90} durationInFrames={1620} layout="none">
              <OffthreadVideo
                src={staticFile('session/continuous.mp4')}
                muted
              />
            </Sequence>
            {frame >= 1710 && <Img src={staticFile('session/closing.png')} />}
          </div>
        </div>
        <footer>
          <div
            className="chapter"
            style={{
              opacity: caption,
              transform: 'translateY(' + (1 - caption) * 10 + 'px)',
            }}
          >
            <i />
            {cue.label}
          </div>
          <div className="captions" style={{ opacity: caption }}>
            <strong>{cue.en}</strong>
            <span>{cue.zh}</span>
          </div>
          <div className="meter">
            {Math.floor(time).toString().padStart(2, '0')} / 60
            <div>
              <b style={{ width: (time / 60) * 100 + '%' }} />
            </div>
          </div>
        </footer>
      </div>
    </AbsoluteFill>
  );
}
