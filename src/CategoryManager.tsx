import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent, PointerEvent } from 'react';
import { ArrowDown, ArrowUp, Check, GripVertical, Plus, Trash2 } from 'lucide-react';
import { categoryIconIds, categoryName, maxCategories, moveCategory } from './categories';
import { categoryIcon, categoryIconName } from './categoryIcons';
import { tFor } from './i18n';
import type { Category, CategoryDefinition, Locale } from './types';

type Drag = { id: Category; target: Category; pointer: number; x: number; y: number; startX: number; startY: number; active: boolean };

export function CategoryManager({ categories, initialIds, locale, busy, error, onChange, onSave, onClose }: {
  categories: CategoryDefinition[]; initialIds: Set<Category>; locale: Locale; busy: boolean; error: string;
  onChange: (categories: CategoryDefinition[]) => void; onSave: (event: FormEvent) => void; onClose: () => void;
}) {
  const t = tFor(locale);
  const [picker, setPicker] = useState<Category | null>(null);
  const [focusId, setFocusId] = useState<Category | null>(null);
  const [dragView, setDragView] = useState<{ id: Category; target: Category } | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const scroll = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const latest = useRef({ categories, busy, onChange, locale });
  latest.current = { categories, busy, onChange, locale };

  useLayoutEffect(() => {
    if (!focusId) return;
    const input = scroll.current?.querySelector<HTMLInputElement>(`[data-category-id="${focusId}"] input`);
    input?.focus();
    input?.scrollIntoView({ block: 'nearest' });
    setFocusId(null);
  }, [focusId]);

  useEffect(() => {
    if (!dragView) return;
    let frame = 0;
    const tick = () => {
      const current = drag.current;
      const area = scroll.current;
      if (current?.active && area) {
        const box = area.getBoundingClientRect();
        if (current.y < box.top + 36) area.scrollTop -= Math.min(16, (box.top + 36 - current.y) / 3);
        else if (current.y > box.bottom - 36) area.scrollTop += Math.min(16, (current.y - box.bottom + 36) / 3);
        const row = document.elementFromPoint(current.x, Math.max(box.top + 2, Math.min(box.bottom - 2, current.y)))?.closest<HTMLElement>('[data-category-id]');
        if (row && area.contains(row) && row.dataset.categoryId !== current.target) {
          current.target = row.dataset.categoryId as Category;
          setDragView({ id: current.id, target: current.target });
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [!!dragView]);

  function move(id: Category, target: number) {
    const current = latest.current;
    if (current.busy) return;
    const next = moveCategory(current.categories, id, target);
    if (next !== current.categories) {
      current.onChange(next);
      setAnnouncement(`${categoryName(next[target], current.locale)}, ${target + 1} / ${next.length}`);
    }
  }
  function startDrag(event: PointerEvent<HTMLButtonElement>, id: Category) {
    if (busy || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id, target: id, pointer: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, active: false };
    setPicker(null);
  }
  function updateDrag(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    current.x = event.clientX;
    current.y = event.clientY;
    if (!current.active && Math.hypot(current.x - current.startX, current.y - current.startY) > 4) {
      current.active = true;
      setDragView({ id: current.id, target: current.target });
    }
  }
  function endDrag(cancel = false) {
    const current = drag.current;
    drag.current = null;
    setDragView(null);
    if (current?.active && !cancel) move(current.id, latest.current.categories.findIndex(category => category.id === current.target));
  }
  function update(id: Category, patch: Partial<CategoryDefinition>) {
    onChange(categories.map(category => category.id === id ? { ...category, ...patch } : category));
  }
  function add() {
    if (busy || categories.length >= maxCategories) return;
    const id: Category = `collection-${crypto.randomUUID()}`;
    onChange([...categories, { id, nameEn: '', nameZh: '', icon: 'folder' }]);
    setPicker(null);
    setFocusId(id);
  }

  return <form className="category-manager editor-form" onSubmit={onSave} onKeyDown={event => {
    if (event.key === 'Escape' && (picker || drag.current)) {
      event.preventDefault(); event.stopPropagation();
      if (picker) scroll.current?.querySelector<HTMLButtonElement>(`[data-category-id="${picker}"] .category-icon-button`)?.focus();
      setPicker(null); endDrag(true);
    }
  }}>
    <div className="category-manager-scroll" ref={scroll}>
      <div className="category-columns" aria-hidden="true"><span/ ><span>{t('categoryEnglishName')}</span><span>{t('categoryChineseName')}</span><span/></div>
      <div className="category-list">
        {categories.map((category, index) => {
          const Icon = categoryIcon(category.icon);
          return <div key={category.id} data-category-id={category.id} className={`category-row ${dragView?.id === category.id ? 'dragging' : ''} ${dragView?.target === category.id && dragView.id !== category.id ? 'drop-target' : ''}`}>
            <div className="category-row-main">
              <div className="category-row-icons">
                <button type="button" className="icon-button category-drag" aria-label={t('reorderCategory')} title={t('reorderCategory')} disabled={busy}
                  onPointerDown={event => startDrag(event, category.id)} onPointerMove={updateDrag} onPointerUp={() => endDrag()} onPointerCancel={() => endDrag(true)} onLostPointerCapture={() => endDrag(true)}
                  onKeyDown={event => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); move(category.id, index + (event.key === 'ArrowUp' ? -1 : 1)); } }}><GripVertical size={16}/></button>
                <button type="button" className="category-icon-button" aria-label={t('chooseCategoryIcon')} title={t('chooseCategoryIcon')} aria-expanded={picker === category.id} disabled={busy} onClick={() => setPicker(picker === category.id ? null : category.id)}><Icon size={20}/></button>
              </div>
              <input aria-label={t('categoryEnglishName')} value={category.nameEn} maxLength={60} disabled={busy} autoComplete="off" onChange={event => update(category.id, { nameEn: event.target.value })}/>
              <input aria-label={t('categoryChineseName')} value={category.nameZh} maxLength={60} disabled={busy} autoComplete="off" onChange={event => update(category.id, { nameZh: event.target.value })}/>
              <div className="category-order-controls">
                <button type="button" className="icon-button" aria-label={t('moveCategoryUp')} title={t('moveCategoryUp')} disabled={busy || index === 0} onClick={() => move(category.id, index - 1)}><ArrowUp size={16}/></button>
                <button type="button" className="icon-button" aria-label={t('moveCategoryDown')} title={t('moveCategoryDown')} disabled={busy || index === categories.length - 1} onClick={() => move(category.id, index + 1)}><ArrowDown size={16}/></button>
                {!initialIds.has(category.id) && <button type="button" className="icon-button" aria-label={t('removeNewCategory')} title={t('removeNewCategory')} disabled={busy} onClick={() => {
                  const remaining = categories.filter(item => item.id !== category.id);
                  onChange(remaining); setPicker(null); setFocusId(remaining[Math.min(index, remaining.length - 1)].id);
                }}><Trash2 size={15}/></button>}
              </div>
            </div>
            {picker === category.id && <div className="category-icon-picker" role="group" aria-label={t('chooseCategoryIcon')}>
              {categoryIconIds.map(id => { const Candidate = categoryIcon(id); return <button type="button" key={id} className="category-icon-button" aria-label={categoryIconName(id, locale)} title={categoryIconName(id, locale)} aria-pressed={category.icon === id} disabled={busy} onClick={() => { update(category.id, { icon: id }); setPicker(null); scroll.current?.querySelector<HTMLButtonElement>(`[data-category-id="${category.id}"] .category-icon-button`)?.focus(); }}><Candidate size={20}/></button>; })}
            </div>}
          </div>;
        })}
      </div>
      <span className="sr-only" role="status">{announcement}</span>
    </div>
    {error && <p className="form-error category-error" role="alert">{error}</p>}
    <footer className="modal-footer"><button type="button" className="button small category-add" disabled={busy || categories.length >= maxCategories} onClick={add}><Plus size={16}/>{t('newCategory')}</button><button type="button" className="button" onClick={onClose} disabled={busy}>{t('cancel')}</button><button type="submit" className="button primary" disabled={busy}>{busy ? <span className="spinner small-spinner"/> : <Check size={16}/ >}{busy ? t('saving') : t('save')}</button></footer>
  </form>;
}
