'use client';

import { useCallback, useEffect, useState } from 'react';
import { getLocalStorage, postLocalStorage } from '@/lib/utilsClient';

export type DataSourceMode = 'mock' | 'live';

const STORAGE_KEY = 'data-source-mode';
const CHANGE_EVENT = 'data-source-mode-change';

export default function useDataSourceMode() {
  const [mode, setModeState] = useState<DataSourceMode>('mock');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const readMode = () => {
      const stored = getLocalStorage<DataSourceMode>(STORAGE_KEY);
      setModeState(stored === 'live' ? 'live' : 'mock');
      setReady(true);
    };

    readMode();
    window.addEventListener(CHANGE_EVENT, readMode);
    window.addEventListener('storage', readMode);
    return () => {
      window.removeEventListener(CHANGE_EVENT, readMode);
      window.removeEventListener('storage', readMode);
    };
  }, []);

  const setMode = useCallback((nextMode: DataSourceMode) => {
    postLocalStorage(STORAGE_KEY, nextMode);
    setModeState(nextMode);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return { mode, ready, setMode };
}
