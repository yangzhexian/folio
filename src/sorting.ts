import type { Locale, ProfileRecord } from './types';

export const recordSortOrders = ['updated-desc', 'updated-asc', 'created-desc', 'created-asc', 'title-asc', 'title-desc'] as const;

export type RecordSortOrder = (typeof recordSortOrders)[number];

export function isRecordSortOrder(value: unknown): value is RecordSortOrder {
  return typeof value === 'string' && recordSortOrders.some((order) => order === value);
}

export function sortRecords(records: ProfileRecord[], order: RecordSortOrder, locale: Locale): ProfileRecord[] {
  const direction = order.endsWith('-asc') ? 1 : -1;
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
  const dateKey = order.startsWith('created-') ? 'createdAt' : 'updatedAt';

  return [...records].sort((left, right) => {
    let comparison: number;
    if (order.startsWith('title-')) {
      comparison = collator.compare(left.title, right.title) * direction;
    } else {
      const leftTime = Date.parse(left[dateKey]);
      const rightTime = Date.parse(right[dateKey]);
      const leftInvalid = Number.isNaN(leftTime);
      const rightInvalid = Number.isNaN(rightTime);
      // Missing or malformed dates stay after valid dates in either direction.
      comparison = leftInvalid || rightInvalid
        ? Number(leftInvalid) - Number(rightInvalid)
        : (leftTime - rightTime) * direction;
    }
    return comparison || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  });
}
