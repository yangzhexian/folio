import { describe, expect, it } from 'vitest';
import { isRecordSortOrder, recordSortOrders, sortRecords } from './sorting';
import type { RecordSortOrder } from './sorting';
import type { Locale, ProfileRecord } from './types';

const record = (overrides: Partial<ProfileRecord>): ProfileRecord => ({
  id: 'record-1', category: 'custom', title: '', subtitle: '', tags: [], favorite: false, fields: [], notes: '',
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...overrides,
});
const ids = (records: ProfileRecord[]) => records.map((item) => item.id);

describe('record sorting', () => {
  const records = [
    record({ id: 'a', createdAt: '2026-01-03T00:00:00Z', updatedAt: '2026-10-21T20:00:00Z' }),
    record({ id: 'b', createdAt: '2026-01-02T00:00:00Z', updatedAt: '2026-10-22T01:00:00+08:00' }),
    record({ id: 'c', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-10-23T00:00:00Z' }),
  ];

  it.each<[RecordSortOrder, string[]]>([
    ['updated-desc', ['c', 'a', 'b']],
    ['updated-asc', ['b', 'a', 'c']],
    ['created-desc', ['a', 'b', 'c']],
    ['created-asc', ['c', 'b', 'a']],
  ])('sorts %s using actual chronology, including timezone offsets', (order, expected) => {
    expect(ids(sortRecords(records, order, 'en'))).toEqual(expected);
  });

  it.each<[Locale, string]>([['en', 'Document'], ['zh', '证书']])('sorts %s titles with numeric ordering in both directions', (locale, title) => {
    const titledRecords = [record({ id: '10', title: `${title} 10` }), record({ id: '2', title: `${title} 2` }), record({ id: '1', title: `${title} 1` })];
    expect(ids(sortRecords(titledRecords, 'title-asc', locale))).toEqual(['1', '2', '10']);
    expect(ids(sortRecords(titledRecords, 'title-desc', locale))).toEqual(['10', '2', '1']);
  });

  it('uses stable record IDs to break equivalent titles and equal date instants in either direction', () => {
    const tiedRecords = [
      record({ id: 'b', title: 'résumé', createdAt: '2026-01-01T08:00:00+08:00' }),
      record({ id: 'a', title: 'Resume' }),
    ];
    for (const order of recordSortOrders) {
      expect(ids(sortRecords(tiedRecords, order, 'en'))).toEqual(['a', 'b']);
      expect(ids(sortRecords([...tiedRecords].reverse(), order, 'en'))).toEqual(['a', 'b']);
    }
  });

  it('keeps invalid dates last with deterministic order for each date sort', () => {
    const invalidRecords = [
      record({ id: 'invalid-b', createdAt: '', updatedAt: '' }),
      record({ id: 'valid' }),
      record({ id: 'invalid-a', createdAt: 'invalid', updatedAt: 'invalid' }),
    ];
    for (const order of recordSortOrders.filter((item) => !item.startsWith('title-'))) {
      expect(ids(sortRecords(invalidRecords, order, 'en'))).toEqual(['valid', 'invalid-a', 'invalid-b']);
    }
  });

  it('returns a new list without mutating the original list or records', () => {
    const input = records.map((item) => ({ ...item }));
    const before = structuredClone(input);
    input.forEach(Object.freeze);
    Object.freeze(input);
    const sorted = sortRecords(input, 'created-asc', 'en');
    expect(sorted).not.toBe(input);
    expect(input).toEqual(before);
    expect(sorted[0]).toBe(input[2]);
    expect(sortRecords([], 'updated-desc', 'zh')).toEqual([]);
  });
});

describe('saved sort preference validation', () => {
  it('accepts every supported order and rejects malformed or obsolete preferences', () => {
    for (const order of recordSortOrders) expect(isRecordSortOrder(order)).toBe(true);
    for (const value of [undefined, null, '', 'recent', 'updated', 'UPDATED-DESC', 0, {}, ['title-asc']]) {
      expect(isRecordSortOrder(value)).toBe(false);
    }
  });
});
