import { describe, expect, it } from 'vitest';
import { createEmptyField, insertFieldAfter, reorderField } from './fieldEditing';
import type { Field } from './types';

const fields: Field[] = [
  { id: 'name', label: 'Full name', labelZh: '姓名', value: 'Alex Morgan', kind: 'text', sensitive: false },
  { id: 'birthday', label: 'Birthday', labelZh: '生日', value: '2000-02-29', kind: 'date', sensitive: true },
  { id: 'notes', label: 'Notes', labelZh: '说明', value: 'First line\nSecond line', kind: 'multiline', sensitive: false },
];

describe('field insertion and ordering', () => {
  it('inserts into empty, first, middle, and last positions without altering existing fields', () => {
    const inserted = createEmptyField('inserted');
    expect(insertFieldAfter([], null, inserted)).toEqual([inserted]);
    expect(insertFieldAfter(fields, null, inserted).map(field => field.id)).toEqual(['inserted', 'name', 'birthday', 'notes']);
    const middle = insertFieldAfter(fields, 'name', inserted);
    expect(middle.map(field => field.id)).toEqual(['name', 'inserted', 'birthday', 'notes']);
    expect(middle[0]).toBe(fields[0]);
    expect(middle[2]).toBe(fields[1]);
    expect(insertFieldAfter(fields, 'notes', inserted).at(-1)).toBe(inserted);
    expect(fields.map(field => field.id)).toEqual(['name', 'birthday', 'notes']);
  });

  it('preserves complete field values, kinds, sensitivity, labels, and IDs when moving either direction', () => {
    const before = structuredClone(fields);
    const reordered = reorderField(fields, 'birthday', 2);
    expect(reordered.map(field => field.id)).toEqual(['name', 'notes', 'birthday']);
    expect(reordered[2]).toBe(fields[1]);
    expect(reordered[2]).toEqual(before[1]);
    expect(reorderField(reordered, 'birthday', 0).map(field => field.id)).toEqual(['birthday', 'name', 'notes']);
    expect(fields).toEqual(before);
  });

  it('keeps stable references on no-ops and rejects unknown anchors or duplicate identities', () => {
    expect(reorderField(fields, 'birthday', 1)).toBe(fields);
    expect(reorderField(fields, 'missing', 0)).toBe(fields);
    expect(reorderField(fields, 'birthday', Number.NaN)).toBe(fields);
    expect(insertFieldAfter(fields, 'missing', createEmptyField('new'))).toBe(fields);
    expect(insertFieldAfter(fields, 'name', { ...fields[1] })).toBe(fields);
    expect(reorderField(fields, 'birthday', -50)[0]).toBe(fields[1]);
    expect(reorderField(fields, 'birthday', 50).at(-1)).toBe(fields[1]);
  });
});
