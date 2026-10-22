import { useEffect, useRef, useState } from 'react';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { desktop } from './api';

/** Use native paths on desktop; prevent browser drops from navigating away. */
export function useFileDrop(onDrop: (paths: string[]) => void, onError: (error: unknown) => void) {
  const [dragging, setDragging] = useState(false);
  const callbacks = useRef({ onDrop, onError });
  callbacks.current = { onDrop, onError };

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    if (desktop) {
      void getCurrentWebview().onDragDropEvent(({ payload }) => {
        if (disposed) return;
        setDragging(payload.type === 'enter' || payload.type === 'over');
        if (payload.type === 'drop' && payload.paths.length) callbacks.current.onDrop([...new Set(payload.paths)]);
      }).then(stop => { if (disposed) stop(); else unlisten = stop; }).catch(error => {
        if (!disposed) callbacks.current.onError(error);
      });
    }

    const over = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      if (!desktop) { event.dataTransfer.dropEffect = 'none'; setDragging(true); }
    };
    const leave = (event: DragEvent) => { if (!event.relatedTarget) setDragging(false); };
    const drop = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      setDragging(false);
      if (!desktop) callbacks.current.onError(new Error('DESKTOP_ONLY'));
    };
    const clear = () => setDragging(false);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    window.addEventListener('blur', clear);
    return () => {
      disposed = true;
      unlisten?.();
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
      window.removeEventListener('blur', clear);
    };
  }, []);

  return dragging;
}
