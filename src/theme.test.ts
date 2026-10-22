import { describe, expect, it } from 'vitest';
import { accentColors, accentSwatches, applyAppearance, isAccentColor, isThemeMode, readAppearance, saveAppearance, themeModes } from './theme';

describe('appearance preferences', () => {
  it('keeps the existing light sage theme when preferences are absent', () => {
    expect(readAppearance()).toEqual({ theme: 'light', accent: 'sage' });
    expect(readAppearance({ getItem: () => null })).toEqual({ theme: 'light', accent: 'sage' });
  });

  it('validates stored values without discarding a valid sibling preference', () => {
    expect(readAppearance({ getItem: (key) => key === 'folio.theme' ? 'unknown' : 'violet' })).toEqual({ theme: 'light', accent: 'violet' });
    expect(readAppearance({ getItem: (key) => key === 'folio.theme' ? 'dark' : 'invalid' })).toEqual({ theme: 'dark', accent: 'sage' });
    for (const value of [undefined, null, {}, 1, '', 'LIGHT', 'system']) expect(isThemeMode(value)).toBe(false);
    for (const value of [undefined, null, {}, 1, '', 'Blue', '#ff0000']) expect(isAccentColor(value)).toBe(false);
    for (const theme of themeModes) expect(isThemeMode(theme)).toBe(true);
    for (const accent of accentColors) expect(isAccentColor(accent)).toBe(true);
  });

  it('round-trips all supported combinations', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    for (const theme of themeModes) {
      for (const accent of accentColors) {
        expect(saveAppearance({ theme, accent }, storage)).toBe(true);
        expect(readAppearance(storage)).toEqual({ theme, accent });
        expect(accentSwatches[accent]).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it('survives unavailable browser storage', () => {
    expect(readAppearance({ getItem: () => { throw new Error('Blocked'); } })).toEqual({ theme: 'light', accent: 'sage' });
    expect(saveAppearance({ theme: 'dark', accent: 'rose' }, { setItem: () => { throw new Error('Full'); } })).toBe(false);
  });

  it('applies theme and accent to the document independently', () => {
    const attributes = new Map<string, string>();
    const root = { setAttribute: (key: string, value: string) => { attributes.set(key, value); } };
    applyAppearance('dark', 'amber', root);
    expect(Object.fromEntries(attributes)).toEqual({ 'data-theme': 'dark', 'data-accent': 'amber' });
    applyAppearance('light', 'sage', root);
    expect(Object.fromEntries(attributes)).toEqual({ 'data-theme': 'light', 'data-accent': 'sage' });
  });
});
