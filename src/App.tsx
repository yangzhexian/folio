import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode, FormEvent } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ArrowDownToLine, ArrowUpFromLine, BookOpen, Check, CheckCircle2, ChevronRight, Copy, Database, FileText, Folder, FolderOpen, GraduationCap, Languages, Layers, LockKeyhole, MoreHorizontal, Pencil, Plus, Search, Settings, ShieldCheck, Star, Trash2, UserRound, Users, X, Eye, EyeOff, BriefcaseBusiness, Award, FlaskConical, Paperclip } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { api, desktop } from './api';
import type { Attachment, Category, Field, FieldKind, Locale, ProfileRecord, Snapshot } from './types';
import { categories, categoryLabels, createRecord, templates } from './templates';
import { fieldLabel, filterRecords, formatBytes, formatRecord } from './domain';
import { tFor } from './i18n';

const categoryIcons: Record<Category, LucideIcon> = { identity: UserRound, education: GraduationCap, experience: BriefcaseBusiness, research: FlaskConical, awards: Award, skills: Languages, contacts: Users, documents: FileText, custom: Layers };
type View = 'all' | 'favorites' | 'files' | Category;
type ConfirmState = { title: string; body: string; action: () => Promise<void> | void; label?: string };
type Toast = { text: string; error?: boolean; undo?: () => Promise<void> };

function IconButton({ label, children, onClick, active, disabled, className = '' }: { label: string; children: ReactNode; onClick: () => void; active?: boolean; disabled?: boolean; className?: string }) {
  return <button type="button" className={`icon-button ${active ? 'active' : ''} ${className}`} onClick={onClick} title={label} aria-label={label} disabled={disabled}>{children}</button>;
}

function Modal({ title, close, children, wide = false, closeLabel }: { title: string; close: () => void; children: ReactNode; wide?: boolean; closeLabel: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const node = ref.current!;
    (node.querySelector('[autofocus], input, textarea, button') as HTMLElement)?.focus();
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
    return () => { document.removeEventListener('keydown', key); previous?.focus(); };
  }, []);
  return <div className="modal-backdrop"><div ref={ref} className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}><header className="modal-header"><h2>{title}</h2><IconButton label={closeLabel} onClick={close}><X size={19}/></IconButton></header>{children}</div></div>;
}

