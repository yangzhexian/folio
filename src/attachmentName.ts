/** Return only the user-editable suffix, including support for pre-0.3 names. */
export function editableAttachmentName(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, '');
  const legacy = stem.match(/^[^_]+__(.+)__[a-f0-9]{12}$/i);
  if (legacy) return legacy[1];
  return stem.replace(/^[^_]+_/, '');
}
