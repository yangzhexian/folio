import { expect, it } from 'vitest';
import { editableAttachmentName } from './attachmentName';

it('edits the generated suffix or a renamed suffix without the category and extension', () => {
  expect(editableAttachmentName('identity_9cedf69724b8.pdf')).toBe('9cedf69724b8');
  expect(editableAttachmentName('identity_passport.pdf')).toBe('passport');
  expect(editableAttachmentName('custom_project_notes.txt')).toBe('project_notes');
  expect(editableAttachmentName('documents_abcd1234')).toBe('abcd1234');
});

it('keeps the descriptive part editable for legacy managed names', () => {
  expect(editableAttachmentName('identity__基本信息__9cedf69724b8.pdf')).toBe('基本信息');
  expect(editableAttachmentName('research__project_notes__9cedf69724b8.docx')).toBe('project_notes');
});
