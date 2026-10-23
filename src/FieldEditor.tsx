import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { GripVertical, LockKeyhole, Plus, X } from 'lucide-react';
import { fieldLabel } from './domain';
import { DatePicker } from './DatePicker';
import { createEmptyField, insertFieldAfter, reorderField } from './fieldEditing';
import { tFor } from './i18n';
import type { Field, FieldKind, Locale } from './types';
import './field-editor.css';

export interface FieldEditorProps {
  fields: Field[];
  locale: Locale;
  onChange: (fields: Field[]) => void;
  disabled?: boolean;
}

const copy = {
  en: {
    insertStart: 'Add field at start', insertAfter: 'Add field after', reorder: 'Reorder',
    reorderHint: 'Drag to reorder, or use the Up and Down arrow keys. Home moves to the start; End moves to the end.',
    moved: (name: string, position: number, count: number) => `${name} moved to position ${position} of ${count}.`,
  },
  zh: {
    insertStart: '在开头添加字段', insertAfter: '在此字段后添加', reorder: '调整顺序',
    reorderHint: '拖动以调整顺序，也可使用上下方向键。Home 移至开头，End 移至末尾。',
    moved: (name: string, position: number, count: number) => `${name} 已移至第 ${position} 项，共 ${count} 项。`,
  },
};

type DragState = {
  fieldId: string;
  pointerId: number;
  originY: number;
  clientY: number;
  destination: number;
  active: boolean;
  handle: HTMLButtonElement;
};
type DragView = Pick<DragState, 'fieldId' | 'destination' | 'active'>;
type FocusTarget = { id: string; control: 'label' | 'handle' } | 'empty';

