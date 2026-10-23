import type { Field } from './types';

export function createEmptyField(id: string = crypto.randomUUID()): Field {
  return { id, label: '', labelZh: '', value: '', kind: 'text', sensitive: false };
}

/** A null anchor inserts at the start. A missing anchor never moves an insertion. */
export function insertFieldAfter(fields: Field[], afterId: string | null, field: Field): Field[] {
  if (fields.some(item => item.id === field.id)) return fields;
  const anchor = afterId === null ? -1 : fields.findIndex(item => item.id === afterId);
  if (afterId !== null && anchor < 0) return fields;
  return [...fields.slice(0, anchor + 1), field, ...fields.slice(anchor + 1)];
}

/** Move a field to its final zero-based position without rebuilding its contents. */
export function reorderField(fields: Field[], fieldId: string, destination: number): Field[] {
  const source = fields.findIndex(field => field.id === fieldId);
  if (source < 0 || !Number.isFinite(destination)) return fields;
  const target = Math.max(0, Math.min(fields.length - 1, Math.trunc(destination)));
  if (source === target) return fields;
  const result = [...fields];
  const [field] = result.splice(source, 1);
  result.splice(target, 0, field);
  return result;
}
