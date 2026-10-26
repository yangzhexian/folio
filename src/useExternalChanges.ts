import { useCallback, useEffect, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { api, desktop } from './api';
import type { Snapshot } from './types';

// Agents share the local backend with the desktop app. Refresh only at safe UI boundaries.
export function useExternalChanges(blocked: boolean, onSnapshot: (snapshot: Snapshot) => void, onError: (error: unknown) => void) {
  const current = useRef({ blocked, onSnapshot, onError });
  const generation = useRef(0);
  // An operation may start and finish before an earlier read resolves.
  if (blocked && !current.current.blocked) generation.current += 1;
  current.current = { blocked, onSnapshot, onError };
  const pending = useRef(false);
  const inFlight = useRef(false);
  const mounted = useRef(false);

  const synchronize = useCallback(async () => {
    if (!desktop || !mounted.current) return;
    if (current.current.blocked) { pending.current = true; return; }
    if (inFlight.current) { pending.current = true; return; }
    inFlight.current = true;
    pending.current = false;
    const startedAt = generation.current;
    try {
      const snapshot = await api.load();
      if (!mounted.current) return;
      if (current.current.blocked || startedAt !== generation.current) pending.current = true;
      else current.current.onSnapshot(snapshot);
    } catch (error) {
      if (mounted.current && startedAt === generation.current && !String(error).includes('LIBRARY_BUSY')) current.current.onError(error);
    } finally {
      inFlight.current = false;
      if (mounted.current && pending.current && !current.current.blocked) void synchronize();
    }
  }, []);

  useEffect(() => {
    if (!desktop) return;
    mounted.current = true;
    const focus = () => { void synchronize(); };
    window.addEventListener('focus', focus);
    const listener = getCurrentWindow().onFocusChanged(event => { if (event.payload) focus(); });
    void listener.catch(error => { if (mounted.current) current.current.onError(error); });
    return () => {
      mounted.current = false;
      generation.current += 1;
      pending.current = false;
      window.removeEventListener('focus', focus);
      void listener.then(unlisten => unlisten()).catch(() => {});
    };
  }, [synchronize]);

  useEffect(() => { if (!blocked && pending.current) void synchronize(); }, [blocked, synchronize]);
}
