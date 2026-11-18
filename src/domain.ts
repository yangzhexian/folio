import { categoryDefinition, defaultCategories } from './categories';
import type { Attachment, Category, CategoryDefinition, Field, Locale, ProfileRecord } from './types';

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

function matchesTerm(index: SearchIndex, term: SearchTerm): boolean {
  return term.concept ? index.concepts.has(term.concept) || term.literals!.every(literal => literal.test(index.text)) : index.text.includes(term.text);
}

function matchesTerms(index: SearchIndex, terms: SearchTerm[]): boolean {
  return terms.every(term => matchesTerm(index, term));
}

type RecordFilter = 'all' | 'favorites' | Category;
type IndexedRecord = {
  parent: SearchIndex;
  withFileNames: SearchIndex;
  fields: SearchIndex[];
};

export function createLibraryIndex(records: ProfileRecord[], attachments: Attachment[], catalog: CategoryDefinition[] = defaultCategories) {
  const recordsById = new Map<string, ProfileRecord>();
  const filesByRecord = new Map<string, Attachment[]>();
  const categoryCounts = new Map<Category, number>();
  const indexed = new Map<string, IndexedRecord>();
  const individualNames = new Map<string, string>();
  let favoriteCount = 0;

  for (const record of records) {
    recordsById.set(record.id, record);
    categoryCounts.set(record.category, (categoryCounts.get(record.category) ?? 0) + 1);
    if (record.favorite) favoriteCount++;
  }
  for (const file of attachments) {
    const siblings = filesByRecord.get(file.recordId);
    if (siblings) siblings.push(file);
    else filesByRecord.set(file.recordId, [file]);
  }

  // Empty queries use only the lookup maps. Normalized text lives for one snapshot.
  function getIndex(record: ProfileRecord): IndexedRecord {
    const existing = indexed.get(record.id);
    if (existing) return existing;
    const labels = categoryDefinition(catalog, record.category);
    const fields = record.fields.map(fieldSearchIndex);
    const parent = {
      text: normalizeSearch([record.title, record.subtitle, record.notes, record.category, labels.nameEn, labels.nameZh, ...record.tags, ...fields.map(field => field.text)].join('\n')),
      concepts: new Set(fields.flatMap(field => [...field.concepts])),
    };
    const names = (filesByRecord.get(record.id) ?? []).map(file => {
      const name = normalizeSearch([file.fileName, file.originalName].join('\n'));
      individualNames.set(file.id, name);
      return name;
    });
    const entry = { parent, fields, withFileNames: { text: [parent.text, ...names].join('\n'), concepts: parent.concepts } };
    indexed.set(record.id, entry);
    return entry;
  }

  function search(query: string, category: RecordFilter, includeFiles = false) {
    const terms = searchTerms(query);
    const fields = new Map<string, Field[]>();
    const hits = records.filter(record => {
      if (category === 'favorites' && !record.favorite) return false;
      if (category !== 'all' && category !== 'favorites' && record.category !== category) return false;
      if (!terms.length) return true;
      const index = getIndex(record);
      if (!matchesTerms(index.withFileNames, terms)) return false;
      // Field hits use parent context, but a sibling filename cannot turn a field into a hit.
      if (!includeFiles && matchesTerms(index.parent, terms)) {
        const matches = record.fields.filter((_, i) => terms.some(term => matchesTerm(index.fields[i], term)));
        if (matches.length) fields.set(record.id, matches);
      }
      return true;
    });
    const files = includeFiles ? attachments.filter(file => {
      const owner = recordsById.get(file.recordId);
      if (!owner || !terms.length) return !!owner;
      const { parent } = getIndex(owner);
      return matchesTerms({ text: parent.text + '\n' + individualNames.get(file.id), concepts: parent.concepts }, terms);
    }) : [];
    return { records: hits, fields, files };
  }
  return { recordsById, filesByRecord, categoryCounts, favoriteCount, search };
}

export function filterRecords(records: ProfileRecord[], attachments: Attachment[], query: string, category: RecordFilter, catalog: CategoryDefinition[] = defaultCategories): ProfileRecord[] {
  return createLibraryIndex(records, attachments, catalog).search(query, category).records;
}

export function filterAttachments(records: ProfileRecord[], attachments: Attachment[], query: string, catalog: CategoryDefinition[] = defaultCategories): Attachment[] {
  return createLibraryIndex(records, attachments, catalog).search(query, 'all', true).files;
}

export function findMatchingFields(record: ProfileRecord, query: string, catalog: CategoryDefinition[] = defaultCategories): Field[] {
  return createLibraryIndex([record], [], catalog).search(query, 'all').fields.get(record.id) ?? [];
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
