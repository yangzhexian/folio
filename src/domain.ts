import { categoryLabels } from './templates';
import type { Attachment, Category, Field, Locale, ProfileRecord } from './types';

function normalizeSearch(value: string): string {
  return value.normalize('NFKC').toLowerCase();
}

export function filterRecords(records: ProfileRecord[], attachments: Attachment[], query: string, category: 'all' | 'favorites' | Category): ProfileRecord[] {
  const tokens = normalizeSearch(query).trim().split(/\s+/u).filter(Boolean);
  const attachmentNames = new Map<string, string[]>();
  for (const attachment of attachments) {
    const names = attachmentNames.get(attachment.recordId) ?? [];
    names.push(attachment.fileName, attachment.originalName);
    attachmentNames.set(attachment.recordId, names);
  }
  return records.filter((record) => {
    if (category === 'favorites' && !record.favorite) return false;
    if (category !== 'all' && category !== 'favorites' && record.category !== category) return false;
    if (tokens.length === 0) return true;
    const categoryLabel = categoryLabels[record.category];
    const searchable = normalizeSearch([
      record.title,
      record.subtitle,
      record.notes,
      record.category,
      categoryLabel.en,
      categoryLabel.zh,
      ...record.tags,
      ...record.fields.flatMap((field) => [field.label, field.labelZh ?? '', field.value]),
      ...(attachmentNames.get(record.id) ?? []),
    ].join('\n'));
    return tokens.every((token) => searchable.includes(token));
  });
}

export function fieldLabel(field: Field, locale: Locale): string {
  return locale === 'zh' && field.labelZh?.trim() ? field.labelZh : field.label;
}

export function formatRecord(record: ProfileRecord, locale: Locale, includeSensitive = false): string {
  const heading = [record.title.trim(), record.subtitle.trim()].filter(Boolean).join('\n');
  const fields = record.fields
    .filter((field) => field.value.trim() && (includeSensitive || !field.sensitive))
    .map((field) => `${fieldLabel(field, locale)}: ${field.value.trim()}`)
    .join('\n');
  const tags = record.tags.length ? `${locale === 'zh' ? '标签' : 'Tags'}: ${record.tags.join(', ')}` : '';
  const notes = record.notes.trim() ? `${locale === 'zh' ? '备注' : 'Notes'}: ${record.notes.trim()}` : '';
  return [heading, fields, tags, notes].filter(Boolean).join('\n\n');
}

export function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const unitIndex = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
  if (unitIndex <= 0) return `${Math.round(size)} B`;
  const amount = size / 1024 ** unitIndex;
  return `${Number(amount.toFixed(amount < 10 ? 1 : 0))} ${units[unitIndex]}`;
}
