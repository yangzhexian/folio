import { BookOpen, Folder, LayoutGrid, Settings, SlidersHorizontal, Star, type LucideIcon } from 'lucide-react';
import { categoryName } from '../../categories';
import { categoryIcon } from '../../categoryIcons';
import { tFor } from '../../i18n';
import type { Category, CategoryDefinition, Locale } from '../../types';
import { IconButton } from '../../ui/Buttons';

export type LibraryView = 'all' | 'favorites' | 'files' | Category;

interface SidebarProps {
  view: LibraryView;
  locale: Locale;
  catalog: CategoryDefinition[];
  categoryCounts: Map<Category, number>;
  records: number;
  favorites: number;
  files: number;
  busy: boolean;
  inert: boolean;
  onNavigate: (view: LibraryView) => void;
  onCategories: () => void;
  onSettings: () => void;
}

interface NavigationItemProps {
  icon: LucideIcon;
  label: string;
  selected?: boolean;
  count?: number;
  title?: string;
  onClick: () => void;
}

function NavigationItem({ icon: Icon, label, selected, count, title, onClick }: NavigationItemProps) {
  return (
    <button type="button" className={selected ? 'nav-item selected' : 'nav-item'} aria-current={selected ? 'page' : undefined} title={title} onClick={onClick}>
      <Icon size={17} /><span>{label}</span>{count !== undefined && <small>{count}</small>}
    </button>
  );
}

export function LibrarySidebar(props: SidebarProps) {
  const { locale, onNavigate, view } = props;
  const t = tFor(locale);
  return (
    <aside className="sidebar" inert={props.inert}>
      <div className="brand">
        <div className="brand-mark"><BookOpen size={21} strokeWidth={1.8} /></div>
        <span>Folio</span>
      </div>
      <nav aria-label={t('library')}>
        <NavigationItem icon={LayoutGrid} label={t('all')} selected={view === 'all'} count={props.records} onClick={() => onNavigate('all')} />
        <NavigationItem icon={Star} label={t('favorites')} selected={view === 'favorites'} count={props.favorites} onClick={() => onNavigate('favorites')} />
        <NavigationItem icon={Folder} label={t('files')} selected={view === 'files'} count={props.files} onClick={() => onNavigate('files')} />
        <div className="nav-caption">
          <span>{t('collections')}</span>
          <IconButton label={t('manageCategories')} disabled={props.busy} onClick={props.onCategories}><SlidersHorizontal size={14} /></IconButton>
        </div>
        {props.catalog.map(category => {
          const label = categoryName(category, locale);
          return (
            <NavigationItem key={category.id} icon={categoryIcon(category.icon)} label={label} title={label}
              selected={view === category.id} count={props.categoryCounts.get(category.id)} onClick={() => onNavigate(category.id)} />
          );
        })}
      </nav>
      <div className="sidebar-bottom"><NavigationItem icon={Settings} label={t('settings')} onClick={props.onSettings} /></div>
    </aside>
  );
}
