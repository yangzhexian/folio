import { invoke, isTauri } from '@tauri-apps/api/core';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import type { ProfileRecord, Snapshot, Attachment, Locale } from './types';

export const desktop = isTauri();
const timestamp = '2026-01-12T09:00:00.000Z';
const demo: Snapshot = {
  dataDir: 'Desktop app only', attachments: [],
  records: [
    { id: '00000000-0000-4000-8000-000000000001', category: 'identity', title: 'Personal details', subtitle: 'The essentials, always at hand', tags: ['Personal'], favorite: true, notes: '', createdAt: timestamp, updatedAt: timestamp, fields: [
      { id: 'name', label: 'Full name', labelZh: '姓名', value: 'Alex Morgan', kind: 'text', sensitive: false },
      { id: 'email', label: 'Email', labelZh: '邮箱', value: 'alex@example.com', kind: 'email', sensitive: false },
      { id: 'city', label: 'Current city', labelZh: '现居城市', value: 'Shanghai / 上海', kind: 'text', sensitive: false },
      { id: 'id', label: 'Document number', labelZh: '证件号码', value: 'DEMO-000000', kind: 'text', sensitive: true },
    ] },
    { id: '00000000-0000-4000-8000-000000000002', category: 'education', title: 'MSc · Computer Science', subtitle: 'Example University · 2023–2026', tags: ['Graduate'], favorite: true, notes: 'Example record. Replace with your own education history in the desktop app.', createdAt: timestamp, updatedAt: timestamp, fields: [
      { id: 'institution', label: 'Institution', labelZh: '学校', value: 'Example University', kind: 'text', sensitive: false },
      { id: 'degree', label: 'Degree', labelZh: '学位', value: 'Master of Science', kind: 'text', sensitive: false },
      { id: 'major', label: 'Major', labelZh: '专业', value: 'Computer Science', kind: 'text', sensitive: false },
    ] },
    { id: '00000000-0000-4000-8000-000000000003', category: 'research', title: 'Research portfolio', subtitle: 'Projects, publications, and ideas', tags: ['Research'], favorite: false, notes: '', createdAt: timestamp, updatedAt: timestamp, fields: [
      { id: 'topic', label: 'Research area', labelZh: '研究方向', value: 'Human–computer interaction', kind: 'text', sensitive: false },
      { id: 'description', label: 'Summary', labelZh: '简介', value: 'Designing helpful tools for everyday work.', kind: 'multiline', sensitive: false },
    ] },
  ],
};
let preview = structuredClone(demo);
const removed = new Map<string, Attachment>();
export const api = {
  load: () => desktop ? invoke<Snapshot>('load_snapshot') : Promise.resolve(structuredClone(preview)),
  save: async (record: ProfileRecord) => {
    if (desktop) return invoke<ProfileRecord>('save_record', { record });
    const saved = { ...record, updatedAt: new Date().toISOString() };
    preview.records = [...preview.records.filter(r => r.id !== saved.id), saved];
    return saved;
  },
  delete: async (id: string) => {
    if (desktop) return invoke<void>('delete_record', { id });
    preview.records = preview.records.filter(r => r.id !== id);
  },
  copy: async (text: string) => desktop ? writeText(text) : navigator.clipboard.writeText(text),
  attach: async (recordId: string, locale: Locale) => {
    if (!desktop) throw new Error('DESKTOP_ONLY');
    return invoke<Attachment[]>('import_attachments', { recordId, locale });
  },
  path: (id: string) => invoke<string>('attachment_path', { id }),
  reveal: (id: string) => invoke<void>('reveal_attachment', { id }),
  rename: (id: string, name: string) => invoke<Attachment>('rename_attachment', { id, name }),
  remove: async (id: string) => {
    if (desktop) return invoke<void>('remove_attachment', { id });
    const a = preview.attachments.find(a => a.id === id);
    if (a) removed.set(id, a);
    preview.attachments = preview.attachments.filter(a => a.id !== id);
  },
  restoreAttachment: (id: string) => invoke<void>('restore_attachment', { id }),
  folder: () => invoke<void>('open_data_dir'),
  backup: (locale: Locale) => invoke<string | null>('export_backup', { locale }),
  restore: (locale: Locale) => invoke<boolean>('restore_backup', { locale }),
};
