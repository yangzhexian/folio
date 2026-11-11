import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { api, desktop } from './api';
import { AttachmentPreview } from './AttachmentPreview';
import { applyAppearance, readAppearance } from './theme';
import { loadPreviewSession, previewSessionEvent, setPreviewPinned, type PreviewSession } from './previewWindow';
import type { Locale } from './types';

const copy = {
  en: { title: 'Attachment preview', loading: 'Loading preview…', unavailable: 'This attachment is no longer available.', retry: 'Try again', copied: 'Copied', actionError: 'The action could not be completed. Try again.' },
  zh: { title: '附件预览', loading: '正在加载预览…', unavailable: '此附件已不可用。', retry: '重试', copied: '已复制', actionError: '操作未完成，请重试。' },
};

function readPreferences() {
  return { ...readAppearance(localStorage), locale: (localStorage.getItem('folio.locale') === 'zh' ? 'zh' : 'en') as Locale };
}

export default function PreviewWindowApp() {
  const [preferences, setPreferences] = useState(readPreferences);
  const text = copy[preferences.locale];
  const [view, setView] = useState<{ session: PreviewSession; selectedId: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pinning, setPinning] = useState(false);
  const [toast, setToast] = useState('');
  const actionActive = useRef(false);
  const refreshRef = useRef<() => void>(() => {});
  const file = view?.session.files.find(item => item.id === view.selectedId);

  useEffect(() => {
    const synchronize = () => setPreferences(readPreferences());
    window.addEventListener('storage', synchronize);
    window.addEventListener('focus', synchronize);
    return () => { window.removeEventListener('storage', synchronize); window.removeEventListener('focus', synchronize); };
  }, []);

  useEffect(() => {
    applyAppearance(preferences.theme, preferences.accent);
    document.documentElement.lang = preferences.locale === 'zh' ? 'zh-CN' : 'en';
    if (desktop) void getCurrentWindow().setTheme(preferences.theme).catch(() => {});
  }, [preferences]);

  useEffect(() => {
    if (desktop) void getCurrentWindow().setTitle(file ? `${file.fileName} - Folio` : `${text.title} - Folio`).catch(() => {});
  }, [file?.fileName, text.title]);

  useEffect(() => {
    if (!desktop) { setLoading(false); return; }
    let alive = true;
    let running = false;
    let pending = false;
    let generation = 0;
    const subscriptions: Array<() => void> = [];
    const refresh = async (invalidate = false) => {
      if (!alive) return;
      if (invalidate) generation += 1;
      if (running) { pending = true; return; }
      running = true;
      const started = generation;
      try {
        const session = await loadPreviewSession();
        if (!alive || started !== generation) return;
        setView(previous => {
          const requestedId = previous?.session.revision !== session.revision ? session.id : previous.selectedId;
          const selectedId = session.files.some(item => item.id === requestedId) ? requestedId : session.files[0]?.id ?? '';
          if (previous?.selectedId === selectedId && JSON.stringify(previous.session) === JSON.stringify(session)) return previous;
          return { session, selectedId };
        });
      } catch (error) {
        if (alive && started === generation && !String(error).includes('LIBRARY_BUSY')) setView(null);
      } finally {
        if (alive && started === generation) setLoading(false);
        running = false;
        if (alive && pending) { pending = false; void refresh(); }
      }
    };
    refreshRef.current = () => { void refresh(true); };
    const focus = () => { void refresh(true); };
    window.addEventListener('focus', focus);
    const interval = window.setInterval(() => { if (document.visibilityState !== 'hidden') void refresh(); }, 2000);
    void (async () => {
      // Subscribe before the first read, so an open request during startup cannot be lost.
      const changes = await listen(previewSessionEvent, focus);
      if (!alive) { changes(); return; }
      subscriptions.push(changes);
      const nativeFocus = await getCurrentWindow().onFocusChanged(event => { if (event.payload) focus(); });
      if (!alive) { nativeFocus(); return; }
      subscriptions.push(nativeFocus);
      await refresh();
    })().catch(() => { if (alive) { setLoading(false); void refresh(); } });
    return () => {
      alive = false;
      generation += 1;
      window.clearInterval(interval);
      window.removeEventListener('focus', focus);
      subscriptions.forEach(unlisten => unlisten());
      refreshRef.current = () => {};
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function run(action: () => Promise<void>) {
    if (actionActive.current) return;
    actionActive.current = true;
    setBusy(true);
    try { await action(); } catch { setToast(text.actionError); }
    finally { actionActive.current = false; setBusy(false); }
  }
  const close = () => { if (desktop) void getCurrentWindow().close().catch(() => setToast(text.actionError)); };
  const togglePin = async () => {
    if (!view || pinning) return;
    setPinning(true);
    try {
      const pinned = await setPreviewPinned(!view.session.pinned);
      setView(current => current ? { ...current, session: { ...current.session, pinned } } : current);
      // Discard a metadata read that captured the old native topmost state.
      refreshRef.current();
    } catch { setToast(text.actionError); }
    finally { setPinning(false); }
  };

  return <div className="preview-native-root">
    {view?.session.files.length ? <AttachmentPreview
      key={view.session.revision} files={view.session.files} initialId={view.session.id} selectedId={view.selectedId}
      onSelected={selectedId => setView(current => current ? { ...current, selectedId } : current)}
      locale={preferences.locale} busy={busy} onClose={close}
      native={{ pinned: view.session.pinned, pinning, onTogglePin: () => { void togglePin(); } }}
      onOpen={attachment => { void run(() => api.open(attachment.id)); }}
      onCopyPath={attachment => { void run(async () => { await api.copy(await api.path(attachment.id)); setToast(text.copied); }); }}
      onReveal={attachment => { void run(() => api.reveal(attachment.id)); }}/>
      : <div className="preview-window-empty"><p role={loading ? 'status' : 'alert'}>{loading ? text.loading : text.unavailable}</p><div>
        {!loading && <button className="button" type="button" onClick={() => refreshRef.current()}>{text.retry}</button>}
      </div></div>}
    {toast && <div className="toast preview-window-toast" role="status">{toast}</div>}
  </div>;
}
