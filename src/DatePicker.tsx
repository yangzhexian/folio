import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { dateObject, formatDate, monthCells, moveDay, moveMonth, parseDate, todayDate } from './calendar';
import type { CalendarDate } from './calendar';
import type { Locale } from './types';
import './date-picker.css';

const copy = {
  en: { choose: 'Choose date', calendar: 'Date calendar', previousYear: 'Previous year', nextYear: 'Next year', previousMonth: 'Previous month', nextMonth: 'Next month', today: 'Today', clear: 'Clear date', invalid: 'Enter a valid date as YYYY-MM-DD.', weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] },
  zh: { choose: '选择日期', calendar: '日期日历', previousYear: '上一年', nextYear: '下一年', previousMonth: '上个月', nextMonth: '下个月', today: '今天', clear: '清除日期', invalid: '请输入有效日期，格式为 YYYY-MM-DD。', weekdays: ['一', '二', '三', '四', '五', '六', '日'] },
};

export function DatePicker({ value, onChange, locale, label, disabled = false }: { value: string; onChange: (value: string) => void; locale: Locale; label: string; disabled?: boolean }) {
  const text = copy[locale];
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const focusPending = useRef(false);
  const lastValid = useRef(parseDate(value));
  const [draft, setDraft] = useState(value);
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState<CalendarDate>(() => parseDate(value) ?? todayDate());
  const invalid = draft !== '' && !parseDate(draft);
  const selected = parseDate(value);
  const today = todayDate();
  const dateLocale = locale === 'zh' ? 'zh-CN' : 'en-US';
  const monthTitle = new Intl.DateTimeFormat(dateLocale, { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(dateObject(focused));
  const cells = monthCells(focused);
  const focusId = formatDate(focused);

  useEffect(() => { setDraft(value); if (value === '' || parseDate(value)) lastValid.current = parseDate(value); }, [value]);
  useLayoutEffect(() => { input.current?.setCustomValidity(invalid ? text.invalid : ''); }, [invalid, text.invalid]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  useLayoutEffect(() => {
    if (!open) return;
    if (focusPending.current) {
      focusPending.current = false;
      panel.current?.querySelector<HTMLButtonElement>(`[data-date="${focusId}"]`)?.focus({ preventScroll: true });
    }
    panel.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [open, focusId]);

  function close(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) toggle.current?.focus({ preventScroll: true });
  }

  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => { if (!root.current?.contains(event.target as Node)) close(); };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close(true);
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', outside);
    window.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('focusin', outside);
      window.removeEventListener('keydown', escape, true);
    };
  }, [open]);

  function show() {
    if (open) { close(); return; }
    setFocused(parseDate(draft) ?? lastValid.current ?? todayDate());
    focusPending.current = true;
    setOpen(true);
  }

  function commit(date: CalendarDate | null) {
    const next = date ? formatDate(date) : '';
    setDraft(next);
    onChange(next);
    close(true);
  }

  function navigate(months: number) { setFocused(current => moveMonth(current, months)); }

  function calendarKey(event: KeyboardEvent<HTMLButtonElement>, date: CalendarDate) {
    let next: CalendarDate;
    if (event.key === 'ArrowLeft') next = moveDay(date, -1);
    else if (event.key === 'ArrowRight') next = moveDay(date, 1);
    else if (event.key === 'ArrowUp') next = moveDay(date, -7);
    else if (event.key === 'ArrowDown') next = moveDay(date, 7);
    else if (event.key === 'Home') next = moveDay(date, -((dateObject(date).getUTCDay() + 6) % 7));
    else if (event.key === 'End') next = moveDay(date, 6 - ((dateObject(date).getUTCDay() + 6) % 7));
    else if (event.key === 'PageUp' || event.key === 'PageDown') next = moveMonth(date, (event.key === 'PageUp' ? -1 : 1) * (event.shiftKey ? 12 : 1));
    else return;
    event.preventDefault();
    focusPending.current = true;
    setFocused(next);
  }

  return <div ref={root} className="date-picker">
    <div className="date-picker-control">
      <input ref={input} type="text" inputMode="numeric" aria-label={label} placeholder="YYYY-MM-DD" value={draft} maxLength={10} aria-invalid={invalid ? true : undefined} aria-describedby={invalid ? `${id}-error` : undefined} disabled={disabled} onChange={event => {
        const next = event.target.value;
        setDraft(next);
        onChange(next);
      }} onKeyDown={event => { if (event.altKey && event.key === 'ArrowDown') { event.preventDefault(); show(); } }}/>
      <button ref={toggle} type="button" className="date-picker-toggle" aria-label={text.choose} title={text.choose} aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled} onClick={show}><CalendarDays size={17}/></button>
    </div>
    {invalid && <span id={`${id}-error`} className="date-picker-error">{text.invalid}</span>}
    {open && <div ref={panel} id={id} className="date-picker-panel" role="group" aria-label={text.calendar}>
      <div className="date-picker-header">
        <button type="button" aria-label={text.previousYear} title={text.previousYear} disabled={focused.year <= 1} onClick={() => navigate(-12)}><ChevronsLeft size={17}/></button>
        <button type="button" aria-label={text.previousMonth} title={text.previousMonth} disabled={focused.year === 1 && focused.month === 1} onClick={() => navigate(-1)}><ChevronLeft size={17}/></button>
        <span aria-live="polite" className="date-picker-month">{monthTitle}</span>
        <button type="button" aria-label={text.nextMonth} title={text.nextMonth} disabled={focused.year === 9999 && focused.month === 12} onClick={() => navigate(1)}><ChevronRight size={17}/></button>
        <button type="button" aria-label={text.nextYear} title={text.nextYear} disabled={focused.year >= 9999} onClick={() => navigate(12)}><ChevronsRight size={17}/></button>
      </div>
      <div role="grid" aria-label={monthTitle} className="date-picker-grid">
        <div role="row" className="date-picker-weekdays">{text.weekdays.map(day => <span role="columnheader" key={day}>{day}</span>)}</div>
        {Array.from({ length: cells.length / 7 }, (_, row) => <div role="row" key={row}>{cells.slice(row * 7, row * 7 + 7).map((date, column) => {
          const iso = date ? formatDate(date) : '';
          const isSelected = selected !== null && iso === formatDate(selected);
          return <div role="gridcell" key={iso || column} aria-selected={isSelected}>{date && <button type="button" data-date={iso} className={`${date.month !== focused.month ? 'outside-month' : ''} ${isSelected ? 'selected-date' : ''}`} aria-label={new Intl.DateTimeFormat(dateLocale, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', timeZone: 'UTC' }).format(dateObject(date))} aria-current={iso === formatDate(today) ? 'date' : undefined} tabIndex={iso === focusId ? 0 : -1} onClick={() => commit(date)} onKeyDown={event => calendarKey(event, date)}>{date.day}</button>}</div>;
        })}</div>)}
      </div>
      <div className="date-picker-footer"><button type="button" onClick={() => commit(todayDate())}>{text.today}</button><button type="button" onClick={() => commit(null)}>{text.clear}</button></div>
    </div>}
  </div>;
}
