import React from 'react';
import { AbsoluteFill, Audio, Easing, Img, interpolate, staticFile, useCurrentFrame } from 'remotion';
import captures from '../public/screens/manifest.json';

const colors = { paper: '#f3f4ed', ink: '#203d32', sage: '#4d6b50', muted: '#718173', line: '#d9e0d3', soft: '#e3eadc' };
const font = '"Segoe UI", "Microsoft YaHei", Arial, sans-serif';
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const ease = (frame: number, start: number, end: number) => interpolate(frame, [start, end], [0, 1], { ...clamp, easing: Easing.bezier(.22, .7, .2, 1) });
const fade = (frame: number, duration: number) => Math.min(ease(frame, 0, 16), 1 - ease(frame, duration - 14, duration));
type Capture = keyof typeof captures.screens;
type Rect = { x: number; y: number; width: number; height: number };
const screenRatio = 1312 / captures.viewport.width;
const target = (screen: Capture, name: string) => {
  const rect = (captures.screens[screen].rects as Record<string, Rect>)[name];
  if (!rect) throw new Error(`Missing capture target: ${screen}.${name}`);
  return { x: rect.x * screenRatio, y: rect.y * screenRatio, width: rect.width * screenRatio, height: rect.height * screenRatio };
};
const center = (screen: Capture, name: string) => {
  const rect = target(screen, name);
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
};

function Book({ size = 54, color = colors.sage }: { size?: number; color?: string }) {
  return <svg width={size} height={size} viewBox="0 0 48 48" fill="none"><path d="M24 12C18 7 10 7 5 10v26c6-3 13-3 19 2m0-26c6-5 14-5 19-2v26c-6-3-13-3-19 2m0-26v26" stroke={color} strokeWidth="2.6" strokeLinejoin="round"/></svg>;
}

function Brand({ large = false, inverted = false }: { large?: boolean; inverted?: boolean }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: large ? 26 : 13, color: inverted ? '#eff4e9' : colors.ink }}><Book size={large ? 116 : 45} color={inverted ? '#b9cfaa' : colors.sage}/><div style={{ fontSize: large ? 172 : 54, fontWeight: 720, letterSpacing: large ? -12 : -3.5, lineHeight: 1 }}>folio<span style={{ color: inverted ? '#c5d3a5' : '#90a277' }}>.</span></div></div>;
}

function Backdrop({ frame, dark = false }: { frame: number; dark?: boolean }) {
  return <AbsoluteFill style={{ background: dark ? '#172d26' : colors.paper, overflow: 'hidden' }}>
    <div style={{ position: 'absolute', width: 1250, height: 1250, border: `1px solid ${dark ? '#42604b' : '#d8e1d0'}`, borderRadius: '50%', right: -260, top: -400, transform: `translateY(${Math.sin(frame / 140) * 20}px)` }}/>
    <div style={{ position: 'absolute', width: 890, height: 890, border: `1px solid ${dark ? '#36513f' : '#e0e6d7'}`, borderRadius: '50%', left: -460, bottom: -540 }}/>
    <div style={{ position: 'absolute', right: 140, top: 120, width: 520, height: 520, background: dark ? '#56744722' : '#c3d3ad44', borderRadius: '50%', filter: 'blur(100px)' }}/>
  </AbsoluteFill>;
}

function Caption({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return <div style={{ position: 'absolute', bottom: 33, left: 60, right: 60, display: 'flex', justifyContent: 'center' }}><div style={{ padding: '10px 25px', borderRadius: 24, color: dark ? '#e0e9d7' : '#485d4d', fontSize: 23, letterSpacing: 1, background: dark ? '#10271ed9' : '#f3f4edee' }}>{children}</div></div>;
}

function Chapter({ number, title, lines, detail, frame, dark = false }: { number: string; title: string; lines: string[]; detail: string; frame: number; dark?: boolean }) {
  const reveal = ease(frame, 5, 33);
  return <div style={{ position: 'absolute', top: 316, left: 66, width: 410, transform: `translateY(${(1 - reveal) * 26}px)`, opacity: reveal }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 16, letterSpacing: 3.5, fontWeight: 650, color: dark ? '#c2d1ae' : colors.sage, marginBottom: 28 }}><span style={{ width: 30, height: 1, background: 'currentColor' }}/>{number} / {title}</div>
    <h1 style={{ fontWeight: 580, fontSize: 65, letterSpacing: -2.9, lineHeight: 1.07, margin: 0, color: dark ? '#f1f5eb' : colors.ink }}>{lines.map(line => <React.Fragment key={line}>{line}<br/></React.Fragment>)}</h1>
    <p style={{ fontSize: 24, lineHeight: 1.55, color: dark ? '#b4c4b3' : colors.muted, maxWidth: 360, marginTop: 30 }}>{detail}</p>
  </div>;
}

