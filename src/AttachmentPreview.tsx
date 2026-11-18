import { previewCopy } from './i18n/preview';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button, IconButton } from './ui/Buttons';
import { containTabFocus } from './ui/dialogFocus';
import { ChevronLeft, ChevronRight, Copy, ExternalLink, FolderOpen, Maximize, Pin, PinOff, X, ZoomIn, ZoomOut } from 'lucide-react';
import { api } from './api';
import { previewKind } from './previewFormats';
import PdfPreview from './PdfPreview';
import type { Attachment, Locale } from './types';
import './attachment-preview.css';

function PreviewPane({ file, locale }: { file: Attachment; locale: Locale }) {
  const text = previewCopy[locale];
  const kind = previewKind(file.fileName);
  const viewportRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [viewport, setViewport] = useState({ width: 1, height: 1 });
  const [data, setData] = useState<Uint8Array<ArrayBuffer> | null>(null);
  const [imageUrl, setImageUrl] = useState('');
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [page, setPage] = useState(1);
  const [pageDraft, setPageDraft] = useState('1');
  const [pageCount, setPageCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const fail = useCallback((code: string) => { setError(code); setLoading(false); }, []);

  useLayoutEffect(() => {
    const node = viewportRef.current!;
    const update = () => setViewport({ width: Math.max(1, node.clientWidth - 40), height: Math.max(1, node.clientHeight - 40) });
    const observer = new ResizeObserver(update);
    observer.observe(node);
    update();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let url = '';
    setLoading(true); setError(''); setData(null); setImageUrl(''); setImageSize({ width: 0, height: 0 });
    setPage(1); setPageCount(0); setZoom(1);
    void api.preview(file.id).then(bytes => {
      if (cancelled) return;
      if (bytes.byteLength > (kind === 'pdf' ? 64 : 32) * 1024 * 1024) throw new Error('PREVIEW_TOO_LARGE');
      if (kind === 'pdf') setData(bytes);
      else if (kind) {
        url = URL.createObjectURL(new Blob([bytes], { type: `image/${kind}` }));
        setImageUrl(url);
      } else throw new Error('PREVIEW_UNSUPPORTED');
    }).catch(reason => { if (!cancelled) fail(String(reason)); });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [file.id, kind, attempt, fail]);

  useEffect(() => {
    if (!loading) return;
    const timer = window.setTimeout(() => fail('PREVIEW_TIMEOUT'), 30_000);
    return () => clearTimeout(timer);
  }, [loading, attempt, fail]);
  useEffect(() => { setPageDraft(String(page)); viewportRef.current?.scrollTo(0, 0); }, [page]);

  const ready = !error && (kind === 'pdf' ? pageCount > 0 : imageSize.width > 0);
  const changeZoom = useCallback((amount: number) => setZoom(current => Math.max(.25, Math.min(4, Math.round((current + amount) * 100) / 100))), []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).matches('input, textarea, select') || !ready || event.altKey || event.metaKey) return;
      if (event.key === '+' || event.key === '=') { event.preventDefault(); changeZoom(.25); }
      else if (event.key === '-') { event.preventDefault(); changeZoom(-.25); }
      else if (event.key === '0') { event.preventDefault(); setZoom(1); }
      else if (kind === 'pdf' && event.key === 'PageDown') { event.preventDefault(); setPage(current => Math.min(pageCount, current + 1)); }
      else if (kind === 'pdf' && event.key === 'PageUp') { event.preventDefault(); setPage(current => Math.max(1, current - 1)); }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [ready, changeZoom, kind, pageCount]);

  const fit = Math.min(1, viewport.width / Math.max(1, imageSize.width), viewport.height / Math.max(1, imageSize.height));
  const message = error.includes('PREVIEW_TOO_LARGE') ? text.tooLarge
    : error.includes('PREVIEW_PASSWORD') ? text.password
    : error.includes('PREVIEW_TIMEOUT') ? text.timeout
    : error.includes('DESKTOP_ONLY') ? text.desktop
    : error.includes('PREVIEW_UNAVAILABLE') ? text.unavailable : text.invalid;
  function commitPage() {
    const next = Number(pageDraft);
    if (/^\d+$/.test(pageDraft) && next >= 1 && next <= pageCount) setPage(next);
    else setPageDraft(String(page));
  }
  return <div className="preview-workspace">
    <div className={`preview-viewport ${ready ? 'preview-pannable' : ''}`} ref={viewportRef} aria-busy={loading}
      onPointerDown={event => {
        if (event.button !== 0 || !(event.target instanceof HTMLImageElement || event.target instanceof HTMLCanvasElement)) return;
        const node = event.currentTarget;
        drag.current = { x: event.clientX, y: event.clientY, left: node.scrollLeft, top: node.scrollTop };
        node.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        if (!drag.current) return;
        event.currentTarget.scrollLeft = drag.current.left - (event.clientX - drag.current.x);
        event.currentTarget.scrollTop = drag.current.top - (event.clientY - drag.current.y);
      }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}>
      {!error && kind === 'pdf' && data && <PdfPreview data={data} page={page} zoom={zoom} viewport={viewport} onPageCount={setPageCount} onBusy={setLoading} onError={fail}/>}
      {!error && imageUrl && <img className="preview-image" src={imageUrl} alt={file.fileName} draggable={false}
        style={{ width: Math.max(1, imageSize.width * fit * zoom), height: Math.max(1, imageSize.height * fit * zoom), visibility: imageSize.width ? 'visible' : 'hidden' }}
        onLoad={event => {
          const image = event.currentTarget;
          if (image.naturalWidth > 16384 || image.naturalHeight > 16384 || image.naturalWidth * image.naturalHeight > 40_000_000) { fail('PREVIEW_TOO_LARGE'); return; }
          setImageSize({ width: image.naturalWidth, height: image.naturalHeight }); setLoading(false);
        }} onError={() => fail('PREVIEW_INVALID')}/>}
      {error && <div className="preview-message"><p role="alert">{message}</p><Button onClick={() => setAttempt(value => value + 1)}>{text.retry}</Button></div>}
    </div>
    {loading && <div className="preview-loading" role="status"><span className="spinner small-spinner"/>{text.loading}</div>}
    <footer className="preview-toolbar">
      <div className="preview-control-group">
        <IconButton label={text.zoomOut} disabled={!ready || zoom <= .25} onClick={() => changeZoom(-.25)}><ZoomOut size={17}/></IconButton>
        <output className="preview-zoom" aria-label={text.zoom}>{Math.round(zoom * 100)}%</output>
        <IconButton label={text.zoomIn} disabled={!ready || zoom >= 4} onClick={() => changeZoom(.25)}><ZoomIn size={17}/></IconButton>
        <IconButton label={text.fit} disabled={!ready} onClick={() => { setZoom(1); viewportRef.current?.scrollTo(0, 0); }}><Maximize size={16}/></IconButton>
      </div>
      {kind === 'pdf' && <div className="preview-control-group preview-pages">
        <IconButton label={text.previousPage} disabled={!ready || page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))}><ChevronLeft size={18}/></IconButton>
        <input className="preview-page-input" type="number" min={1} max={pageCount || 1} step={1} aria-label={text.page} inputMode="numeric" value={pageDraft} disabled={!ready} onChange={event => setPageDraft(event.target.value)} onBlur={commitPage} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commitPage(); } }}/>
        <span className="preview-page-count">/ {pageCount || '—'}</span>
        <IconButton label={text.nextPage} disabled={!ready || page >= pageCount} onClick={() => setPage(value => Math.min(pageCount, value + 1))}><ChevronRight size={18}/></IconButton>
      </div>}
    </footer>
  </div>;
}

