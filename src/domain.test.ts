import { describe, expect, it } from 'vitest';
import { fieldLabel, filterAttachments, filterRecords, findMatchingFields, formatBytes, formatRecord } from './domain';
import { createRecord, templates } from './templates';
import { defaultCategories } from './categories';
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
  it('uses renamed bilingual collection labels across records, field matches, and file search', () => {
    const catalog = defaultCategories.map(category => category.id === 'education' ? { ...category, nameEn: 'Learning archive', nameZh: '学习档案' } : category);
    const item = record();
    expect(filterRecords([item], [], '学习档案 university', 'all', catalog)).toEqual([item]);
    expect(filterRecords([item], [], 'learning archive', 'education', catalog)).toEqual([item]);
    expect(findMatchingFields(item, '学习档案 university', catalog)).toEqual(item.fields);
    expect(filterAttachments([item], [attachment], 'learning 原始成绩单', catalog)).toEqual([attachment]);
    expect(filterRecords([item], [], '教育经历', 'all', catalog)).toEqual([]);
  });

  it('finds new collections by stable ID and both labels without assuming a built-in category', () => {
    const collection = { id: 'collection-00000000-0000-4000-8000-000000000099' as const, nameEn: 'Travel', nameZh: '旅行', icon: 'plane' };
    const catalog = [...defaultCategories, collection];
    const item = record({ category: collection.id });
    expect(filterRecords([item], [], 'travel', collection.id, catalog)).toEqual([item]);
    expect(filterRecords([item], [], '旅行', 'all', catalog)).toEqual([item]);
    expect(filterAttachments([item], [attachment], '旅行', catalog)).toEqual([attachment]);
    expect(findMatchingFields(item, 'travel university', catalog)).toEqual(item.fields);
    expect(filterRecords([item], [], 'travel', 'education', catalog)).toEqual([]);
    expect(() => filterRecords([item], [], 'university', 'all')).not.toThrow();
  });
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

describe('file search', () => {
  const sibling = { ...attachment, id: 'sibling', fileName: 'education__diploma.pdf', originalName: '学位证.pdf' };
  it('matches a filename without returning unrelated attachments on the same record', () => {
    expect(filterAttachments([record()], [attachment, sibling], 'ＴＲＡＮＳＣＲＩＰＴ pdf')).toEqual([attachment]);
    expect(filterAttachments([record()], [attachment, sibling], '学位证')).toEqual([sibling]);
    expect(filterAttachments([record()], [attachment, sibling], 'transcript diploma')).toEqual([]);
  });
  it('combines parent metadata with each file and excludes orphaned files', () => {
    const orphan = { ...attachment, id: 'orphan', recordId: 'missing' };
    expect(filterAttachments([record()], [attachment, sibling, orphan], '学校 transcript')).toEqual([attachment]);
    expect(filterAttachments([record()], [attachment, sibling, orphan], 'University')).toEqual([attachment, sibling]);
    expect(filterAttachments([record()], [attachment, orphan], '')).toEqual([attachment]);
  });

  it('combines label aliases with the individual filename without leaking sibling matches', () => {
    const parent = record({ fields: [field({ label: 'Mobile', labelZh: undefined, value: '13800000000' })] });
    expect(filterAttachments([parent], [attachment, sibling], '手机号 transcript')).toEqual([attachment]);
    expect(filterAttachments([parent], [attachment, sibling], '手机 transcript diploma')).toEqual([]);
  });

  it('retains literal AND matching when words from an alias phrase occur across parent and file', () => {
    const parent = record({ title: 'Application ID' });
    const file = { ...attachment, fileName: 'application__number.pdf', originalName: 'number.pdf' };
    expect(filterAttachments([parent], [file], 'id number')).toEqual([file]);
    expect(filterRecords([parent], [file], 'id number', 'all')).toEqual([parent]);
  });
});