function Screen({ name, previousName, transitionFrame = 0, frame, children, dark = false, scale = 1, origin = '50% 50%' }: { name: string; previousName?: string; transitionFrame?: number; frame: number; children?: React.ReactNode; dark?: boolean; scale?: number; origin?: string }) {
  const reveal = ease(frame, 2, 30);
  return <div style={{ position: 'absolute', top: 128, left: 528, width: 1312, opacity: reveal, transform: `translateY(${(1 - reveal) * 45}px) scale(${.98 + .02 * reveal})`, transformOrigin: 'center', borderRadius: 17, background: dark ? '#202c25' : '#fff', overflow: 'hidden', boxShadow: '0 30px 70px #213d3225, 0 3px 10px #213d3210', border: `1px solid ${dark ? '#5b6d5b' : '#d7dfd1'}` }}>
    <div style={{ height: 36, display: 'flex', alignItems: 'center', padding: '0 15px', gap: 6, borderBottom: `1px solid ${dark ? '#3e4d3f' : '#e5e9e1'}` }}><span style={{ fontSize: 12, color: dark ? '#bdc9b7' : '#69806b', fontWeight: 600 }}>Folio</span><div style={{ marginLeft: 'auto', display: 'flex', gap: 19, color: '#8b9988', fontSize: 14 }}><span>−</span><span>□</span><span>×</span></div></div>
    <div style={{ position: 'relative', width: 1312, height: 820, overflow: 'hidden' }}>
      <div style={{ width: '100%', height: '100%', transform: `scale(${scale})`, transformOrigin: origin }}>
        {previousName && <Img src={staticFile(`screens/${previousName}.png`)} style={{ position: 'absolute', width: '100%', height: '100%' }}/>}
        <Img src={staticFile(`screens/${name}.png`)} style={{ position: 'absolute', width: '100%', height: '100%', opacity: previousName ? ease(transitionFrame, 0, 12) : 1 }}/>{children}
      </div>
    </div>
  </div>;
}

function Highlight({ screen, name, frame, start, end }: { screen: Capture; name: string; frame: number; start: number; end: number }) {
  const rect = target(screen, name);
  return <div style={{ position: 'absolute', left: rect.x - 4, top: rect.y - 4, width: rect.width + 8, height: rect.height + 8, border: '2px solid #759863', borderRadius: 8, background: '#a2be8610', boxShadow: '0 0 0 4px #98b28018', opacity: ease(frame, start, start + 12) * (1 - ease(frame, end - 12, end)), pointerEvents: 'none' }}/>;
}

function Pointer({ x, y, frame, enter = 40, click = 85 }: { x: number; y: number; frame: number; enter?: number; click?: number }) {
  const p = ease(frame, enter, enter + 27);
  const ring = interpolate(frame, [click, click + 20], [0, 1], clamp);
  return <div style={{ position: 'absolute', left: x + (1 - p) * 85, top: y + (1 - p) * 85, opacity: ease(frame, enter, enter + 8) * (1 - ease(frame, click + 38, click + 50)) }}>
    {frame >= click && frame < click + 20 && <div style={{ position: 'absolute', left: -23, top: -23, border: '3px solid #638359', width: 46, height: 46, borderRadius: '50%', transform: `scale(${.3 + ring * .8})`, opacity: 1 - ring }}/>}<svg width="28" height="34" viewBox="0 0 28 34" fill="none" style={{ filter: 'drop-shadow(1px 3px 2px #0004)' }}><path d="M2 2L24 21L14 22L10 31L2 2Z" fill="#243f32" stroke="#fff" strokeWidth="2" strokeLinejoin="round"/></svg>
  </div>;
}

function Tag({ children, frame, start = 70, x, y }: { children: React.ReactNode; frame: number; start?: number; x: number; y: number }) {
  const p = ease(frame, start, start + 18);
  return <div style={{ position: 'absolute', left: x, top: y, opacity: p, transform: `translateY(${(1 - p) * 12}px)`, background: '#244737', border: '1px solid #9eaf88', color: '#f5f7ee', padding: '15px 20px', borderRadius: 10, fontSize: 21, fontWeight: 550, boxShadow: '0 10px 25px #173c2928' }}>{children}</div>;
}

