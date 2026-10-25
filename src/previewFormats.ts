export type PreviewKind = 'png' | 'jpeg' | 'pdf';

export function previewKind(fileName: string): PreviewKind | null {
  const extension = /\.([^.]+)$/.exec(fileName)?.[1].toLowerCase();
  if (extension === 'png') return 'png';
  if (extension === 'jpg' || extension === 'jpeg') return 'jpeg';
  if (extension === 'pdf') return 'pdf';
  return null;
}