export function FieldEditor({ fields, locale, onChange, disabled = false }: FieldEditorProps) {
  const t = tFor(locale);
  const text = copy[locale];
  const hintId = useId();
  const root = useRef<HTMLDivElement>(null);
  const labelInputs = useRef(new Map<string, HTMLInputElement>());
  const handles = useRef(new Map<string, HTMLButtonElement>());
  const emptyButton = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<FocusTarget | null>(null);
  const latest = useRef({ fields, locale, onChange, disabled });
  latest.current = { fields, locale, onChange, disabled };
  const dragRef = useRef<DragState | null>(null);
  const [dragView, setDragView] = useState<DragView | null>(null);
  const [announcement, setAnnouncement] = useState('');

  useLayoutEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    const element = target === 'empty' ? emptyButton.current : target.control === 'label' ? labelInputs.current.get(target.id) : handles.current.get(target.id);
    if (element) {
      pendingFocus.current = null;
      element.focus({ preventScroll: true });
      element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [fields]);

  function updateDestination(drag: DragState) {
    const items = [...(root.current?.querySelectorAll<HTMLElement>('.field-editor-item') ?? [])].filter(item => item.dataset.fieldId !== drag.fieldId);
    const destination = items.filter(item => {
      const bounds = item.querySelector('.editor-field')!.getBoundingClientRect();
      return drag.clientY > bounds.top + bounds.height / 2;
    }).length;
    if (destination !== drag.destination) {
      drag.destination = destination;
      setDragView({ fieldId: drag.fieldId, destination, active: drag.active });
    }
  }

  function finishDrag(commit: boolean) {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    setDragView(null);
    if (drag.handle.hasPointerCapture(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId);
    if (!commit || !drag.active || latest.current.disabled) return;
    const current = latest.current;
    const reordered = reorderField(current.fields, drag.fieldId, drag.destination);
    if (reordered === current.fields) return;
    const moved = reordered[drag.destination];
    pendingFocus.current = { id: drag.fieldId, control: 'handle' };
    current.onChange(reordered);
    setAnnouncement(copy[current.locale].moved(fieldLabel(moved, current.locale) || String(drag.destination + 1), drag.destination + 1, reordered.length));
  }

  useEffect(() => {
    if (!dragView?.fieldId) return;
    let frame = 0;
    const tick = () => {
      const drag = dragRef.current;
      if (!drag) return;
      if (drag.active) {
        const scroller = root.current?.closest<HTMLElement>('.editor-scroll');
        if (scroller) {
          const bounds = scroller.getBoundingClientRect();
          const edge = Math.min(52, bounds.height / 4);
          const movement = drag.clientY < bounds.top + edge ? -(bounds.top + edge - drag.clientY) / edge : drag.clientY > bounds.bottom - edge ? (drag.clientY - bounds.bottom + edge) / edge : 0;
          if (movement) scroller.scrollTop += Math.max(-18, Math.min(18, movement * 14));
        }
        updateDestination(drag);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [dragView?.fieldId]);

  useEffect(() => {
    const cancel = () => finishDrag(false);
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || !dragRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      finishDrag(false);
    };
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('blur', cancel); window.removeEventListener('keydown', key, true); };
  }, []);

  useEffect(() => { if (disabled) finishDrag(false); }, [disabled]);

  function startDrag(event: PointerEvent<HTMLButtonElement>, fieldId: string) {
    if (disabled || fields.length < 2 || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    const destination = fields.findIndex(field => field.id === fieldId);
    const drag: DragState = { fieldId, destination, pointerId: event.pointerId, originY: event.clientY, clientY: event.clientY, active: false, handle: event.currentTarget };
    dragRef.current = drag;
    setDragView({ fieldId, destination, active: false });
  }

  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    drag.clientY = event.clientY;
    if (!drag.active && Math.abs(drag.clientY - drag.originY) >= 4) {
      drag.active = true;
      setDragView({ fieldId: drag.fieldId, destination: drag.destination, active: true });
    }
    if (drag.active) updateDestination(drag);
  }

  function endDrag(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    drag.clientY = event.clientY;
    if (drag.active) updateDestination(drag);
    finishDrag(true);
  }

  function reorderFromKeyboard(event: KeyboardEvent<HTMLButtonElement>, field: Field) {
    if (disabled || dragRef.current) return;
    const index = fields.findIndex(item => item.id === field.id);
    const destinations: Record<string, number> = { ArrowUp: index - 1, ArrowDown: index + 1, Home: 0, End: fields.length - 1 };
    if (!(event.key in destinations)) return;
    event.preventDefault();
    const reordered = reorderField(fields, field.id, destinations[event.key]);
    if (reordered === fields) return;
    pendingFocus.current = { id: field.id, control: 'handle' };
    onChange(reordered);
    const position = reordered.findIndex(item => item.id === field.id) + 1;
    setAnnouncement(text.moved(fieldLabel(field, locale) || String(position), position, fields.length));
  }

  function insert(afterId: string | null) {
    if (disabled) return;
    const field = createEmptyField();
    pendingFocus.current = { id: field.id, control: 'label' };
    onChange(insertFieldAfter(fields, afterId, field));
  }

  function remove(id: string) {
    if (disabled) return;
    const index = fields.findIndex(field => field.id === id);
    const next = fields[index + 1] ?? fields[index - 1];
    pendingFocus.current = next ? { id: next.id, control: 'label' } : 'empty';
    onChange(fields.filter(field => field.id !== id));
  }

  const patch = (id: string, value: Partial<Field>) => onChange(fields.map(field => field.id === id ? { ...field, ...value } : field));
  const otherIds = dragView ? fields.filter(field => field.id !== dragView.fieldId).map(field => field.id) : [];
  const moved = dragView?.active && dragView.destination !== fields.findIndex(field => field.id === dragView.fieldId);
  const dropBefore = moved && dragView ? otherIds[dragView.destination] : undefined;
  const dropAtEnd = moved && dragView && dragView.destination === otherIds.length;

  return <div ref={root} className={`field-editor editor-fields ${dragView?.active ? 'is-reordering' : ''}`}>
    <span id={hintId} className="field-editor-status">{text.reorderHint}</span>
    <span className="field-editor-status" role="status" aria-live="polite">{announcement}</span>
    {fields.length > 0 ? <button type="button" className="field-insert field-insert-start" aria-label={text.insertStart} title={text.insertStart} disabled={disabled} onClick={() => insert(null)}><Plus size={13}/>{t('addField')}</button> : <button ref={emptyButton} type="button" className="button add-field-button" disabled={disabled} onClick={() => insert(null)}><Plus size={15}/>{t('addField')}</button>}
    {fields.map((field, index) => {
      const name = fieldLabel(field, locale) || String(index + 1);
      const inactive = disabled || !!dragView?.active;
      return <div key={field.id} data-field-id={field.id} className={`field-editor-item ${dragView?.active && dragView.fieldId === field.id ? 'is-dragging' : ''} ${dropBefore === field.id ? 'drop-before' : ''}`}>
        <div className="editor-field">
          <div className="editor-field-heading">
            <button ref={node => { if (node) handles.current.set(field.id, node); else handles.current.delete(field.id); }} type="button" className="field-drag-handle" aria-label={`${text.reorder} ${name}`} aria-describedby={hintId} aria-keyshortcuts="ArrowUp ArrowDown Home End" title={text.reorderHint} disabled={disabled || fields.length < 2} onPointerDown={event => startDrag(event, field.id)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={() => finishDrag(false)} onLostPointerCapture={() => finishDrag(false)} onKeyDown={event => reorderFromKeyboard(event, field)}><GripVertical size={17}/></button>
            <span className="field-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
            <input ref={node => { if (node) labelInputs.current.set(field.id, node); else labelInputs.current.delete(field.id); }} aria-label={`${t('label')} ${index + 1}`} value={field.label} placeholder={t('label')} onChange={event => patch(field.id, { label: event.target.value })} required disabled={inactive}/>
            <input aria-label={`${t('labelZh')} ${index + 1}`} value={field.labelZh ?? ''} placeholder={t('labelZh')} onChange={event => patch(field.id, { labelZh: event.target.value })} disabled={inactive}/>
            <button type="button" className="icon-button" aria-label={`${t('remove')} ${name}`} title={`${t('remove')} ${name}`} onClick={() => remove(field.id)} disabled={inactive}><X size={15}/></button>
          </div>
          {field.kind === 'multiline' ? <textarea aria-label={`${t('value')} ${index + 1}`} value={field.value} placeholder={fieldLabel(field, locale)} onChange={event => patch(field.id, { value: event.target.value })} rows={3} disabled={inactive}/> : field.kind === 'date' ? <DatePicker label={`${t('value')} ${index + 1}`} value={field.value} onChange={value => patch(field.id, { value })} locale={locale} disabled={inactive}/> : <input aria-label={`${t('value')} ${index + 1}`} value={field.value} type="text" placeholder={fieldLabel(field, locale)} onChange={event => patch(field.id, { value: event.target.value })} disabled={inactive}/>}
          <div className="editor-field-options">
            <select aria-label={`${t('kind')} ${index + 1}`} value={field.kind} onChange={event => patch(field.id, { kind: event.target.value as FieldKind })} disabled={inactive}>{(['text', 'multiline', 'date', 'email', 'phone', 'url'] as FieldKind[]).map(kind => <option key={kind} value={kind}>{t(kind)}</option>)}</select>
            <label><input type="checkbox" checked={field.sensitive} onChange={event => patch(field.id, { sensitive: event.target.checked })} disabled={inactive}/><LockKeyhole size={12}/>{t('sensitive')}</label>
          </div>
        </div>
        <button type="button" className="field-insert" aria-label={`${text.insertAfter} ${name}`} title={`${text.insertAfter} ${name}`} disabled={inactive} onClick={() => insert(field.id)}><Plus size={13}/>{t('addField')}</button>
      </div>;
    })}
    <div className={`field-drop-end ${dropAtEnd ? 'active' : ''}`} aria-hidden="true"/>
  </div>;
}

export default FieldEditor;