function Intro({ frame }: { frame: number }) {
  const p = ease(frame, 0, 28);
  return <AbsoluteFill style={{ opacity: fade(frame, 120) }}>
    <div style={{ position: 'absolute', top: 94, left: 88, fontSize: 18, letterSpacing: 4.5, color: colors.sage }}>A LITTLE LESS SEARCHING. A LOT MORE LIVING.</div>
    <div style={{ position: 'absolute', left: 190, top: 306, transform: `translateY(${(1 - p) * 22}px)`, opacity: p }}><Brand large/><div style={{ fontSize: 48, color: colors.ink, letterSpacing: -1.4, marginTop: 44 }}>Your details. Within reach.</div><div style={{ fontSize: 25, color: colors.muted, marginTop: 23 }}>A thoughtful home for personal information.</div></div>
    {[{ label: 'Details', value: 'Alex Chen', y: 240, x: 1210, rotate: -5 }, { label: 'Documents', value: 'identity_passport.pdf', y: 406, x: 1290, rotate: 4 }, { label: 'Ready to reuse', value: 'Find. Copy. Done.', y: 572, x: 1195, rotate: -3 }].map((card, i) => <div key={card.label} style={{ position: 'absolute', left: card.x, top: card.y, width: 440, padding: '29px 34px', background: i === 2 ? '#4d6b50' : '#fff', border: '1px solid #d1dbc8', borderRadius: 15, transform: `translateX(${(1 - ease(frame, 8 + i * 9, 38 + i * 9)) * 120}px) rotate(${card.rotate}deg)`, opacity: ease(frame, 8 + i * 9, 38 + i * 9), boxShadow: '0 20px 50px #263e3210' }}><div style={{ fontSize: 17, color: i === 2 ? '#ccdcc0' : colors.muted, marginBottom: 17 }}>{card.label}</div><div style={{ fontSize: i === 1 ? 28 : 35, color: i === 2 ? '#fff' : colors.ink, fontWeight: 560 }}>{card.value}</div></div>)}
    <div style={{ position: 'absolute', bottom: 177, left: 190, display: 'flex', gap: 16 }}>{['Personal details', 'Supporting files', 'One calm workspace'].map(text => <span key={text} style={{ padding: '11px 18px', border: `1px solid ${colors.line}`, borderRadius: 30, fontSize: 19, color: colors.muted }}>{text}</span>)}</div>
    <Caption>个人信息与证明材料，随时找到，随手使用。</Caption>
  </AbsoluteFill>;
}

function Demo({ frame, chapter }: { frame: number; chapter: number }) {
  const config = [
    { duration: 210, title: 'ORGANIZE', lines: ['One place.', 'Every detail.'], detail: 'Identity, education, experience and the files behind them.', screen: 'overview', zh: '按分类整理个人资料与附件，让信息各归其位。' },
    { duration: 210, title: 'FIND & COPY', lines: ['Find the field.', 'Skip the hunt.'], detail: 'Search familiar words. Copy the exact value you need.', screen: 'search', zh: '支持字段与同义词检索，找到后即可复制。' },
    { duration: 210, title: 'MAKE IT YOURS', lines: ['Your details.', 'Your order.'], detail: 'Add fields where you need them. Arrange them your way.', screen: 'editor', zh: '按位置插入字段、拖动排序，日期可按年或月快速查找。' },
    { duration: 180, title: 'KEEP FILES CLOSE', lines: ['Less digging.', 'More doing.'], detail: 'Consistent names. Copy a path. Open a file or its folder.', screen: 'files', zh: '规范附件名称，复制路径，使用默认应用打开文件。' },
    { duration: 180, title: 'SET THE MOOD', lines: ['A familiar space.', 'In your style.'], detail: 'Light or dark. Five accents. English or 中文.', screen: 'appearance', zh: '明暗主题、五种配色与中英文界面，按习惯自由切换。' },
  ][chapter];
  const dark = chapter === 4;
  const showCalendar = chapter === 2 && frame >= 108;
  const showChinese = chapter === 4 && frame >= 102;
  const screen = showCalendar ? 'calendar' : showChinese ? 'chinese' : config.screen;
  const subtleZoom = 1 + ease(frame, 40, config.duration - 25) * .025;
  return <AbsoluteFill style={{ opacity: fade(frame, config.duration) }}>
    {dark && <Backdrop frame={frame} dark/>}
    <div style={{ position: 'absolute', left: 66, top: 50 }}><Brand inverted={dark}/></div>
    <div style={{ position: 'absolute', left: 66, bottom: 112, color: dark ? '#a9be9f' : colors.muted, fontSize: 16, letterSpacing: 2 }}>FOLIO / PRODUCT TOUR</div>
    <Chapter number={`0${chapter + 1}`} title={config.title} lines={config.lines} detail={config.detail} frame={frame} dark={dark}/>
    <Screen name={screen} previousName={showCalendar ? 'editor' : showChinese ? 'appearance' : undefined} transitionFrame={showCalendar ? frame - 108 : frame - 102} frame={frame} dark={dark} scale={subtleZoom}>
      {chapter === 0 && <><Highlight screen="overview" name="firstField" frame={frame} start={90} end={185}/><Pointer {...center('overview', 'firstFieldCopy')} frame={frame} enter={85} click={122}/></>}
      {chapter === 1 && <><Highlight screen="search" name="searchResults" frame={frame} start={35} end={170}/><Pointer {...center('search', 'searchResultCopy')} frame={frame} enter={42} click={72}/></>}
      {chapter === 2 && <><Highlight screen="editor" name="addField" frame={frame} start={35} end={105}/><Highlight screen="calendar" name="calendarNavigation" frame={frame} start={125} end={195}/></>}
      {chapter === 3 && <><Highlight screen="files" name="firstFileActions" frame={frame} start={40} end={160}/><Pointer {...center('files', 'firstFileCopy')} frame={frame} enter={48} click={88}/></>}
    </Screen>
    {chapter === 0 && <Tag x={1010} y={810} frame={frame} start={98}>Details + documents, together.</Tag>}
    {chapter === 1 && <Tag x={580} y={792} frame={frame} start={80}>QQ号 = QQ 号 · 手机 = 手机号</Tag>}
    {chapter === 2 && <Tag x={1050} y={840} frame={frame} start={120}>Browse the year. Choose the day.</Tag>}
    {chapter === 3 && <Tag x={878} y={778} frame={frame} start={96}>Copy a path. Keep your flow.</Tag>}
    {chapter === 4 && <div style={{ position: 'absolute', top: 760, left: 70, display: 'flex', gap: 17 }}>{['#4d6b50', '#4269a3', '#7353a1', '#a34465', '#94641b'].map((color, i) => <div key={color} style={{ width: 26, height: 26, borderRadius: 50, background: color, border: '2px solid #d6e0c955', opacity: ease(frame, 30 + i * 6, 45 + i * 6) }}/>)}</div>}
    <Caption dark={dark}>{config.zh}</Caption>
  </AbsoluteFill>;
}