describe('bilingual label aliases', () => {
  it.each([
    ['QQ', 'QQ 号'], ['QQ 号', 'qq号'], ['QQ账号', 'ＱＱ　号'], ['QQ number', 'qQ\t号'],
    ['Mobile', '手机号'], ['手机号', 'phone'], ['手机号码', 'ＭＯＢＩＬＥ'], ['Phone number', '手机'], ['联系电话', 'mobile phone'],
    ['Document number', '证件号'], ['ID number', '证件号码'], ['证件号码', 'ID number'], ['证件号', 'document number'],
    ['Email address', '电子邮箱'], ['邮箱', 'e-mail'], ['WeChat ID', '微信号'], ['微信', 'wechat'],
    ['Mailing address', '通讯地址'], ['通信地址', 'address'], ['邮编', 'postal code'], ['Date of birth', '出生日期'],
  ])('matches field label %s with query %s without needing a translation', (label, query) => {
    const item = record({ fields: [field({ label, labelZh: undefined, value: 'sample-value' })] });
    expect(filterRecords([item], [], query, 'all')).toEqual([item]);
    expect(findMatchingFields(item, query)).toEqual(item.fields);
  });

  it('also learns aliases from Chinese labels while respecting all query terms', () => {
    const item = record({ title: 'Contact details', fields: [field({ label: 'Primary contact', labelZh: '手 机 号', value: '13800000000' })] });
    expect(filterRecords([item], [], 'contact PHONE 138', 'all')).toEqual([item]);
    expect(filterRecords([item], [], 'contact phone 999', 'all')).toEqual([]);
    expect(findMatchingFields(item, 'contact phone 138')).toEqual(item.fields);
  });

  it('does not infer label concepts from unrelated word fragments, notes, or values', () => {
    const items = [
      record({ id: 'headphones', fields: [field({ label: 'Headphone model', labelZh: undefined, value: 'Example' })] }),
      record({ id: 'automobile', fields: [field({ label: 'Automobile', labelZh: undefined, value: 'Example' })] }),
      record({ id: 'mobile-notes', notes: 'Mobile games', fields: [] }),
      record({ id: 'mobile-value', fields: [field({ value: 'Mobile games' })] }),
    ];
    expect(filterRecords(items, [], '手机号', 'all')).toEqual([]);
    expect(filterRecords([record({ fields: [field({ label: 'Project ID', labelZh: undefined, value: 'P-42' })] })], [], '证件号码', 'all')).toEqual([]);
    expect(filterRecords([record({ fields: [field({ label: 'Paid number', labelZh: undefined, value: '42' })] })], [], '证件号', 'all')).toEqual([]);
    expect(filterRecords(items, [], 'mobile games', 'all').map(item => item.id)).toEqual(['mobile-notes', 'mobile-value']);
  });

  it('keeps generic address aliases distinct from email addresses', () => {
    const email = field({ id: 'email', label: 'Email address', labelZh: undefined, value: 'alex@example.com' });
    const address = field({ id: 'address', label: 'Street address', labelZh: undefined, value: 'Example Road' });
    const item = record({ fields: [email, address] });
    expect(findMatchingFields(item, 'email address')).toEqual([email]);
    expect(findMatchingFields(item, '通讯地址')).toEqual([address]);
  });
});

describe('matching field results', () => {
  const phone = field({ id: 'phone', label: 'Mobile', labelZh: '手机号', value: '13800000000' });
  const email = field({ id: 'email', label: 'Email', labelZh: '邮箱', value: 'alex@example.com' });
  const secret = field({ id: 'secret', label: 'ID number', labelZh: '证件号码', value: 'SYNTHETIC-PRIVATE-123', sensitive: true });
  const item = record({ category: 'contacts', title: 'Contact details', tags: ['Application'], fields: [phone, email, secret] });

  it('returns matching fields in record order with parent and sibling fields supplying query context', () => {
    expect(findMatchingFields(item, 'contact mobile')).toEqual([phone]);
    expect(findMatchingFields(item, 'APPLICATION 手机 138')).toEqual([phone]);
    expect(findMatchingFields(item, 'phone email')).toEqual([phone, email]);
    expect(findMatchingFields(item, 'contact example.com')).toEqual([email]);
    expect(findMatchingFields(item, '手机 absent')).toEqual([]);
  });

  it('does not return all fields for empty or metadata-only queries', () => {
    expect(findMatchingFields(item, '')).toEqual([]);
    expect(findMatchingFields(item, ' \t\n ')).toEqual([]);
    expect(findMatchingFields(item, 'application')).toEqual([]);
    expect(findMatchingFields(item, 'contact details')).toEqual([]);
  });

  it('returns original sensitive fields without exposing their value through copying or mutating flags', () => {
    const matches = findMatchingFields(item, '证件号');
    expect(matches).toEqual([secret]);
    expect(matches[0]).toBe(secret);
    expect(matches[0].sensitive).toBe(true);
    expect(findMatchingFields(item, 'synthetic-private')).toEqual([secret]);
    expect(formatRecord(item, 'en')).not.toContain(secret.value);
    expect(secret.value).toBe('SYNTHETIC-PRIVATE-123');
  });

  it('allows empty matching fields and normalizes spacing inside QQ labels and literal values', () => {
    const empty = field({ id: 'qq', label: 'QQ 号', labelZh: undefined, value: '' });
    const literal = field({ id: 'literal', label: 'Custom', labelZh: undefined, value: 'QQ 号' });
    const example = record({ fields: [empty, literal] });
    expect(findMatchingFields(example, 'qq号')).toEqual([empty, literal]);
    expect(findMatchingFields(example, 'ＱＱ　号')).toEqual([empty, literal]);
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
