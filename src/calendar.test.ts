import { describe, expect, it } from 'vitest';
import { dateObject, formatDate, monthCells, moveDay, moveMonth, parseDate, todayDate } from './calendar';

describe('calendar dates', () => {
  it('accepts exact ISO dates and rejects invalid Gregorian days and year boundaries', () => {
    for (const valid of ['0001-01-01', '0099-07-16', '2000-02-29', '2024-02-29', '9999-12-31']) {
      expect(formatDate(parseDate(valid)!)).toBe(valid);
    }
    for (const invalid of ['', '2024-2-29', '2023-02-29', '1900-02-29', '2024-04-31', '0000-01-01', '10000-01-01', '2024-13-01', '2024-00-01', '2024-01-00']) expect(parseDate(invalid)).toBeNull();
  });

  it('browses months and years using independent dates and clamps only the calendar focus', () => {
    const selected = parseDate('2024-02-29')!;
    expect(moveMonth(selected, 12)).toEqual({ year: 2025, month: 2, day: 28 });
    expect(moveMonth(selected, 48)).toEqual({ year: 2028, month: 2, day: 29 });
    expect(moveMonth(parseDate('2024-01-31')!, 1)).toEqual(selected);
    expect(moveMonth(parseDate('2024-01-31')!, -1)).toEqual({ year: 2023, month: 12, day: 31 });
    expect(formatDate(selected)).toBe('2024-02-29');
    expect(moveMonth(parseDate('0001-01-01')!, -12)).toEqual({ year: 1, month: 1, day: 1 });
    expect(moveMonth(parseDate('9999-12-31')!, 12)).toEqual({ year: 9999, month: 12, day: 31 });
  });

  it('moves keyboard focus across days without date parsing timezone or early-year surprises', () => {
    expect(formatDate(moveDay(parseDate('2024-02-28')!, 1))).toBe('2024-02-29');
    expect(formatDate(moveDay(parseDate('2024-02-29')!, 1))).toBe('2024-03-01');
    expect(formatDate(moveDay(parseDate('0100-01-01')!, -1))).toBe('0099-12-31');
    expect(formatDate(moveDay(parseDate('0001-01-01')!, -7))).toBe('0001-01-01');
    expect(formatDate(moveDay(parseDate('9999-12-31')!, 7))).toBe('9999-12-31');
    expect(todayDate(new Date(2026, 9, 23, 23))).toEqual({ year: 2026, month: 10, day: 23 });
  });

  it('renders Monday-first complete weeks with correct leap days and bounded selectable dates', () => {
    const february = monthCells(parseDate('2024-02-29')!);
    expect(february.length % 7).toBe(0);
    expect(formatDate(february[0]!)).toBe('2024-01-29');
    expect(dateObject(february[0]!).getUTCDay()).toBe(1);
    expect(february.filter(day => day?.month === 2)).toHaveLength(29);
    expect(monthCells(parseDate('2025-02-28')!).filter(day => day?.month === 2)).toHaveLength(28);
    for (const boundary of ['0001-01-01', '9999-12-31']) {
      expect(monthCells(parseDate(boundary)!).every(day => day === null || parseDate(formatDate(day)) !== null)).toBe(true);
    }
  });
});
