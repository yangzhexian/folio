import { describe, expect, it } from 'vitest';
import { fieldLabel, filterRecords, formatBytes, formatRecord } from './domain';
import { createRecord, templates } from './templates';
import type { Attachment, Field, ProfileRecord } from './types';

const field = (overrides: Partial<Field> = {}): Field => ({ id: 'field-1', label: 'Institution', labelZh: '学校', value: 'Example University', kind: 'text', sensitive: false, ...overrides });
const record = (overrides: Partial<ProfileRecord> = {}): ProfileRecord => ({
  id: 'record-1', category: 'education', title: 'Graduate study', subtitle: 'Research program', tags: ['Academic'], favorite: false,
  fields: [field()], notes: 'Expected completion next summer.', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...overrides,
});
const attachment: Attachment = {
  id: 'attachment-1', recordId: 'record-1', originalName: '原始成绩单.PDF', fileName: 'education__transcript__2026-01-01.pdf', relativePath: 'files/transcript.pdf', absolutePath: 'C:\\Example\\files\\transcript.pdf', size: 2048, createdAt: '2026-01-01T00:00:00.000Z',
};

describe('record search', () => {
  it('requires every token while matching across bilingual labels, values, tags and notes', () => {
    const records = [record(), record({ id: 'record-2', title: 'Other record', fields: [], tags: [], notes: '' })];
    expect(filterRecords(records, [], '学校 EXAMPLE academic summer', 'all').map((item) => item.id)).toEqual(['record-1']);
    expect(filterRecords(records, [], 'Institution nonexistent', 'all')).toEqual([]);
    expect(filterRecords(records, [], '  ＥＸＡＭＰＬＥ  \n university ', 'all').map((item) => item.id)).toEqual(['record-1']);
  });

  it('finds managed and original attachment names only on the linked record', () => {
    const records = [record(), record({ id: 'record-2' })];
    expect(filterRecords(records, [attachment], '原始成绩单 pdf', 'all').map((item) => item.id)).toEqual(['record-1']);
    expect(filterRecords(records, [attachment], 'TRANSCRIPT 2026-01-01', 'all').map((item) => item.id)).toEqual(['record-1']);
    expect(filterRecords(records, [{ ...attachment, recordId: 'missing-record' }], 'transcript', 'all')).toEqual([]);
  });

  it('combines category and favorite filters with the query without changing record order', () => {
    const records = [record(), record({ id: 'record-2', category: 'research', favorite: true }), record({ id: 'record-3', favorite: true })];
    expect(filterRecords(records, [], 'example', 'favorites').map((item) => item.id)).toEqual(['record-2', 'record-3']);
    expect(filterRecords(records, [], 'example', 'education').map((item) => item.id)).toEqual(['record-1', 'record-3']);
    expect(filterRecords(records, [], '  ', 'all')).toEqual(records);
    expect(filterRecords(records, [], 'example', 'identity')).toEqual([]);
  });
});

describe('copy formatting', () => {
  const mixedRecord = record({ fields: [field(), field({ id: 'secret', label: 'ID number', labelZh: '证件号码', value: 'synthetic-private-id', sensitive: true }), field({ id: 'empty', label: 'Blank field', value: '   ' }), field({ id: 'description', label: 'Description', labelZh: '说明', kind: 'multiline', value: 'First line\nSecond line' })] });

  it('omits sensitive labels and values by default while retaining useful public content', () => {
    const text = formatRecord(mixedRecord, 'en');
    expect(text).toContain('Institution: Example University');
    expect(text).toContain('Description: First line\nSecond line');
    expect(text).toContain('Tags: Academic');
    expect(text).toContain('Notes: Expected completion next summer.');
    expect(text).not.toContain('synthetic-private-id');
    expect(text).not.toContain('ID number');
    expect(text).not.toContain('Blank field');
  });

  it('includes sensitive content only with explicit opt-in and uses the selected language', () => {
    const text = formatRecord(mixedRecord, 'zh', true);
    expect(text).toContain('证件号码: synthetic-private-id');
    expect(text).toContain('学校: Example University');
    expect(text).toContain('备注: Expected completion next summer.');
    expect(formatRecord(mixedRecord, 'zh', false)).not.toContain('synthetic-private-id');
  });

  it('falls back to the English label for custom fields without a Chinese label', () => {
    expect(fieldLabel(field({ label: 'Custom field', labelZh: undefined }), 'zh')).toBe('Custom field');
    expect(fieldLabel(field({ label: 'Custom field', labelZh: '  ' }), 'zh')).toBe('Custom field');
    expect(fieldLabel(field(), 'en')).toBe('Institution');
  });
});

describe('record templates', () => {
  it('creates independent empty records and fields with localized titles', () => {
    const first = createRecord('identity', 'en');
    const second = createRecord('identity', 'zh');
    expect(first.title).toBe('Personal identity');
    expect(second.title).toBe('基本身份信息');
    expect(first.id).not.toBe(second.id);
    expect(first.fields.every((item) => item.value === '')).toBe(true);
    expect(new Set([...first.fields, ...second.fields].map((item) => item.id)).size).toBe(first.fields.length + second.fields.length);
    first.fields[0].value = 'Synthetic test value';
    expect(second.fields[0].value).toBe('');
    expect(first.createdAt).toBe(first.updatedAt);
    expect(Number.isNaN(Date.parse(first.createdAt))).toBe(false);
  });

  it('keeps common identity numbers sensitive and allows a genuinely blank custom record', () => {
    expect(createRecord('identity', 'en').fields.find((item) => item.label === 'ID number')?.sensitive).toBe(true);
    expect(createRecord('family', 'en').fields.find((item) => item.label === 'ID number')?.sensitive).toBe(true);
    expect(createRecord('custom', 'en').fields).toEqual([]);
    expect(new Set(templates.map((item) => item.id)).size).toBe(templates.length);
    expect(() => createRecord('missing', 'en')).toThrow('Unknown template');
  });
});

describe('file sizes', () => {
  it('formats small files and binary unit boundaries without invalid values', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(42)).toBe('42 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1024 ** 2)).toBe('1 MB');
    expect(formatBytes(Number.NaN)).toBe('0 B');
    expect(formatBytes(-1)).toBe('0 B');
  });
});
