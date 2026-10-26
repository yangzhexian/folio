import React from 'react';
import { AbsoluteFill, Audio, Easing, Img, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import session from '../public/session/manifest.json';

const palette = { paper: '#f3f4ed', ink: '#203d32', sage: '#4d6b50', muted: '#70816e', line: '#d8e1d0' };
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const ease = (value: number, start: number, end: number) => interpolate(value, [start, end], [0, 1], { ...clamp, easing: Easing.bezier(.22, .7, .2, 1) });
export const introSeconds = 3;
export const outroSeconds = 4;
export const movieFrames = Math.round((session.duration + introSeconds + outroSeconds) * 30);
export const previewPlaybackRate = 1;
const chapters = [
  { id: 'organize', label: 'YOUR PERSONAL LIBRARY', lines: ['One place.', 'Every detail.'], detail: 'Identity, education, experience, and the files behind them.', zh: '个人资料与附件，在一个简洁的空间里整理。' },
  { id: 'search', label: 'FIND AND COPY', lines: ['Find the field.', 'Keep your flow.'], detail: 'Search familiar words. Copy the exact value you need.', zh: '输入熟悉的关键词，检索字段并直接复制。' },
  { id: 'edit', label: 'EDIT AND ARRANGE', lines: ['Your details.', 'Your order.'], detail: 'Drag fields into place. Update a value. Save and carry on.', zh: '拖动调整字段顺序，编辑后即可保存。' },
  { id: 'image', label: 'BUILT-IN IMAGE PREVIEW', lines: ['Open it here.', 'Look closer.'], detail: 'Preview PNG and JPG images. Zoom in, then fit the view.', zh: '直接预览 PNG、JPG 图片，放大查看并恢复适应窗口。' },
  { id: 'pdf', label: 'DOCUMENTS, IN CONTEXT', lines: ['Next file.', 'Next page.'], detail: 'Switch from an image to a PDF. Turn pages without leaving Folio.', zh: '从图片连续切换到 PDF，翻页、缩放，无需离开 Folio。' },
  { id: 'files', label: 'CLEAR NAMES, QUICK ACCESS', lines: ['Name it well.', 'Take the path.'], detail: 'Rename the same document and copy its managed file path.', zh: '为同一份附件规范命名，随手复制文件路径。' },
  { id: 'appearance', label: 'MAKE THE SPACE YOURS', lines: ['A familiar space.', 'In your style.'], detail: 'Light or dark. Five accents. English and 中文.', zh: '明暗主题、五种配色，中英文随时切换。' },
  { id: 'language', label: 'ENGLISH AND 中文', lines: ['Same details.', 'Your language.'], detail: 'Change the interface language. Your workspace stays with you.', zh: '切换界面语言，资料、主题和操作状态保持连贯。' },
];

function Brand() {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}><svg width="48" height="48" viewBox="0 0 48 48" fill="none"><path d="M24 12C18 7 10 7 5 10v26c6-3 13-3 19 2m0-26c6-5 14-5 19-2v26c-6-3-13-3-19 2m0-26v26" stroke={palette.sage} strokeWidth="2.5" strokeLinejoin="round"/></svg><span style={{ fontSize: 58, fontWeight: 720, letterSpacing: -4 }}>folio<span style={{ color: '#90a277' }}>.</span></span></div>;
}

function Backdrop({ seconds }: { seconds: number }) {
  return <AbsoluteFill style={{ background: palette.paper }}><div style={{ position: 'absolute', width: 1100, height: 1100, border: `1px solid ${palette.line}`, borderRadius: '50%', right: -260, top: -500, transform: `translateY(${Math.sin(seconds / 6) * 16}px)` }}/><div style={{ position: 'absolute', width: 680, height: 680, border: '1px solid #dfe6d7', borderRadius: '50%', left: -380, bottom: -430 }}/><div style={{ position: 'absolute', width: 520, height: 520, background: '#c4d4ad38', borderRadius: '50%', filter: 'blur(95px)', right: 200, top: 150 }}/></AbsoluteFill>;
}

// The right-hand window has one video element for the whole demonstration.
// A single uniform playback rate keeps the cursor, captions, and camera in sync.
// Camera motion never swaps, resets, or crossfades application frames.
function AppWindow({ seconds, playbackRate, fps }: { seconds: number; playbackRate: number; fps: number }) {
  const local = seconds - introSeconds;
  const enter = ease(seconds, .15, 1.7);
  const finish = ease(local, session.duration, session.duration + 2.2);
  const closeLook = ease(local, 2, 5) * (1 - ease(local, 16, 19));
  const scale = 1 + closeLook * .012;
  return <div style={{ position: 'absolute', left: 574, top: 132, width: 1280, opacity: enter * (1 - finish * .23), transform: `translateY(${(1 - enter) * 36}px) scale(${1 - finish * .015})`, transformOrigin: 'center center', borderRadius: 15, border: '1px solid #cbd6c3', overflow: 'hidden', background: '#fbfcf8', boxShadow: '0 28px 70px #203d3225, 0 4px 16px #203d3215' }}>
    <div style={{ height: 32, background: '#e8eee1', display: 'flex', alignItems: 'center', padding: '0 14px', gap: 6, borderBottom: '1px solid #dbe3d3' }}>{['#bac6b1', '#cbd4bf', '#d8dfcc'].map(color => <span key={color} style={{ display: 'block', width: 7, height: 7, borderRadius: '50%', background: color }}/>) }<span style={{ position: 'absolute', width: 100, left: 590, textAlign: 'center', fontSize: 12, letterSpacing: 2, color: '#6c7d65' }}>FOLIO</span></div>
    <div style={{ width: 1280, height: 800, overflow: 'hidden', position: 'relative' }}><div style={{ width: '100%', height: '100%', transform: `scale(${scale})`, transformOrigin: '52% 28%' }}>
        {local < 0 && <Img src={staticFile('session/opening.png')} style={{ width: '100%', height: '100%' }}/>}
        <Sequence from={Math.round(introSeconds * fps / playbackRate)} durationInFrames={Math.round(session.duration * fps / playbackRate)} layout="none"><OffthreadVideo src={staticFile('session/continuous.mp4')} playbackRate={playbackRate} muted style={{ width: '100%', height: '100%' }}/></Sequence>
        {local >= session.duration && <Img src={staticFile('session/closing.png')} style={{ width: '100%', height: '100%' }}/>}
    </div></div>
  </div>;
}

