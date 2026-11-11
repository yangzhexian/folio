export type Locale = 'en' | 'zh';
export type BuiltInCategory = 'identity' | 'education' | 'experience' | 'research' | 'awards' | 'skills' | 'contacts' | 'documents' | 'custom';
export type Category = BuiltInCategory | `collection-${string}`;
export interface CategoryDefinition {
  id: Category;
  nameEn: string;
  nameZh: string;
  icon: string;
}
export interface CategoryCatalog {
  categories: CategoryDefinition[];
  revision: string;
}
export type FieldKind = 'text' | 'multiline' | 'date' | 'email' | 'phone' | 'url';

export interface Field {
  id: string;
  label: string;
  labelZh?: string;
  value: string;
  kind: FieldKind;
  sensitive: boolean;
}

export interface ProfileRecord {
  id: string;
  category: Category;
  title: string;
  subtitle: string;
  tags: string[];
  favorite: boolean;
  fields: Field[];
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface Attachment {
  id: string;
  recordId: string;
  originalName: string;
  fileName: string;
  relativePath: string;
  absolutePath: string;
  size: number;
  createdAt: string;
  revision?: string;
}

export interface Snapshot {
  records: ProfileRecord[];
  attachments: Attachment[];
  dataDir: string;
  categories?: CategoryDefinition[];
  categoriesRevision?: string;
}