export default function App() {
  const [locale, setLocale] = useState<Locale>(() => localStorage.getItem('folio.locale') === 'zh' ? 'zh' : 'en');
  const t = tFor(locale);
  const [snapshot, setSnapshot] = useState<Snapshot>({ records: [], attachments: [], dataDir: '' });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [view, setView] = useState<View>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState<ProfileRecord | null>(null);
  const [draftOriginal, setDraftOriginal] = useState('');
  const [editError, setEditError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [visibleFields, setVisibleFields] = useState<Set<string>>(new Set());
  const [renameFile, setRenameFile] = useState<Attachment | null>(null);
  const [renameName, setRenameName] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const closeState = useRef({ dirty: false, busy: false, locale });
  closeState.current = { dirty: !!draft && JSON.stringify(draft) !== draftOriginal, busy, locale };

  const refresh = useCallback(async () => { const next = await api.load(); setSnapshot(next); return next; }, []);
  const load = useCallback(async () => {
    setLoading(true); setLoadError('');
    try { const data = await refresh(); setSelectedId(id => id ?? data.records[0]?.id ?? null); }
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
  useEffect(() => { if (!toast) return; const id = window.setTimeout(() => setToast(null), toast.undo ? 12000 : toast.error ? 9000 : 3500); return () => clearTimeout(id); }, [toast]);
  useEffect(() => { setVisibleFields(new Set()); }, [selectedId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); searchRef.current?.focus(); } };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    if (!draft || JSON.stringify(draft) === draftOriginal) return;
    const guard = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard);
  }, [draft, draftOriginal]);

  const filtered = useMemo(() => filterRecords(snapshot.records, snapshot.attachments, query, view === 'files' ? 'all' : view), [snapshot, query, view]);
  const selected = filtered.find(r => r.id === selectedId) ?? filtered[0];
  const recordFiles = snapshot.attachments.filter(a => a.recordId === selected?.id);
  const fileResults = snapshot.attachments.filter(a => filtered.some(r => r.id === a.recordId));
  const title = view === 'all' ? t('all') : view === 'favorites' ? t('favorites') : view === 'files' ? t('fileLibrary') : categoryLabels[view][locale];
  const fail = (error: unknown) => setToast({ text: String(error).includes('DESKTOP_ONLY') ? t('desktopOnly') : `${t('error')}: ${String(error)}`, error: true });
  const perform = async (action: () => Promise<void>) => { if (busy) return; setBusy(true); try { await action(); } catch (e) { fail(e); } finally { setBusy(false); } };
  const copy = async (value: string) => { try { await api.copy(value); setToast({ text: t('copied') }); } catch (e) { fail(e); } };
  const navigate = (next: View) => { setView(next); setSelectedId(null); setVisibleFields(new Set()); };
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
    <IconButton label={t('rename')} disabled={busy} onClick={() => { setRenameFile(file); setRenameName(file.fileName.replace(/\.[^.]+$/, '').replace(/^[^_]+__/, '').replace(/__[a-f0-9]{12}$/, '')); }}><Pencil size={15}/></IconButton>
    <IconButton label={t('remove')} disabled={busy} onClick={() => removeFile(file)}><Trash2 size={15}/></IconButton>
  </div>;
  const shortDate = (value: string) => new Date(value).toLocaleDateString(locale === 'zh' ? 'zh-CN' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const patchField = (id: string, patch: Partial<Field>) => setDraft(prev => prev ? { ...prev, fields: prev.fields.map(f => f.id === id ? { ...f, ...patch } : f) } : null);

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><BookOpen size={21} strokeWidth={1.8}/></div><span>folio<span className="brand-dot">.</span></span><span className="version">{t('localBadge')}</span></div>
      <div className="workspace"><div className="workspace-avatar"><UserRound size={18}/></div><div><strong>{t('library')}</strong><span><span className="status-dot"/>{t('localOnly')}</span></div></div>
      <nav aria-label={t('library')}>
        <button className={`nav-item ${view === 'all' ? 'selected' : ''}`} onClick={() => navigate('all')}><Layers size={17}/><span>{t('all')}</span><small>{snapshot.records.length}</small></button>
        <button className={`nav-item ${view === 'favorites' ? 'selected' : ''}`} onClick={() => navigate('favorites')}><Star size={17}/><span>{t('favorites')}</span><small>{snapshot.records.filter(r => r.favorite).length}</small></button>
        <button className={`nav-item ${view === 'files' ? 'selected' : ''}`} onClick={() => navigate('files')}><Folder size={17}/><span>{t('files')}</span><small>{snapshot.attachments.length}</small></button>
        <div className="nav-caption">{t('collections')}</div>
        {categories.map(category => { const Icon = categoryIcons[category]; const count = snapshot.records.filter(r => r.category === category).length; return <button key={category} className={`nav-item ${view === category ? 'selected' : ''}`} onClick={() => navigate(category)}><Icon size={17}/><span>{categoryLabels[category][locale]}</span>{count > 0 && <small>{count}</small>}</button>; })}
      </nav>
      <div className="sidebar-bottom"><button className="nav-item" onClick={() => setSettingsOpen(true)}><Settings size={17}/><span>{t('settings')}</span></button><div className="local-signature"><ShieldCheck size={14}/><span>{t('localOnly')}</span></div></div>
    </aside>

    <main className="main">
      <header className="topbar"><div className="breadcrumb"><span>Folio</span><ChevronRight size={13}/><span>{t('library')}</span></div><div className="search-box"><Search size={17}/><input ref={searchRef} value={query} onChange={e => setQuery(e.target.value)} placeholder={t('search')} aria-label={t('search')}/>{query ? <IconButton label={t('clearSearch')} onClick={() => setQuery('')}><X size={14}/></IconButton> : <kbd>Ctrl K</kbd>}</div><button className="locale-toggle" onClick={() => setLocale(locale === 'en' ? 'zh' : 'en')} title={t('language')} aria-label={t('language')}><Languages size={16}/><span>{locale === 'en' ? '中文' : 'EN'}</span></button></header>
      {!desktop && <div className="preview-banner"><span className="status-dot"/>{t('preview')}</div>}
      <div className="page-heading"><div><div className="eyebrow">{t('library')}</div><h1>{title}<span className="count-badge">{view === 'files' ? snapshot.attachments.length : filtered.length}</span></h1></div><button className="button primary" onClick={() => setTemplateOpen(true)} disabled={loading || !!loadError}><Plus size={17}/>{t('newRecord')}</button></div>

      {loading ? <div className="center-state"><div className="spinner"/><p>{t('loading')}</p></div> : loadError ? <div className="center-state"><Database size={32}/><h2>{t('error')}</h2><p className="error-message">{loadError}</p><button className="button" onClick={() => void load()}>{t('retry')}</button></div> : snapshot.records.length === 0 ? <div className="welcome"><div className="welcome-icon"><BookOpen size={36} strokeWidth={1.4}/></div><span className="eyebrow">{t('welcomeEyebrow')}</span><h2>{t('emptyTitle')}</h2><p>{t('emptyHint')}</p><button className="button primary" onClick={() => setTemplateOpen(true)}><Plus size={17}/>{t('start')}</button><div className="starter-templates">{templates.filter(x => ['identity', 'education', 'document'].includes(x.id)).map(template => <button key={template.id} onClick={() => beginEdit(createRecord(template.id, locale))}>{template.name[locale]}<ChevronRight size={14}/></button>)}</div><div className="welcome-footer"><LockKeyhole size={14}/>{t('privacy')}</div></div> : view === 'files' ? <section className="file-library">
        <div className="section-toolbar"><span>{fileResults.length} {t('fileCount')}</span><span className="muted">{t('standardNaming')}</span></div>
        {fileResults.length ? <div className="file-table"><div className="file-table-head"><span>{t('name')}</span><span>{t('record')}</span><span>{t('size')}</span><span>{t('actions')}</span></div>{fileResults.map(file => <div className="file-table-row" key={file.id}><div className="file-name"><div className="file-icon"><FileText size={20}/></div><div><strong>{file.fileName}</strong><span>{file.originalName}</span></div></div><button className="text-button file-parent" onClick={() => { setView('all'); setQuery(''); setSelectedId(file.recordId); }}>{snapshot.records.find(r => r.id === file.recordId)?.title}</button><span className="mono muted">{formatBytes(file.size)}</span>{fileActions(file)}</div>)}</div> : <div className="center-state"><FolderOpen size={35}/><h2>{t('noFiles')}</h2><p>{t('noFilesHint')}</p></div>}
      </section> : <section className="library-layout">
        <div className="record-pane"><div className="list-caption"><span>{query ? `${filtered.length} ${t('records')}` : t('recent')}</span><MoreHorizontal size={17}/></div><div className="record-list">{filtered.length ? filtered.map(record => { const Icon = categoryIcons[record.category]; const count = snapshot.attachments.filter(a => a.recordId === record.id).length; return <button key={record.id} className={`record-card ${selected?.id === record.id ? 'selected' : ''}`} onClick={() => setSelectedId(record.id)}><div className={`record-icon category-${record.category}`}><Icon size={18}/></div><div className="record-summary"><div className="record-title"><strong>{record.title}</strong>{record.favorite && <Star size={12} className="star-fill"/>}</div><p>{record.subtitle || categoryLabels[record.category][locale]}</p><div className="record-meta"><span>{categoryLabels[record.category][locale]}</span>{count > 0 && <span><Paperclip size={11}/>{count}</span>}</div></div><ChevronRight size={14} className="record-arrow"/></button>; }) : <div className="empty-list"><Search size={25}/><strong>{t('noResults')}</strong><p>{t('noResultsHint')}</p>{query && <button className="text-button" onClick={() => setQuery('')}>{t('clearSearch')}</button>}</div>}</div><div className="list-footer"><CheckCircle2 size={12}/>{t('savedLocally')}</div></div>
        {selected ? <article className="detail-pane" key={selected.id}>
          <div className="detail-header"><div className="detail-category"><span className={`category-dot category-${selected.category}`}/>{categoryLabels[selected.category][locale]}</div><div className="detail-tools"><IconButton label={selected.favorite ? t('unfavorite') : t('favorite')} active={selected.favorite} disabled={busy} onClick={() => toggleFavorite(selected)}><Star size={17} className={selected.favorite ? 'star-fill' : ''}/></IconButton><IconButton label={t('delete')} disabled={busy} onClick={() => deleteRecord(selected)}><Trash2 size={17}/></IconButton><span className="tool-divider"/><button className="button small" onClick={() => beginEdit(selected)} disabled={busy}><Pencil size={14}/>{t('edit')}</button></div></div>
          <div className="detail-title"><h2>{selected.title}</h2>{selected.subtitle && <p>{selected.subtitle}</p>}{selected.tags.length > 0 && <div className="tags">{selected.tags.map((tag, index) => <span key={`${tag}-${index}`}>{tag}</span>)}</div>}</div>
          <section className="detail-section"><div className="section-heading"><h3>{t('details')}<small>{selected.fields.length}</small></h3><button className="text-button" title={t('copyNotice')} onClick={() => void copy(formatRecord(selected, locale))}><Copy size={14}/>{t('copyRecord')}</button></div>{selected.fields.length ? <div className="fields-list">{selected.fields.map(field => <div className="field-row" key={field.id}><div className="field-label">{fieldLabel(field, locale)}{field.sensitive && <LockKeyhole size={11}/>}</div><div className={`field-value ${!field.value ? 'muted' : ''} ${field.sensitive && !visibleFields.has(field.id) ? 'masked' : ''}`}>{field.value ? field.sensitive && !visibleFields.has(field.id) ? '••••••••••••' : field.value : t('noValue')}</div><div className="field-actions">{field.sensitive && field.value && <IconButton label={visibleFields.has(field.id) ? t('hide') : t('reveal')} onClick={() => setVisibleFields(prev => { const next = new Set(prev); if (next.has(field.id)) next.delete(field.id); else next.add(field.id); return next; })}>{visibleFields.has(field.id) ? <EyeOff size={15}/> : <Eye size={15}/>}</IconButton>}<IconButton label={`${t('copy')} ${fieldLabel(field, locale)}`} disabled={!field.value} onClick={() => void copy(field.value)}><Copy size={15}/></IconButton></div></div>)}</div> : <div className="inline-empty">{t('noFieldsHint')}</div>}</section>
          <section className="detail-section"><div className="section-heading"><h3>{t('files')}<small>{recordFiles.length}</small></h3><button className="text-button" disabled={busy} onClick={() => addFiles(selected)}><Plus size={15}/>{t('attach')}</button></div>{recordFiles.length ? <div className="attachment-list">{recordFiles.map(file => <div className="attachment-row" key={file.id}><div className="file-icon"><FileText size={21}/></div><div className="attachment-name"><strong title={file.fileName}>{file.fileName}</strong><span>{formatBytes(file.size)}<span className="meta-separator">·</span>{file.originalName}</span></div>{fileActions(file)}</div>)}</div> : <button className="attach-empty" disabled={busy} onClick={() => addFiles(selected)}><div><Paperclip size={20}/></div><span><strong>{t('noFiles')}</strong><small>{t('noFilesHint')}</small></span><Plus size={18}/></button>}</section>
          {selected.notes && <section className="detail-section"><div className="section-heading"><h3>{t('notes')}</h3><IconButton label={`${t('copy')} ${t('notes')}`} onClick={() => void copy(selected.notes)}><Copy size={14}/></IconButton></div><div className="notes-content">{selected.notes}</div></section>}
          <footer className="detail-footer"><span>{t('updated')} {shortDate(selected.updatedAt)}</span><span><ShieldCheck size={12}/>{t('localOnly')}</span></footer>
        </article> : <div className="center-state"><BookOpen size={32}/><h2>{t('selectRecord')}</h2><p>{t('selectHint')}</p></div>}
      </section>}
    </main>

    {templateOpen && <Modal title={t('chooseTemplate')} close={closeTemplates} closeLabel={t('close')} wide><p className="modal-description">{t('templateHint')}</p><div className="template-grid">{templates.map(template => { const Icon = categoryIcons[template.category]; return <button key={template.id} className="template-card" onClick={() => { setTemplateOpen(false); beginEdit(createRecord(template.id, locale)); }}><div className={`record-icon category-${template.category}`}><Icon size={20}/></div><strong>{template.name[locale]}</strong><span>{template.description[locale]}</span><ChevronRight size={15}/></button>; })}</div></Modal>}

    {draft && <Modal title={snapshot.records.some(r => r.id === draft.id) ? t('edit') : t('newRecord')} close={closeEditor} closeLabel={t('close')} wide><form onSubmit={e => void saveDraft(e)} className="editor-form"><div className="editor-scroll"><div className="editor-top"><label className="form-label">{t('title')}<input autoFocus value={draft.title} maxLength={200} onChange={e => setDraft({ ...draft, title: e.target.value })} required/></label><label className="form-label">{t('category')}<select value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value as Category })}>{categories.map(c => <option key={c} value={c}>{categoryLabels[c][locale]}</option>)}</select></label></div><label className="form-label">{t('subtitle')}<input value={draft.subtitle} maxLength={300} onChange={e => setDraft({ ...draft, subtitle: e.target.value })}/></label><label className="form-label">{t('tags')}<input value={draft.tags.join(',')} placeholder={t('tagsHint')} onChange={e => setDraft({ ...draft, tags: e.target.value.split(/[,，]/) })}/></label><div className="editor-section-heading"><h3>{t('fields')}</h3><button type="button" className="text-button" onClick={() => setDraft({ ...draft, fields: [...draft.fields, { id: crypto.randomUUID(), label: '', labelZh: '', value: '', kind: 'text', sensitive: false }] })}><Plus size={15}/>{t('addField')}</button></div><div className="editor-fields">{draft.fields.map((field, index) => <div className="editor-field" key={field.id}><div className="editor-field-heading"><span className="field-number">{String(index + 1).padStart(2, '0')}</span><input aria-label={`${t('label')} ${index + 1}`} value={field.label} placeholder={t('label')} onChange={e => patchField(field.id, { label: e.target.value })} required/><input aria-label={`${t('labelZh')} ${index + 1}`} value={field.labelZh ?? ''} placeholder={t('labelZh')} onChange={e => patchField(field.id, { labelZh: e.target.value })}/><IconButton label={`${t('remove')} ${fieldLabel(field, locale) || index + 1}`} onClick={() => setDraft({ ...draft, fields: draft.fields.filter(f => f.id !== field.id) })}><X size={15}/></IconButton></div>{field.kind === 'multiline' ? <textarea aria-label={`${t('value')} ${index + 1}`} value={field.value} placeholder={fieldLabel(field, locale)} onChange={e => patchField(field.id, { value: e.target.value })} rows={3}/> : <input aria-label={`${t('value')} ${index + 1}`} value={field.value} type={field.kind === 'date' ? 'date' : 'text'} placeholder={fieldLabel(field, locale)} onChange={e => patchField(field.id, { value: e.target.value })}/>}<div className="editor-field-options"><select aria-label={`${t('kind')} ${index + 1}`} value={field.kind} onChange={e => patchField(field.id, { kind: e.target.value as FieldKind })}>{(['text', 'multiline', 'date', 'email', 'phone', 'url'] as FieldKind[]).map(kind => <option key={kind} value={kind}>{t(kind)}</option>)}</select><label><input type="checkbox" checked={field.sensitive} onChange={e => patchField(field.id, { sensitive: e.target.checked })}/><LockKeyhole size={12}/>{t('sensitive')}</label></div></div>)}</div><button type="button" className="button add-field-button" onClick={() => setDraft({ ...draft, fields: [...draft.fields, { id: crypto.randomUUID(), label: '', labelZh: '', value: '', kind: 'text', sensitive: false }] })}><Plus size={15}/>{t('addField')}</button><label className="form-label">{t('notes')}<textarea value={draft.notes} rows={4} onChange={e => setDraft({ ...draft, notes: e.target.value })}/></label>{editError && <p className="form-error" role="alert">{editError}</p>}</div><footer className="modal-footer"><span><LockKeyhole size={13}/>{t('localOnly')}</span><button type="button" className="button" onClick={closeEditor} disabled={busy}>{t('cancel')}</button><button type="submit" className="button primary" disabled={busy}>{busy ? <span className="spinner small-spinner"/> : <Check size={16}/ >}{busy ? t('saving') : t('save')}</button></footer></form></Modal>}

    {settingsOpen && <Modal title={t('settings')} close={closeSettings} closeLabel={t('close')}><div className="settings-content"><div className="settings-row"><div><Languages size={18}/><strong>{t('language')}</strong></div><select aria-label={t('language')} value={locale} onChange={e => setLocale(e.target.value as Locale)}><option value="en">English</option><option value="zh">简体中文</option></select></div><div className="settings-section"><div className="settings-section-title"><ShieldCheck size={19}/><h3>{t('storage')}</h3><span className="local-badge">{t('localBadge')}</span></div><p>{t('privacy')}</p><label className="form-label">{t('dataFolder')}<div className="path-box"><code>{snapshot.dataDir}</code><IconButton label={t('copyPath')} disabled={!desktop} onClick={() => void copy(snapshot.dataDir)}><Copy size={15}/></IconButton></div></label><button className="button" disabled={!desktop || busy} onClick={() => void perform(async () => { await api.folder(); })}><FolderOpen size={16}/>{t('openFolder')}</button><p className="privacy-note">{t('storageDetail')}</p></div><div className="settings-section"><h3>{t('backup')}</h3><p>{t('backupHelp')}</p><div className="backup-actions"><button className="button" disabled={!desktop || busy} onClick={() => void perform(async () => { const path = await api.backup(locale); if (path) setToast({ text: t('backupSaved') }); })}><ArrowDownToLine size={16}/>{t('backup')}</button><button className="button" disabled={!desktop || busy} onClick={() => setConfirm({ title: t('restoreTitle'), body: t('restoreBody'), label: t('restore'), action: async () => { if (await api.restore(locale)) { await refresh(); setSelectedId(null); setQuery(''); setToast({ text: t('restored') }); } } })}><ArrowUpFromLine size={16}/>{t('restore')}</button></div></div><footer className="settings-footer"><span>Folio</span><span>0.1.0</span></footer></div></Modal>}

    {renameFile && <Modal title={t('rename')} close={closeRename} closeLabel={t('close')}><form onSubmit={e => { e.preventDefault(); void perform(async () => { await api.rename(renameFile.id, renameName); await refresh(); setRenameFile(null); setToast({ text: t('renamed') }); }); }}><div className="confirm-body"><label className="form-label">{t('fileName')}<input autoFocus value={renameName} onChange={e => setRenameName(e.target.value)} required maxLength={160}/></label><p>{t('nameHint')}</p></div><footer className="modal-footer"><button className="button" type="button" onClick={closeRename} disabled={busy}>{t('cancel')}</button><button className="button primary" type="submit" disabled={busy}>{t('save')}</button></footer></form></Modal>}

    {confirm && <Modal title={confirm.title} close={closeConfirm} closeLabel={t('close')}><div className="confirm-body"><p>{confirm.body}</p></div><footer className="modal-footer"><button className="button" onClick={closeConfirm} disabled={busy}>{t('cancel')}</button><button className="button danger" disabled={busy} onClick={() => void perform(async () => { await confirm.action(); setConfirm(null); })}>{confirm.label ?? t('confirm')}</button></footer></Modal>}

    {toast && <div className={`toast ${toast.error ? 'error-toast' : ''}`} role={toast.error ? 'alert' : 'status'}>{toast.error ? <X size={17}/> : <CheckCircle2 size={17}/>}<span>{toast.text}</span>{toast.undo && <button onClick={() => void perform(async () => { await toast.undo!(); setToast(null); })} disabled={busy}>{t('undo')}</button>}<IconButton label={t('close')} onClick={() => setToast(null)}><X size={14}/></IconButton></div>}
  </div>;
}
