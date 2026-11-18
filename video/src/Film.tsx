import {
  BookOpen,
  LibraryBig,
  Copy,
  FileText,
  Folders,
  Image,
  Languages,
  ListOrdered,
  Moon,
  Paperclip,
  Pin,
  Search,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
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

const chapterIcons: Record<string, LucideIcon> = {
  opening: BookOpen,
  organize: ShieldCheck,
  search: Search,
  edit: ListOrdered,
  import: Paperclip,
  image: Image,
  pin: Pin,
  pdf: FileText,
  files: Copy,
  collections: Folders,
  appearance: Moon,
  language: Languages,
  closing: LibraryBig,
};

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
  const ChapterIcon = chapterIcons[cue.id];
  const book = Math.max(1 - tween(time, 0.55, 0.8), tween(time, 58.05, 0.8));
  return (
    <AbsoluteFill className="film">
      <Audio src={staticFile('audio/folio.wav')} volume={0.82} />
      <div className="canvas">
        <div className="ruled" />
        <header className="mast">
          <b>Folio</b>
          <div className="chapter">
            <ChapterIcon size={30} strokeWidth={1.8} aria-hidden="true" />
            <span>{cue.label}</span>
          </div>
        </header>
        <div className="tabs" style={{ opacity: 1 - 0.65 * screen }}>
          {[0, 1, 2].map((i) => (
            <i
              key={i}
              style={{
                transform:
                  'translateY(' +
                  ((i - 1) * 11 + (1 - screen) * 45 * i) +
                  'px) rotate(' +
                  (i - 1) * (3 + book * 6) +
                  'deg)',
              }}
            />
          ))}
        </div>
        <div
          className="book"
          style={{
            opacity: book,
            transform: 'translateY(' + (1 - book) * -32 + 'px)',
          }}
        >
          <strong>Folio</strong>
        </div>
        <div className="stage">
          <div
            className="mac"
            style={{
              opacity: smooth((screen - 0.12) / 0.88),
              transform:
                'translate(' +
                moveX +
                'px,' +
                moveY +
                'px) scale(' +
                scale +
                ')',
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
        </div>
        <footer className="captions">
          <strong lang="en">{cue.en}</strong>
          <span lang="zh-CN">{cue.zh}</span>
        </footer>
      </div>
    </AbsoluteFill>
  );
}
