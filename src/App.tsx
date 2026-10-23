import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode, FormEvent, CSSProperties } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ArrowDownToLine, ArrowUpFromLine, BadgeCheck, BookOpen, Check, CheckCircle2, ChevronRight, Copy, Database, FileText, Folder, FolderOpen, GraduationCap, Languages, LayoutGrid, SlidersHorizontal, LockKeyhole, Pencil, Plus, Search, Settings, Star, Trash2, UserRound, Users, X, Eye, EyeOff, BriefcaseBusiness, Award, FlaskConical, Paperclip, Sun, Moon, Palette, Upload } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { api, desktop } from './api';
import type { Attachment, Category, Locale, ProfileRecord, Snapshot } from './types';
import { categories, categoryLabels, createRecord, templates } from './templates';
import { fieldLabel, filterAttachments, filterRecords, findMatchingFields, formatBytes, formatRecord } from './domain';
import { tFor } from './i18n';
import type { TranslationKey } from './i18n';
import { isRecordSortOrder, recordSortOrders, sortRecords } from './sorting';
import type { RecordSortOrder } from './sorting';
import { accentColors, accentSwatches, applyAppearance, readAppearance, saveAppearance, themeModes } from './theme';
import { useFileDrop } from './useFileDrop';
import { version } from '../package.json';
import { FieldEditor } from './FieldEditor';
import { editableAttachmentName } from './attachmentName';

const categoryIcons: Record<Category, LucideIcon> = { identity: UserRound, education: GraduationCap, experience: BriefcaseBusiness, research: FlaskConical, awards: Award, skills: BadgeCheck, contacts: Users, documents: FileText, custom: SlidersHorizontal };
const sortLabels: Record<RecordSortOrder, TranslationKey> = {
  'updated-desc': 'sortUpdatedDesc', 'updated-asc': 'sortUpdatedAsc',
  'created-desc': 'sortCreatedDesc', 'created-asc': 'sortCreatedAsc',
  'title-asc': 'sortTitleAsc', 'title-desc': 'sortTitleDesc',
};
type View = 'all' | 'favorites' | 'files' | Category;
type ConfirmState = { title: string; body: string; action: () => Promise<void> | void; label?: string };
type Toast = { text: string; error?: boolean; pending?: boolean; undo?: () => Promise<void> };

function IconButton({ label, children, onClick, active, disabled, className = '' }: { label: string; children: ReactNode; onClick: () => void; active?: boolean; disabled?: boolean; className?: string }) {
  return <button type="button" className={`icon-button ${active ? 'active' : ''} ${className}`} onClick={onClick} title={label} aria-label={label} disabled={disabled}>{children}</button>;
}

function Modal({ title, close, children, wide = false, closeLabel }: { title: string; close: () => void; children: ReactNode; wide?: boolean; closeLabel: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef(document.activeElement as HTMLElement | null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useLayoutEffect(() => {
    const node = ref.current!;
    (node.querySelector('[data-autofocus]') as HTMLElement ?? node.querySelector<HTMLElement>('input, textarea, select') ?? node.querySelector<HTMLElement>('button'))?.focus();
    const key = (e: KeyboardEvent) => {
      if (node !== [...document.querySelectorAll('[role="dialog"]')].at(-1)) return;
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); }
      if (e.key === 'Tab') {
        const elements = [...node.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]')].filter(el => el.offsetParent !== null);
        const first = elements[0], last = elements.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      const active = document.activeElement as HTMLElement | null;
      if (active && active !== document.body && active.isConnected && !node.contains(active) && !active.closest('[role="dialog"]')) return;
      const opener = previous.current;
      if (opener?.isConnected) opener.focus();
      else document.querySelector<HTMLElement>('.compact-create, .nav-item[aria-current="page"]')?.focus();
    };
  }, []);
  return <div className="modal-backdrop"><div ref={ref} className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}><header className="modal-header"><h2>{title}</h2><IconButton label={closeLabel} onClick={close}><X size={19}/></IconButton></header>{children}</div></div>;
}