function Outro({ frame }: { frame: number }) {
  const p = ease(frame, 4, 30);
  return <AbsoluteFill style={{ color: colors.ink, opacity: p }}>
    <div style={{ position: 'absolute', left: 0, right: 0, top: 260, display: 'flex', justifyContent: 'center', transform: `translateY(${(1 - p) * 20}px)` }}><Brand large/></div>
    <div style={{ position: 'absolute', top: 485, left: 0, right: 0, textAlign: 'center', fontSize: 54, letterSpacing: -1.8, fontWeight: 540 }}>Less searching. More ready.</div>
    <div style={{ position: 'absolute', top: 592, left: 0, right: 0, textAlign: 'center', fontSize: 25, color: colors.muted }}>On your computer. At your fingertips.</div>
    <div style={{ position: 'absolute', top: 699, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 26 }}><span style={{ padding: '16px 31px', background: colors.sage, borderRadius: 8, color: '#fff', fontWeight: 600, fontSize: 23 }}>Meet your personal library</span></div>
    <div style={{ position: 'absolute', top: 827, left: 0, right: 0, textAlign: 'center', color: '#80907e', fontSize: 17, letterSpacing: 2 }}>TAURI + REACT + SQLITE  /  FOLIO 0.3</div>
    <Caption>让资料有序，让使用更轻松。</Caption>
  </AbsoluteFill>;
}

export const FolioFilm: React.FC<{ preview: boolean; sound: boolean }> = ({ preview, sound }) => {
  const raw = useCurrentFrame();
  const previewStarts = [30, 162, 372, 792, 972, 1140];
  const frame = preview ? previewStarts[Math.min(5, Math.floor(raw / 24))] + (raw % 24) * 2 : raw;
  const starts = [120, 330, 540, 750, 930];
  return <AbsoluteFill style={{ fontFamily: font, overflow: 'hidden', background: colors.paper }}>
    <Backdrop frame={frame}/>
    {sound && <Audio src={staticFile('audio/folio.wav')} volume={.7}/>}
    {frame < 120 && <Intro frame={frame}/>}
    {starts.map((start, chapter) => frame >= start && frame < (starts[chapter + 1] ?? 1110) ? <Demo key={chapter} chapter={chapter} frame={frame - start}/> : null)}
    {frame >= 1110 && <Outro frame={frame - 1110}/>}
    <div style={{ position: 'absolute', bottom: 0, height: 4, width: `${frame / 1259 * 100}%`, background: colors.sage, opacity: .55 }}/>
  </AbsoluteFill>;
};
