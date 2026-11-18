import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { IconButton } from './Buttons';
import { containTabFocus } from './dialogFocus';

interface ModalProps {
  title: string;
  closeLabel: string;
  close: () => void;
  wide?: boolean;
  children: ReactNode;
}

export function Modal({ title, closeLabel, close, wide, children }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef(document.activeElement as HTMLElement | null);
  const closeRef = useRef(close);
  closeRef.current = close;

  useLayoutEffect(() => {
    const node = ref.current!;
    const initial = node.querySelector<HTMLElement>('[data-autofocus]') ?? node.querySelector<HTMLElement>('input, textarea, select') ?? node.querySelector<HTMLElement>('button');
    initial?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (node !== [...document.querySelectorAll('[role="dialog"]')].at(-1)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
      } else {
        containTabFocus(event, node);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const active = document.activeElement as HTMLElement | null;
      if (active && active !== document.body && active.isConnected && !node.contains(active) && !active.closest('[role="dialog"]')) return;
      const opener = previous.current;
      if (opener?.isConnected) opener.focus();
      else document.querySelector<HTMLElement>('.compact-create, .nav-item[aria-current="page"]')?.focus();
    };
  }, []);

  return (
    <div className="modal-backdrop">
      <div ref={ref} className={wide ? 'modal modal-wide' : 'modal'} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-header">
          <h2>{title}</h2>
          <IconButton label={closeLabel} onClick={close}><X size={19} /></IconButton>
        </header>
        {children}
      </div>
    </div>
  );
}
