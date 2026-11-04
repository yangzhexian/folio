import { invoke, isTauri } from '@tauri-apps/api/core';
import { previewKind } from './previewFormats';
import type { Attachment } from './types';

export const previewWindowLabel = 'attachment-preview';
export const previewSessionEvent = 'folio:preview-session';

export interface PreviewSession {
  revision: number;
  id: string;
  files: Attachment[];
  pinned: boolean;
}

// Native state carries only IDs. No file names, paths, or document bytes enter a URL or preference store.
export async function openPreviewWindow(id: string, files: Attachment[]): Promise<boolean> {
  if (!isTauri()) return false;
  const ids = files.filter(file => previewKind(file.fileName)).map(file => file.id);
  return await invoke<boolean>('open_preview_window', { id, ids }) === true;
}

export const loadPreviewSession = () => invoke<PreviewSession>('load_preview_session');
export const setPreviewPinned = (pinned: boolean) => invoke<boolean>('set_preview_pinned', { pinned });