export function AttachmentPreview({ files, initialId, locale, busy, onClose, onOpen, onCopyPath, onReveal, selectedId, onSelected, native }: {
  files: Attachment[]; initialId: string; locale: Locale; busy: boolean; onClose: () => void;
  onOpen: (file: Attachment) => void; onCopyPath: (file: Attachment) => void; onReveal: (file: Attachment) => void;
  selectedId?: string; onSelected?: (id: string) => void;
  native?: { pinned: boolean; pinning: boolean; onTogglePin: () => void };
}) {
  const text = previewCopy[locale];
  const [localId, setLocalId] = useState(initialId);
  const index = Math.max(0, files.findIndex(file => file.id === (selectedId ?? localId)));
  const file = files[index];
  const navigation = useRef({ files, index, onSelected });
  navigation.current = { files, index, onSelected };
  const move = useCallback((direction: number) => {
    const current = navigation.current;
    const next = current.files[Math.max(0, Math.min(current.files.length - 1, current.index + direction))];
    if (next) { setLocalId(next.id); current.onSelected?.(next.id); }
  }, []);
  const root = useRef<HTMLDivElement>(null);
  const opener = useRef(document.activeElement as HTMLElement | null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useLayoutEffect(() => {
    const dialog = root.current!;
    dialog.querySelector<HTMLButtonElement>('.preview-close')?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
      else if (event.key === 'Tab' && !native) {
        containTabFocus(event, dialog);
      } else if (!(event.target as HTMLElement).matches('input, textarea, select') && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1); }
        if (event.key === 'ArrowRight') { event.preventDefault(); move(1); }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      const previous = opener.current;
      // React removes the background's inert attribute during the same commit.
      if (!native) queueMicrotask(() => { if (previous?.isConnected && !document.querySelector('[role="dialog"]')) previous.focus({ preventScroll: true }); });
    };
  }, [move, !!native]);
  if (!file) return null;
  return <div className={native ? 'preview-native-shell' : 'modal-backdrop preview-backdrop'}><div className="attachment-preview" ref={root} role={native ? 'region' : 'dialog'} aria-modal={native ? undefined : true} aria-label={text.title}>
    <header className="preview-header">
      <div className="preview-filename" aria-live="polite"><strong title={file.fileName}>{file.fileName}</strong></div>
      <div className="preview-control-group preview-attachment-navigation">
        <IconButton label={text.previous} disabled={index === 0} onClick={() => move(-1)}><ChevronLeft size={18}/></IconButton>
        <span className="preview-position">{index + 1} / {files.length}</span>
        <IconButton label={text.next} disabled={index === files.length - 1} onClick={() => move(1)}><ChevronRight size={18}/></IconButton>
      </div>
      <div className="preview-control-group preview-file-actions">
        <IconButton label={text.external} disabled={busy} onClick={() => onOpen(file)}><ExternalLink size={17}/></IconButton>
        <IconButton label={text.path} disabled={busy} onClick={() => onCopyPath(file)}><Copy size={16}/></IconButton>
        <IconButton label={text.folder} disabled={busy} onClick={() => onReveal(file)}><FolderOpen size={18}/></IconButton>
        {native && <IconButton aria-pressed={native.pinned} label={native.pinned ? text.unpin : text.pin} disabled={native.pinning} onClick={native.onTogglePin}>{native.pinned ? <PinOff size={17}/> : <Pin size={17}/>}</IconButton>}
        {!native && <><span className="tool-divider"/><IconButton className="preview-close" label={text.close} onClick={onClose}><X size={19}/></IconButton></>}
      </div>
    </header>
    <PreviewPane key={`${file.id}:${file.revision ?? ''}:${file.relativePath}`} file={file} locale={locale}/>
  </div></div>;
}