export const FolioFilm: React.FC<{ preview: boolean; sound: boolean; playbackRate?: number }> = ({ preview, sound, playbackRate = preview ? previewPlaybackRate : 1 }) => {
  const raw = useCurrentFrame(); const { fps } = useVideoConfig();
  const seconds = raw / fps * playbackRate;
  const local = seconds - introSeconds;
  const chapterIndex = Math.max(0, session.cues.reduce((last, cue, index) => cue.time <= local ? index : last, -1));
  const chapter = chapters[chapterIndex];
  const cueStart = session.cues[chapterIndex].time;
  const intro = local < 0;
  const outro = local >= session.duration;
  const title = intro ? ['Everything.', 'Within reach.'] : outro ? ['Less searching.', 'More ready.'] : chapter.lines;
  const label = intro ? 'MEET FOLIO' : outro ? 'FOLIO 0.4.1' : chapter.label;
  const detail = intro ? 'Your details and documents, beautifully within reach.' : outro ? 'A personal library that moves at your pace.' : chapter.detail;
  const zh = intro ? 'Folio，让个人资料与文件触手可及。' : outro ? '让资料有序，让使用更轻松。' : chapter.zh;
  const textEnter = intro ? ease(seconds, .1, .7) : outro ? ease(local - session.duration, 0, .5) : ease(local - cueStart, 0, .24);
  return <AbsoluteFill style={{ fontFamily: '"Segoe UI", "Microsoft YaHei", Arial, sans-serif', background: palette.paper, overflow: 'hidden', color: palette.ink }}>
    {sound && <Audio src={staticFile('audio/folio.wav')} volume={.7}/>}
    <div style={{ position: 'absolute', left: 0, top: 0, width: 1920, height: 1080, transform: 'scale(1.3333333333)', transformOrigin: 'top left' }}>
      <Backdrop seconds={seconds}/>
      <div style={{ position: 'absolute', left: 66, top: 43 }}><Brand/></div>
      <div style={{ position: 'absolute', right: 68, top: 69, fontSize: 14, letterSpacing: 2.4, color: palette.muted }}>YOUR DETAILS. WITHIN REACH.</div>
      <div style={{ position: 'absolute', left: 68, top: 300, width: 438, opacity: textEnter, transform: `translateY(${(1 - textEnter) * 12}px)` }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 28 }}><span style={{ height: 1, width: 32, background: palette.sage }}/><span style={{ fontSize: 15, fontWeight: 650, letterSpacing: 1.5, color: palette.sage }}>{label}</span></div>
        <div style={{ fontSize: 61, fontWeight: 630, letterSpacing: -2.8, lineHeight: 1.16 }}>{title.map(line => <div key={line}>{line}</div>)}</div>
        <p style={{ fontSize: 24, lineHeight: 1.5, color: palette.muted, margin: '28px 20px 0 0', maxWidth: 385 }}>{detail}</p>
        {outro && <div style={{ marginTop: 34, fontSize: 17, color: palette.sage }}>TAURI + REACT + SQLITE</div>}
      </div>
      <AppWindow seconds={seconds} playbackRate={playbackRate} fps={fps}/>
      <div style={{ position: 'absolute', left: 68, bottom: 116, fontSize: 13, letterSpacing: 2, color: '#7b8b76' }}>FOLIO / CONTINUOUS PRODUCT TOUR</div>
      {!intro && !outro && <div style={{ position: 'absolute', left: 68, bottom: 160, display: 'flex', gap: 8 }}>{chapters.map((item, index) => <span key={item.id} style={{ width: index === chapterIndex ? 30 : 10, height: 3, background: index === chapterIndex ? palette.sage : '#ced8c6', borderRadius: 3 }}/>)}</div>}
      <div style={{ position: 'absolute', bottom: 36, left: 0, width: 1920, textAlign: 'center', fontSize: 23, color: '#5b705a', letterSpacing: .5 }}>{zh}</div>
      <div style={{ position: 'absolute', bottom: 0, left: 0, height: 3, width: `${seconds / (movieFrames / 30) * 100}%`, background: '#6d8a5e', opacity: .5 }}/>
    </div>
  </AbsoluteFill>;
};
