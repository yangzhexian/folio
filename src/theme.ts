export const themeModes = ['light', 'dark'] as const;
export const accentColors = ['sage', 'blue', 'violet', 'rose', 'amber'] as const;

export type ThemeMode = (typeof themeModes)[number];
export type AccentColor = (typeof accentColors)[number];

export interface Appearance {
  theme: ThemeMode;
  accent: AccentColor;
}

export const accentSwatches: Record<AccentColor, string> = {
  sage: '#4d6b50',
  blue: '#4269a3',
  violet: '#7353a1',
  rose: '#a34465',
  amber: '#94641b',
};

export function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === 'string' && themeModes.some((mode) => mode === value);
}

export function isAccentColor(value: unknown): value is AccentColor {
  return typeof value === 'string' && accentColors.some((accent) => accent === value);
}

export function readAppearance(storage?: Pick<Storage, 'getItem'>): Appearance {
  const appearance: Appearance = { theme: 'light', accent: 'sage' };
  if (!storage) return appearance;
  try {
    const theme = storage.getItem('folio.theme');
    const accent = storage.getItem('folio.accent');
    if (isThemeMode(theme)) appearance.theme = theme;
    if (isAccentColor(accent)) appearance.accent = accent;
  } catch {
    // A blocked preference store must not prevent opening the library.
  }
  return appearance;
}

export function saveAppearance(appearance: Appearance, storage: Pick<Storage, 'setItem'>): boolean {
  try {
    storage.setItem('folio.theme', appearance.theme);
    storage.setItem('folio.accent', appearance.accent);
    return true;
  } catch {
    return false;
  }
}

export function applyAppearance(theme: ThemeMode, accent: AccentColor, root: Pick<Element, 'setAttribute'> = document.documentElement): void {
  root.setAttribute('data-theme', theme);
  root.setAttribute('data-accent', accent);
}
