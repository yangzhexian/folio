import { categoryLabels } from './templates';
import type { Attachment, Category, Field, Locale, ProfileRecord } from './types';

function normalizeSearch(value: string): string {
  return value.normalize('NFKC').toLowerCase();
}

const searchAliases = {
  qq: ['qq', 'qq号', 'qq号码', 'qq账号', 'qq帐号', 'qq number', 'qq account'],
  phone: ['mobile', 'phone', 'telephone', 'phone number', 'telephone number', 'mobile phone', 'mobile number', 'mobile phone number', 'cell phone', 'cellphone', 'cell phone number', 'cellphone number', '手机', '手机号', '手机号码', '电话', '电话号码', '联系电话', '联系手机'],
  documentNumber: ['id number', 'document number', 'identity number', 'identification number', '身份证号', '身份证号码', '证件号', '证件号码', '证件编号'],
  email: ['email', 'e-mail', 'email address', 'e-mail address', '邮箱', '邮箱地址', '电子邮件', '电子邮箱', '电子邮件地址'],
  wechat: ['wechat', 'wechat id', '微信', '微信号', '微信账号', '微信帐号'],
  address: ['address', 'postal address', 'mailing address', 'street address', '通讯地址', '通信地址', '联系地址', '地址'],
  postalCode: ['postal code', 'postcode', 'zip code', '邮编', '邮政编码'],
  birthDate: ['date of birth', 'birth date', 'birthday', '出生日期', '生日'],
} as const;
type SearchConcept = keyof typeof searchAliases;
type SearchTerm = { text: string; concept?: SearchConcept; literals?: RegExp[] };
type SearchIndex = { text: string; concepts: Set<SearchConcept> };

function aliasPattern(alias: string, wordBoundaries = true): string {
  const normalized = normalizeSearch(alias).trim().replace(/\s+/gu, ' ');
  const characters = [...normalized];
  const han = /\p{Script=Han}/u;
  const pattern = characters.map((character, index) => {
    if (/\s/u.test(character)) return han.test(characters[index - 1] ?? '') || han.test(characters[index + 1] ?? '') ? '\\s*' : '\\s+';
    const escaped = character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const next = characters[index + 1];
    return escaped + (next && !/\s/u.test(next) && (han.test(character) || han.test(next)) ? '\\s*' : '');
  }).join('');
  // English aliases must be complete words, so "phone" does not classify "headphone".
  return (wordBoundaries && /^[a-z0-9]/u.test(normalized) ? '(?<![a-z0-9])' : '') + pattern + (wordBoundaries && /[a-z0-9]$/u.test(normalized) ? '(?![a-z0-9])' : '');
}

const aliasExpression = new RegExp(Object.entries(searchAliases).map(([concept, aliases]) => `(?<${concept}>${[...aliases].sort((a, b) => b.length - a.length).map(alias => aliasPattern(alias)).join('|')})`).join('|'), 'gu');

function matchedConcept(match: RegExpMatchArray): SearchConcept {
  return Object.keys(match.groups!).find(key => match.groups![key] !== undefined) as SearchConcept;
}

function searchTerms(query: string): SearchTerm[] {
  const normalized = normalizeSearch(query);
  const terms: SearchTerm[] = [];
  const addLiteral = (text: string) => terms.push(...text.split(/\s+/u).filter(Boolean).map(text => ({ text })));
  let position = 0;
  for (const match of normalized.matchAll(aliasExpression)) {
    addLiteral(normalized.slice(position, match.index));
    terms.push({ text: match[0], concept: matchedConcept(match), literals: match[0].split(/\s+/u).filter(Boolean).map(token => new RegExp(aliasPattern(token, false), 'u')) });
    position = match.index! + match[0].length;
  }
  addLiteral(normalized.slice(position));
  return terms;
}

function fieldSearchIndex(field: Field): SearchIndex {
  const labels = normalizeSearch([field.label, field.labelZh ?? ''].join('\n'));
  return {
    text: `${labels}\n${normalizeSearch(field.value)}`,
    concepts: new Set([...labels.matchAll(aliasExpression)].map(matchedConcept)),
  };
}

function recordSearchIndex(record: ProfileRecord): SearchIndex {
  const labels = categoryLabels[record.category];
  const fields = record.fields.map(fieldSearchIndex);
  return {
    text: normalizeSearch([record.title, record.subtitle, record.notes, record.category, labels.en, labels.zh, ...record.tags, ...fields.map(field => field.text)].join('\n')),
    concepts: new Set(fields.flatMap(field => [...field.concepts])),
  };
}

function matchesTerm(index: SearchIndex, term: SearchTerm): boolean {
  return term.concept ? index.concepts.has(term.concept) || term.literals!.every(literal => literal.test(index.text)) : index.text.includes(term.text);
}

function matchesTerms(index: SearchIndex, terms: SearchTerm[]): boolean {
  return terms.every(term => matchesTerm(index, term));
}

export function filterRecords(records: ProfileRecord[], attachments: Attachment[], query: string, category: 'all' | 'favorites' | Category): ProfileRecord[] {
  const terms = searchTerms(query);
  const attachmentNames = new Map<string, string[]>();
  for (const attachment of attachments) {
    const names = attachmentNames.get(attachment.recordId) ?? [];
    names.push(attachment.fileName, attachment.originalName);
    attachmentNames.set(attachment.recordId, names);
  }
  return records.filter((record) => {
    if (category === 'favorites' && !record.favorite) return false;
    if (category !== 'all' && category !== 'favorites' && record.category !== category) return false;
    if (terms.length === 0) return true;
    const index = recordSearchIndex(record);
    index.text += '\n' + normalizeSearch((attachmentNames.get(record.id) ?? []).join('\n'));
    return matchesTerms(index, terms);
  });
}

export function filterAttachments(records: ProfileRecord[], attachments: Attachment[], query: string): Attachment[] {
  const terms = searchTerms(query);
  const parents = new Map(records.map(record => [record.id, recordSearchIndex(record)]));
  return attachments.filter(file => {
    const parent = parents.get(file.recordId);
    if (parent === undefined) return false;
    return matchesTerms({ text: `${parent.text}\n${normalizeSearch(file.fileName)}\n${normalizeSearch(file.originalName)}`, concepts: parent.concepts }, terms);
  });
}

export function findMatchingFields(record: ProfileRecord, query: string): Field[] {
  const terms = searchTerms(query);
  if (terms.length === 0 || !matchesTerms(recordSearchIndex(record), terms)) return [];
  // Parent metadata and other fields can supply context, but each hit must match its own content.
  return record.fields.filter(field => {
    const index = fieldSearchIndex(field);
    return terms.some(term => matchesTerm(index, term));
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
