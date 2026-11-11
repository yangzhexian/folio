import { categories, categoryLabels } from './templates';
import type { Category, CategoryDefinition, Locale } from './types';

export const categoryIconIds = ['user-round', 'graduation-cap', 'briefcase-business', 'flask-conical', 'award', 'badge-check', 'users', 'file-text', 'sliders-horizontal', 'folder', 'heart', 'house', 'car', 'plane', 'wallet', 'book-open', 'calendar', 'globe', 'laptop', 'music', 'camera', 'star', 'shield', 'building'] as const;
export const defaultCategories: CategoryDefinition[] = categories.map((id, index) => ({ id, nameEn: categoryLabels[id].en, nameZh: categoryLabels[id].zh, icon: categoryIconIds[index] }));
export const defaultCategoriesRevision = 'builtin-v1';
export const maxCategories = 100;

export function categoryDefinition(catalog: CategoryDefinition[], id: Category): CategoryDefinition {
  return catalog.find(category => category.id === id) ?? defaultCategories.find(category => category.id === id) ?? { id, nameEn: id, nameZh: id, icon: 'folder' };
}

export function categoryName(category: CategoryDefinition, locale: Locale): string {
  return locale === 'zh' ? category.nameZh : category.nameEn;
}

export function categoryValidation(catalog: CategoryDefinition[]): 'categoryNamesRequired' | 'categoryNamesDuplicate' | 'categoryNameTooLong' | 'categoryLimit' | undefined {
  if (catalog.length > maxCategories) return 'categoryLimit';
  for (const key of ['nameEn', 'nameZh'] as const) {
    const names = catalog.map(category => category[key].trim());
    if (names.some(name => !name || /[\u0000-\u001f\u007f]/u.test(name))) return 'categoryNamesRequired';
    if (names.some(name => [...name].length > 60)) return 'categoryNameTooLong';
    if (new Set(names.map(name => name.toLowerCase())).size !== names.length) return 'categoryNamesDuplicate';
  }
}

export function moveCategory(catalog: CategoryDefinition[], id: Category, target: number): CategoryDefinition[] {
  const from = catalog.findIndex(category => category.id === id);
  if (from < 0 || target < 0 || target >= catalog.length || from === target) return catalog;
  const next = [...catalog];
  next.splice(target, 0, next.splice(from, 1)[0]);
  return next;
}
