export type CalendarDate = { year: number; month: number; day: number };

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function parseDate(value: string): CalendarDate | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  return year >= 1 && year <= 9999 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month) ? { year, month, day } : null;
}

export function formatDate(date: CalendarDate): string {
  return `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

export function todayDate(now = new Date()): CalendarDate {
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

export function dateObject(date: CalendarDate): Date {
  const result = new Date(0);
  result.setUTCFullYear(date.year, date.month - 1, date.day);
  return result;
}

/** Calendar browsing changes only a display/focus date, never a stored field value. */
export function moveMonth(date: CalendarDate, months: number): CalendarDate {
  const index = Math.max(0, Math.min(9999 * 12 - 1, (date.year - 1) * 12 + date.month - 1 + months));
  const year = Math.floor(index / 12) + 1;
  const month = index % 12 + 1;
  return { year, month, day: Math.min(date.day, daysInMonth(year, month)) };
}

export function moveDay(date: CalendarDate, days: number): CalendarDate {
  const result = dateObject(date);
  result.setUTCDate(result.getUTCDate() + days);
  if (result.getUTCFullYear() < 1) return { year: 1, month: 1, day: 1 };
  if (result.getUTCFullYear() > 9999) return { year: 9999, month: 12, day: 31 };
  return { year: result.getUTCFullYear(), month: result.getUTCMonth() + 1, day: result.getUTCDate() };
}

/** Monday-first calendar cells, with blank cells outside the supported year range. */
export function monthCells(date: CalendarDate): (CalendarDate | null)[] {
  const first = { ...date, day: 1 };
  const offset = (dateObject(first).getUTCDay() + 6) % 7;
  const count = Math.ceil((offset + daysInMonth(date.year, date.month)) / 7) * 7;
  return Array.from({ length: count }, (_, index) => {
    const result = dateObject(first);
    result.setUTCDate(1 + index - offset);
    const year = result.getUTCFullYear();
    return year < 1 || year > 9999 ? null : { year, month: result.getUTCMonth() + 1, day: result.getUTCDate() };
  });
}
