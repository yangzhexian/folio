import { ArrowDownToLine, ArrowUpFromLine, Copy, Database, EyeOff, FolderOpen, Languages, Moon, Palette, SlidersHorizontal, Sun } from 'lucide-react';
import { version } from '../../../package.json';
import { tFor } from '../../i18n';
import { accentColors, defaultAppearance, themeModes, type Appearance } from '../../theme';
import type { Locale } from '../../types';
import { Button, IconButton } from '../../ui/Buttons';
import { Modal } from '../../ui/Modal';

interface SettingsProps {
  locale: Locale;
  appearance: Appearance;
  hideSensitive: boolean;
  dataDir: string;
  desktop: boolean;
  busy: boolean;
  onLocale: (locale: Locale) => void;
  onAppearance: (appearance: Appearance) => void;
  onToggleSensitive: () => void;
  onCategories: () => void;
  onCopyPath: () => void;
  onOpenFolder: () => void;
  onBackup: () => void;
  onRestore: () => void;
  onClose: () => void;
}

export function SettingsDialog(props: SettingsProps) {
  const { appearance, busy, desktop, locale } = props;
  const t = tFor(locale);
  return (
    <Modal title={t('settings')} close={props.onClose} closeLabel={t('close')}>
      <div className="settings-content">
        <div className="settings-row">
          <div><Languages size={18} /><strong>{t('language')}</strong></div>
          <select aria-label={t('language')} value={locale} onChange={event => props.onLocale(event.target.value as Locale)}>
            <option value="en">English</option>
            <option value="zh">简体中文</option>
          </select>
        </div>
        <div className="settings-row">
          <div><EyeOff size={18} /><strong>{t('hideSensitiveFields')}</strong></div>
          <button type="button" className="settings-switch" role="switch" aria-label={t('hideSensitiveFields')} aria-checked={props.hideSensitive} onClick={props.onToggleSensitive}><span /></button>
        </div>
        <div className="settings-row">
          <div><SlidersHorizontal size={18} /><strong>{t('collections')}</strong></div>
          <Button small disabled={busy} onClick={props.onCategories}>{t('manageCategories')}</Button>
        </div>
        <div className="settings-section">
          <div className="settings-section-title"><Palette size={19} /><h3>{t('appearance')}</h3></div>
          <div className="appearance-controls">
            <fieldset>
              <legend>{t('theme')}</legend>
              <div className="theme-modes">
                {themeModes.map(theme => (
                  <button type="button" key={theme} className="theme-mode" aria-pressed={appearance.theme === theme} onClick={() => props.onAppearance({ ...appearance, theme })}>
                    {theme === 'light' ? <Sun size={17} /> : <Moon size={17} />}{t(theme)}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>{t('accentColor')}</legend>
              <div className="accent-options">
                {accentColors.map(accent => (
                  <button type="button" key={accent} className="accent-option" title={t(accent)} aria-label={t(accent)} aria-pressed={appearance.accent === accent} onClick={() => props.onAppearance({ ...appearance, accent })}>
                    <span className="accent-swatch" data-swatch={accent} />
                  </button>
                ))}
              </div>
            </fieldset>
            <Button variant="text" onClick={() => props.onAppearance(defaultAppearance)}>{t('resetAppearance')}</Button>
          </div>
        </div>
        <div className="settings-section">
          <div className="settings-section-title"><Database size={19} /><h3>{t('storage')}</h3></div>
          <div className="form-label">
            {t('dataFolder')}
            <div className="path-box">
              <code>{props.dataDir}</code>
              <IconButton label={t('copyPath')} disabled={!desktop} onClick={props.onCopyPath}><Copy size={15} /></IconButton>
            </div>
          </div>
          <Button disabled={!desktop || busy} onClick={props.onOpenFolder}><FolderOpen size={16} />{t('openFolder')}</Button>
          <p className="privacy-note">{t('storageDetail')}</p>
        </div>
        <div className="settings-section">
          <h3>{t('backup')}</h3><p>{t('backupHelp')}</p>
          <div className="backup-actions">
            <Button disabled={!desktop || busy} onClick={props.onBackup}><ArrowDownToLine size={16} />{t('backup')}</Button>
            <Button disabled={!desktop || busy} onClick={props.onRestore}><ArrowUpFromLine size={16} />{t('restore')}</Button>
          </div>
        </div>
        <footer className="settings-footer"><span>Folio</span><span>{version}</span></footer>
      </div>
    </Modal>
  );
}