export default function App() {
  const [locale, setLocale] = useState<Locale>(() => localStorage.getItem('folio.locale') === 'zh' ? 'zh' : 'en');
  const [appearance, setAppearance] = useState(() => readAppearance(localStorage));
  const t = tFor(locale);
  const [snapshot, setSnapshot] = useState<Snapshot>({ records: [], attachments: [], dataDir: '' });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [view, setView] = useState<View>('all');
  const [query, setQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<RecordSortOrder>(() => {
    const saved = localStorage.getItem('folio.sort');
    return isRecordSortOrder(saved) ? saved : 'updated-desc';
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusedFieldId, setFocusedFieldId] = useState<string | null>(null);
  const fieldNodes = useRef(new Map<string, HTMLDivElement>());
  const [templateOpen, setTemplateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState<ProfileRecord | null>(null);
  const [draftOriginal, setDraftOriginal] = useState('');
  const [editError, setEditError] = useState('');
  const [busy, setBusy] = useState(false);
  const operationActive = useRef(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [visibleFields, setVisibleFields] = useState<Set<string>>(new Set());
  const [renameFile, setRenameFile] = useState<Attachment | null>(null);
  const [renameName, setRenameName] = useState('');
  const [pendingPaths, setPendingPaths] = useState<string[] | null>(null);
  const [importRecordId, setImportRecordId] = useState('__new__');
  const [importTitle, setImportTitle] = useState('');
  const [importError, setImportError] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const closeState = useRef({ dirty: false, busy: false, locale });
  closeState.current = { dirty: !!draft && JSON.stringify(draft) !== draftOriginal, busy, locale };

  const refresh = useCallback(async () => {
    try { const next = await api.load(); setSnapshot(next); setLoadError(''); return next; }
    catch (error) { setLoadError(String(error)); throw error; }
  }, []);
  const load = useCallback(async () => {
    setLoading(true); setLoadError('');
    try { await refresh(); }
    catch (e) { setLoadError(String(e)); }
    finally { setLoading(false); }
  }, [refresh]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!desktop) return;
    const nativeWindow = getCurrentWindow();
    const listener = nativeWindow.onCloseRequested(event => {
      const current = closeState.current;
      if (current.busy) { event.preventDefault(); return; }
      if (!current.dirty) return;
      event.preventDefault();
      const translate = tFor(current.locale);
      setConfirm({ title: translate('discardTitle'), body: translate('discardBody'), label: translate('discard'), action: async () => { await nativeWindow.destroy(); } });
    });
    return () => { void listener.then(unlisten => unlisten()); };
  }, []);
  useEffect(() => { localStorage.setItem('folio.locale', locale); document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'; }, [locale]);
  useLayoutEffect(() => { applyAppearance(appearance.theme, appearance.accent); saveAppearance(appearance, localStorage); }, [appearance]);
  useEffect(() => {
    if (desktop) void getCurrentWindow().setTheme(appearance.theme).catch(error => setToast({ text: String(error), error: true }));
  }, [appearance.theme]);
  useEffect(() => { localStorage.setItem('folio.sort', sortOrder); }, [sortOrder]);
  useEffect(() => { if (!toast || toast.pending) return; const id = window.setTimeout(() => setToast(null), toast.undo ? 12000 : toast.error ? 9000 : 3500); return () => clearTimeout(id); }, [toast]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (!document.querySelector('[role="dialog"]')) searchRef.current?.focus(); } };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    if (!draft || JSON.stringify(draft) === draftOriginal) return;
    const guard = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard);
  }, [draft, draftOriginal]);

  const filtered = useMemo(() => sortRecords(filterRecords(snapshot.records, snapshot.attachments, query, view === 'files' ? 'all' : view), sortOrder, locale), [snapshot, query, view, sortOrder, locale]);
  const selected = filtered.find(r => r.id === selectedId) ?? filtered[0];
  useEffect(() => { if (selected && selected.id !== selectedId) setSelectedId(selected.id); }, [selected, selectedId]);
  useEffect(() => { setVisibleFields(new Set()); }, [selected?.id]);
  const matchedFieldIds = useMemo(() => new Set(selected ? findMatchingFields(selected, query).map(field => field.id) : []), [selected, query]);
  useEffect(() => {
    if (focusedFieldId) fieldNodes.current.get(focusedFieldId)?.scrollIntoView({ block: 'center', behavior: 'instant' });
  }, [focusedFieldId, selected?.id]);
  useEffect(() => { setFocusedFieldId(null); }, [query]);
  const recordFiles = snapshot.attachments.filter(a => a.recordId === selected?.id);
  const fileResults = useMemo(() => filterAttachments(snapshot.records, snapshot.attachments, query), [snapshot, query]);
  const title = view === 'all' ? t('all') : view === 'favorites' ? t('favorites') : view === 'files' ? t('fileLibrary') : categoryLabels[view][locale];
  const fail = (error: unknown) => setToast({ text: String(error).includes('DESKTOP_ONLY') ? t('desktopOnly') : `${t('error')}: ${String(error)}`, error: true });
  const perform = async (action: () => Promise<void>) => { if (operationActive.current) return; operationActive.current = true; setBusy(true); try { await action(); } catch (e) { fail(e); } finally { operationActive.current = false; setBusy(false); } };
  const copy = async (value: string) => { try { await api.copy(value); setToast({ text: t('copied') }); } catch (e) { fail(e); } };
  const navigate = (next: View) => { setView(next); setSelectedId(null); setFocusedFieldId(null); setVisibleFields(new Set()); };
  const beginEdit = (record: ProfileRecord) => { setDraft(structuredClone(record)); setDraftOriginal(JSON.stringify(record)); setEditError(''); };
  const closeEditor = useCallback(() => {
    if (busy) return;
    if (draft && JSON.stringify(draft) !== draftOriginal) setConfirm({ title: tFor(locale)('discardTitle'), body: tFor(locale)('discardBody'), label: tFor(locale)('discard'), action: () => { setDraft(null); } });
    else setDraft(null);
  }, [draft, draftOriginal, busy, locale]);
  const closeTemplates = useCallback(() => setTemplateOpen(false), []);
  const closeSettings = useCallback(() => { if (!busy) setSettingsOpen(false); }, [busy]);
  const closeConfirm = useCallback(() => { if (!busy) setConfirm(null); }, [busy]);
  const closeRename = useCallback(() => { if (!busy) setRenameFile(null); }, [busy]);
  const closeImport = useCallback(() => { if (!busy) setPendingPaths(null); }, [busy]);

  const modalOpen = templateOpen || settingsOpen || !!draft || !!confirm || !!renameFile || !!pendingPaths;
  const dragging = useFileDrop(paths => {
    if (operationActive.current) { setToast({ text: t('dropBusy'), error: true }); return; }
    if (modalOpen) { setToast({ text: t('dropBlocked'), error: true }); return; }
    if (loading || loadError) return;
    if (selected && view !== 'files') {
      void perform(async () => {
        setToast({ text: t('importing'), pending: true });
        await api.attachDropped(selected.id, paths);
        await refresh();
        setSelectedId(selected.id);
        setToast({ text: t('imported') });
      });
    } else {
      setImportRecordId(snapshot.records[0]?.id ?? '__new__');
      setImportTitle((paths[0]?.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') || t('newDocument')).slice(0, 200));
      setImportError('');
      setPendingPaths(paths);
    }
  }, fail);

  async function importPendingFiles(event: FormEvent) {
    event.preventDefault();
    if (!pendingPaths) return;
    if (importRecordId === '__new__' && !importTitle.trim()) { setImportError(t('titleRequired')); return; }
    await perform(async () => {
      setImportError('');
      let targetId = importRecordId;
      let createdId: string | undefined;
      try {
        if (targetId === '__new__') {
          const record = await api.save({ ...createRecord('document', locale), title: importTitle.trim() });
          targetId = record.id;
          createdId = record.id;
        }
        try { await api.attachDropped(targetId, pendingPaths); }
        catch (error) { if (createdId) await api.delete(createdId); throw error; }
      } catch (error) {
        setImportError(`${t('error')}: ${String(error)}`);
        return;
      }
      // A failed reload must never turn a completed import into a retryable copy.
      setSelectedId(targetId); setView('all'); setQuery(''); setPendingPaths(null);
      await refresh();
      setToast({ text: t('imported') });
    });
  }

  async function saveDraft(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    if (!draft.title.trim()) { setEditError(t('titleRequired')); return; }
    if (draft.fields.some(f => !f.label.trim())) { setEditError(t('labelRequired')); return; }
    await perform(async () => {
      const saved = await api.save({ ...draft, title: draft.title.trim(), tags: draft.tags.map(tag => tag.trim()).filter(Boolean) });
      await refresh(); setSelectedId(saved.id); setView(saved.category); setQuery(''); setDraft(null); setToast({ text: t('saved') });
    });
  }

  const toggleFavorite = (record: ProfileRecord) => void perform(async () => { await api.save({ ...record, favorite: !record.favorite }); await refresh(); });
  const deleteRecord = (record: ProfileRecord) => setConfirm({ title: t('deleteTitle'), body: t('deleteBody'), label: t('delete'), action: async () => {
    await api.delete(record.id); await refresh(); setToast({ text: t('deleted'), undo: async () => { await api.save(record); await refresh(); setSelectedId(record.id); } });
  } });
  const removeFile = (file: Attachment) => setConfirm({ title: t('removeTitle'), body: t('removeBody'), label: t('remove'), action: async () => {
    await api.remove(file.id); await refresh(); setToast({ text: t('removed'), undo: async () => { await api.restoreAttachment(file.id); await refresh(); } });
  } });
  const addFiles = (record: ProfileRecord) => void perform(async () => { const files = await api.attach(record.id, locale); if (files.length) { await refresh(); setToast({ text: t('imported') }); } });
  const fileActions = (file: Attachment) => <div className="file-actions">
    <IconButton label={t('copyPath')} disabled={busy} onClick={() => void perform(async () => { await copy(await api.path(file.id)); })}><Copy size={15}/></IconButton>
    <IconButton label={t('revealFolder')} disabled={busy} onClick={() => void perform(async () => { await api.reveal(file.id); })}><FolderOpen size={16}/></IconButton>
    <IconButton label={t('rename')} disabled={busy} onClick={() => { setRenameFile(file); setRenameName(editableAttachmentName(file.fileName)); }}><Pencil size={15}/></IconButton>
    <IconButton label={t('remove')} disabled={busy} onClick={() => removeFile(file)}><Trash2 size={15}/></IconButton>
  </div>;
  const shortDate = (value: string) => new Date(value).toLocaleDateString(locale === 'zh' ? 'zh-CN' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const newRecordButton = <button className="button primary compact-create" aria-label={t('newRecord')} title={t('newRecord')} onClick={() => setTemplateOpen(true)} disabled={loading || !!loadError || busy}><Plus size={16}/><span>{t('new')}</span></button>;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><BookOpen size={21} strokeWidth={1.8}/></div><span>folio<span className="brand-dot">.</span></span></div>
      <nav aria-label={t('library')}>
        <button className={`nav-item ${view === 'all' ? 'selected' : ''}`} aria-current={view === 'all' ? 'page' : undefined} onClick={() => navigate('all')}><LayoutGrid size={17}/><span>{t('all')}</span><small>{snapshot.records.length}</small></button>
        <button className={`nav-item ${view === 'favorites' ? 'selected' : ''}`} aria-current={view === 'favorites' ? 'page' : undefined} onClick={() => navigate('favorites')}><Star size={17}/><span>{t('favorites')}</span><small>{snapshot.records.filter(r => r.favorite).length}</small></button>
        <button className={`nav-item ${view === 'files' ? 'selected' : ''}`} aria-current={view === 'files' ? 'page' : undefined} onClick={() => navigate('files')}><Folder size={17}/><span>{t('files')}</span><small>{snapshot.attachments.length}</small></button>
        <div className="nav-caption">{t('collections')}</div>
        {categories.map(category => { const Icon = categoryIcons[category]; const count = snapshot.records.filter(r => r.category === category).length; return <button key={category} className={`nav-item ${view === category ? 'selected' : ''}`} aria-current={view === category ? 'page' : undefined} onClick={() => navigate(category)}><Icon size={17}/><span>{categoryLabels[category][locale]}</span>{count > 0 && <small>{count}</small>}</button>; })}
      </nav>
      <div className="sidebar-bottom"><button className="nav-item" onClick={() => setSettingsOpen(true)}><Settings size={17}/><span>{t('settings')}</span></button></div>
    </aside>

    <main className="main">
      <header className="topbar"><div className="search-box"><Search size={17}/><input ref={searchRef} value={query} onChange={e => setQuery(e.target.value)} placeholder={t('search')} aria-label={t('search')}/>{query ? <IconButton label={t('clearSearch')} onClick={() => setQuery('')}><X size={14}/></IconButton> : <kbd>Ctrl K</kbd>}</div><div className="topbar-actions"><IconButton label={appearance.theme === 'light' ? t('switchToDark') : t('switchToLight')} onClick={() => setAppearance(current => ({ ...current, theme: current.theme === 'light' ? 'dark' : 'light' }))}>{appearance.theme === 'light' ? <Moon size={17}/> : <Sun size={17}/>}</IconButton><button className="locale-toggle" onClick={() => setLocale(locale === 'en' ? 'zh' : 'en')} title={t('language')} aria-label={t('language')}><Languages size={16}/><span>{locale === 'en' ? '中文' : 'EN'}</span></button></div></header>
      {!desktop && <div className="preview-banner">{t('preview')}</div>}

      {loading ? <div className="center-state"><div className="spinner"/><p>{t('loading')}</p></div> : loadError ? <div className="center-state"><Database size={32}/><h2>{t('error')}</h2><p className="error-message">{loadError}</p><button className="button" onClick={() => void load()}>{t('retry')}</button></div> : view === 'files' ? <section className="file-library" aria-label={title}>
        <div className="section-toolbar"><span>{fileResults.length} {t(fileResults.length === 1 ? 'fileSingular' : 'fileCount')}</span>{newRecordButton}</div>
        {fileResults.length ? <div className="file-table"><div className="file-table-head"><span>{t('name')}</span><span>{t('record')}</span><span>{t('size')}</span><span>{t('actions')}</span></div>{fileResults.map(file => <div className="file-table-row" key={file.id}><div className="file-name"><div className="file-icon"><FileText size={20}/></div><div><button className="file-open" title={file.fileName} aria-label={`${t('openFile')}: ${file.fileName}`} disabled={busy} onClick={() => void perform(async () => { await api.open(file.id); })}><strong title={file.fileName}>{file.fileName}</strong></button><span title={file.originalName}>{file.originalName}</span></div></div><button className="text-button file-parent" onClick={() => { setView('all'); setQuery(''); setSelectedId(file.recordId); }}>{snapshot.records.find(r => r.id === file.recordId)?.title}</button><span className="mono muted">{formatBytes(file.size)}</span>{fileActions(file)}</div>)}</div> : <div className="center-state"><FolderOpen size={35}/><h2>{query ? t('noMatchingFiles') : t('noFiles')}</h2>{query ? <button className="text-button" onClick={() => setQuery('')}>{t('clearSearch')}</button> : <p>{t('noFilesHint')}</p>}</div>}
      </section> : <section className="library-layout" aria-label={title}>
        <div className="record-pane">
          <div className="list-toolbar">
            <select className="sort-select" aria-label={t('sortRecords')} title={t(sortLabels[sortOrder])} value={sortOrder} onChange={e => { const next = e.target.value; if (isRecordSortOrder(next)) { setSelectedId(selected?.id ?? null); setSortOrder(next); } }}>
              {recordSortOrders.map(order => <option key={order} value={order}>{t(sortLabels[order])}</option>)}
            </select>
            {newRecordButton}
          </div>
          <div className="record-list">
            {filtered.length ? filtered.map(record => {
              const Icon = categoryIcons[record.category];
              const count = snapshot.attachments.filter(a => a.recordId === record.id).length;
              const showCategory = view === 'all' || view === 'favorites';
              const matches = findMatchingFields(record, query);
              return <div className="record-result" key={record.id}><button className={`record-card ${selected?.id === record.id ? 'selected' : ''}`} onClick={() => { setSelectedId(record.id); setFocusedFieldId(null); }}>
                <div className={`record-icon category-${record.category}`}><Icon size={18}/></div>
                <div className="record-summary">
                  <div className="record-title"><strong title={record.title}>{record.title}</strong>{record.favorite && <Star size={12} className="star-fill"/>}</div>
                  {record.subtitle && <p title={record.subtitle}>{record.subtitle}</p>}
                  {(showCategory || count > 0) && <div className="record-meta">{showCategory && <span>{categoryLabels[record.category][locale]}</span>}{count > 0 && <span><Paperclip size={11}/>{count}</span>}</div>}
                </div>
                <ChevronRight size={14} className="record-arrow"/>
              </button>{matches.length > 0 && <div className="field-search-results" aria-label={t('matchedFields')}>{matches.map(field => <div className="field-result" key={field.id}><button className="field-result-select" aria-label={`${t('showField')} ${fieldLabel(field, locale)}`} onClick={() => { setSelectedId(record.id); setFocusedFieldId(field.id); if (selected?.id === record.id) fieldNodes.current.get(field.id)?.scrollIntoView({ block: 'center', behavior: 'instant' }); }}><span className="field-result-label">{fieldLabel(field, locale)}</span><span className="field-result-value">{field.value ? field.sensitive ? '••••••••••••' : field.value : t('noValue')}</span></button><IconButton label={`${t('copy')} ${fieldLabel(field, locale)}`} disabled={!field.value} onClick={() => void copy(field.value)}><Copy size={14}/></IconButton></div>)}</div>}</div>;
            }) : snapshot.records.length > 0 && <div className="empty-list"><Search size={25}/><strong>{t('noResults')}</strong><p>{t('noResultsHint')}</p>{query && <button className="text-button" onClick={() => setQuery('')}>{t('clearSearch')}</button>}</div>}
          </div>
        </div>
        {selected ? <article className="detail-pane" key={selected.id}>
          <div className="detail-header"><div className="detail-category"><span className={`category-dot category-${selected.category}`}/>{categoryLabels[selected.category][locale]}</div><div className="detail-tools"><IconButton label={selected.favorite ? t('unfavorite') : t('favorite')} active={selected.favorite} disabled={busy} onClick={() => toggleFavorite(selected)}><Star size={17} className={selected.favorite ? 'star-fill' : ''}/></IconButton><IconButton label={t('delete')} disabled={busy} onClick={() => deleteRecord(selected)}><Trash2 size={17}/></IconButton><span className="tool-divider"/><button className="button small" onClick={() => beginEdit(selected)} disabled={busy}><Pencil size={14}/>{t('edit')}</button></div></div>
          <div className="detail-title"><h2>{selected.title}</h2>{selected.subtitle && <p>{selected.subtitle}</p>}{selected.tags.length > 0 && <div className="tags">{selected.tags.map((tag, index) => <span key={`${tag}-${index}`}>{tag}</span>)}</div>}</div>
          <section className="detail-section"><div className="section-heading"><h3>{t('details')}<small>{selected.fields.length}</small></h3><button className="text-button" title={t('copyNotice')} onClick={() => void copy(formatRecord(selected, locale))}><Copy size={14}/>{t('copyRecord')}</button></div>{selected.fields.length ? <div className="fields-list">{selected.fields.map(field => <div className={`field-row ${matchedFieldIds.has(field.id) || focusedFieldId === field.id ? 'field-found' : ''}`} key={field.id} data-field-id={field.id} ref={node => { if (node) fieldNodes.current.set(field.id, node); else fieldNodes.current.delete(field.id); }}><div className="field-label">{fieldLabel(field, locale)}{field.sensitive && <LockKeyhole size={11}/>}</div><div className={`field-value ${!field.value ? 'muted' : ''} ${field.sensitive && !visibleFields.has(field.id) ? 'masked' : ''}`}>{field.value ? field.sensitive && !visibleFields.has(field.id) ? '••••••••••••' : field.value : t('noValue')}</div><div className="field-actions">{field.sensitive && field.value && <IconButton label={visibleFields.has(field.id) ? t('hide') : t('reveal')} onClick={() => setVisibleFields(prev => { const next = new Set(prev); if (next.has(field.id)) next.delete(field.id); else next.add(field.id); return next; })}>{visibleFields.has(field.id) ? <EyeOff size={15}/> : <Eye size={15}/>}</IconButton>}<IconButton label={`${t('copy')} ${fieldLabel(field, locale)}`} disabled={!field.value} onClick={() => void copy(field.value)}><Copy size={15}/></IconButton></div></div>)}</div> : <div className="inline-empty">{t('noFieldsHint')}</div>}</section>
          <section className="detail-section"><div className="section-heading"><h3>{t('files')}<small>{recordFiles.length}</small></h3><button className="text-button" disabled={busy} onClick={() => addFiles(selected)}><Plus size={15}/>{t('attach')}</button></div>{recordFiles.length ? <div className="attachment-list">{recordFiles.map(file => <div className="attachment-row" key={file.id}><div className="file-icon"><FileText size={21}/></div><div className="attachment-name"><button className="file-open" title={file.fileName} aria-label={`${t('openFile')}: ${file.fileName}`} disabled={busy} onClick={() => void perform(async () => { await api.open(file.id); })}><strong title={file.fileName}>{file.fileName}</strong></button><span title={file.originalName}>{formatBytes(file.size)}<span className="meta-separator">·</span>{file.originalName}</span></div>{fileActions(file)}</div>)}</div> : <button className="attach-empty" disabled={busy} onClick={() => addFiles(selected)}><div><Paperclip size={20}/></div><span><strong>{t('noFiles')}</strong><small>{t('dropHint')}</small></span><Plus size={18}/></button>}</section>
          {selected.notes && <section className="detail-section"><div className="section-heading"><h3>{t('notes')}</h3><IconButton label={`${t('copy')} ${t('notes')}`} onClick={() => void copy(selected.notes)}><Copy size={14}/></IconButton></div><div className="notes-content">{selected.notes}</div></section>}
          <footer className="detail-footer"><span>{t('updated')} {shortDate(selected.updatedAt)}</span></footer>
        </article> : snapshot.records.length === 0 ? <div className="welcome"><div className="welcome-icon"><BookOpen size={36} strokeWidth={1.4}/></div><h2>{t('emptyTitle')}</h2><p>{t('emptyHint')}</p><div className="starter-templates">{templates.filter(x => ['identity', 'education', 'document'].includes(x.id)).map(template => <button key={template.id} onClick={() => beginEdit(createRecord(template.id, locale))}>{template.name[locale]}<ChevronRight size={14}/></button>)}</div></div> : <div className="center-state"><BookOpen size={32}/><h2>{t('selectRecord')}</h2></div>}
      </section>}
    </main>

    {templateOpen && <Modal title={t('chooseTemplate')} close={closeTemplates} closeLabel={t('close')} wide><p className="modal-description">{t('templateHint')}</p><div className="template-grid">{templates.map(template => { const Icon = categoryIcons[template.category]; return <button key={template.id} className="template-card" onClick={() => { setTemplateOpen(false); beginEdit(createRecord(template.id, locale)); }}><div className={`record-icon category-${template.category}`}><Icon size={20}/></div><strong>{template.name[locale]}</strong><span>{template.description[locale]}</span><ChevronRight size={15}/></button>; })}</div></Modal>}

    {draft && <Modal title={snapshot.records.some(r => r.id === draft.id) ? t('edit') : t('newRecord')} close={closeEditor} closeLabel={t('close')} wide><form onSubmit={e => void saveDraft(e)} className="editor-form"><div className="editor-scroll"><div className="editor-top"><label className="form-label">{t('title')}<input data-autofocus value={draft.title} maxLength={200} onChange={e => setDraft({ ...draft, title: e.target.value })} required/></label><label className="form-label">{t('category')}<select value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value as Category })}>{categories.map(c => <option key={c} value={c}>{categoryLabels[c][locale]}</option>)}</select></label></div><label className="form-label">{t('subtitle')}<input value={draft.subtitle} maxLength={300} onChange={e => setDraft({ ...draft, subtitle: e.target.value })}/></label><label className="form-label">{t('tags')}<input value={draft.tags.join(',')} placeholder={t('tagsHint')} onChange={e => setDraft({ ...draft, tags: e.target.value.split(/[,，]/) })}/></label><div className="editor-section-heading"><h3>{t('fields')} · {draft.fields.length}</h3></div><FieldEditor fields={draft.fields} locale={locale} disabled={busy} onChange={fields => setDraft(current => current ? { ...current, fields } : null)}/><label className="form-label">{t('notes')}<textarea value={draft.notes} rows={4} onChange={e => setDraft({ ...draft, notes: e.target.value })}/></label>{editError && <p className="form-error" role="alert">{editError}</p>}</div><footer className="modal-footer"><button type="button" className="button" onClick={closeEditor} disabled={busy}>{t('cancel')}</button><button type="submit" className="button primary" disabled={busy}>{busy ? <span className="spinner small-spinner"/> : <Check size={16}/ >}{busy ? t('saving') : t('save')}</button></footer></form></Modal>}

    {settingsOpen && <Modal title={t('settings')} close={closeSettings} closeLabel={t('close')}><div className="settings-content"><div className="settings-row"><div><Languages size={18}/><strong>{t('language')}</strong></div><select aria-label={t('language')} value={locale} onChange={e => setLocale(e.target.value as Locale)}><option value="en">English</option><option value="zh">简体中文</option></select></div><div className="settings-section"><div className="settings-section-title"><Palette size={19}/><h3>{t('appearance')}</h3></div><div className="appearance-controls"><fieldset><legend>{t('theme')}</legend><div className="theme-modes">{themeModes.map(theme => <button type="button" key={theme} className="theme-mode" aria-pressed={appearance.theme === theme} onClick={() => setAppearance(current => ({ ...current, theme }))}>{theme === 'light' ? <Sun size={17}/> : <Moon size={17}/ >}{t(theme)}</button>)}</div></fieldset><fieldset><legend>{t('accentColor')}</legend><div className="accent-options">{accentColors.map(accent => <button type="button" key={accent} className="accent-option" title={t(accent)} aria-label={t(accent)} aria-pressed={appearance.accent === accent} onClick={() => setAppearance(current => ({ ...current, accent }))}><span className="accent-swatch" style={{ '--swatch': accentSwatches[accent] } as CSSProperties}/></button>)}</div></fieldset><button type="button" className="text-button" onClick={() => setAppearance({ theme: 'light', accent: 'sage' })}>{t('resetAppearance')}</button></div></div><div className="settings-section"><div className="settings-section-title"><Database size={19}/><h3>{t('storage')}</h3></div><label className="form-label">{t('dataFolder')}<div className="path-box"><code>{snapshot.dataDir}</code><IconButton label={t('copyPath')} disabled={!desktop} onClick={() => void copy(snapshot.dataDir)}><Copy size={15}/></IconButton></div></label><button className="button" disabled={!desktop || busy} onClick={() => void perform(async () => { await api.folder(); })}><FolderOpen size={16}/>{t('openFolder')}</button><p className="privacy-note">{t('storageDetail')}</p></div><div className="settings-section"><h3>{t('backup')}</h3><p>{t('backupHelp')}</p><div className="backup-actions"><button className="button" disabled={!desktop || busy} onClick={() => void perform(async () => { const path = await api.backup(locale); if (path) setToast({ text: t('backupSaved') }); })}><ArrowDownToLine size={16}/>{t('backup')}</button><button className="button" disabled={!desktop || busy} onClick={() => setConfirm({ title: t('restoreTitle'), body: t('restoreBody'), label: t('restore'), action: async () => { if (await api.restore(locale)) { await refresh(); setSelectedId(null); setQuery(''); setToast({ text: t('restored') }); } } })}><ArrowUpFromLine size={16}/>{t('restore')}</button></div></div><footer className="settings-footer"><span>Folio</span><span>{version}</span></footer></div></Modal>}

    {dragging && <div className="drop-overlay" role="status"><div className="drop-card"><Upload size={36}/><strong>{!desktop ? t('desktopOnly') : busy ? t('dropBusy') : modalOpen ? t('dropBlocked') : t('dropFiles')}</strong>{desktop && !busy && !modalOpen && <span className="drop-target">{selected && view !== 'files' ? selected.title : t('dropChoose')}</span>}</div></div>}

    {pendingPaths && <Modal title={t('importFiles')} close={closeImport} closeLabel={t('close')}><form onSubmit={event => void importPendingFiles(event)}><div className="import-target"><p className="file-drop-hint">{pendingPaths.length} {t(pendingPaths.length === 1 ? 'fileSingular' : 'fileCount')}</p><label className="form-label">{t('importTarget')}<select data-autofocus value={importRecordId} onChange={event => { setImportRecordId(event.target.value); setImportError(''); }} disabled={busy}>{sortRecords(snapshot.records, 'title-asc', locale).map(record => <option key={record.id} value={record.id}>{record.title}</option>)}<option value="__new__">{t('newDocument')}</option></select></label>{importRecordId === '__new__' && <label className="form-label">{t('importTitle')}<input value={importTitle} maxLength={200} onChange={event => setImportTitle(event.target.value)} required disabled={busy}/></label>}{importError && <p className="form-error" role="alert">{importError}</p>}</div><footer className="modal-footer"><button type="button" className="button" onClick={closeImport} disabled={busy}>{t('cancel')}</button><button type="submit" className="button primary" disabled={busy}>{busy ? <span className="spinner small-spinner"/> : <Upload size={16}/>}{busy ? t('importing') : t('importFiles')}</button></footer></form></Modal>}

    {renameFile && <Modal title={t('rename')} close={closeRename} closeLabel={t('close')}><form onSubmit={e => { e.preventDefault(); void perform(async () => { await api.rename(renameFile.id, renameName); await refresh(); setRenameFile(null); setToast({ text: t('renamed') }); }); }}><div className="confirm-body"><label className="form-label">{t('fileName')}<input data-autofocus value={renameName} onChange={e => setRenameName(e.target.value)} required maxLength={160}/></label><p>{t('nameHint')}</p></div><footer className="modal-footer"><button className="button" type="button" onClick={closeRename} disabled={busy}>{t('cancel')}</button><button className="button primary" type="submit" disabled={busy}>{t('save')}</button></footer></form></Modal>}

    {confirm && <Modal title={confirm.title} close={closeConfirm} closeLabel={t('close')}><div className="confirm-body"><p>{confirm.body}</p></div><footer className="modal-footer"><button className="button" onClick={closeConfirm} disabled={busy}>{t('cancel')}</button><button className="button danger" disabled={busy} onClick={() => void perform(async () => { await confirm.action(); setConfirm(null); })}>{confirm.label ?? t('confirm')}</button></footer></Modal>}

    {toast && <div className={`toast ${toast.error ? 'error-toast' : ''}`} role={toast.error ? 'alert' : 'status'}>{toast.pending ? <span className="spinner small-spinner"/> : toast.error ? <X size={17}/> : <CheckCircle2 size={17}/>}<span>{toast.text}</span>{toast.undo && <button onClick={() => void perform(async () => { await toast.undo!(); setToast(null); })} disabled={busy}>{t('undo')}</button>}<IconButton label={t('close')} onClick={() => setToast(null)}><X size={14}/></IconButton></div>}
  </div>;
}
