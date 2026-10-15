'use client';

import { invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect, useState } from 'react';
import {
  DATA_SOURCE_EVENT,
  DATA_SOURCE_KEY,
  type DataSourceMode,
  getStoredDataSourceMode,
} from '@/lib/dataSourceMode';
import { clearScrapingCache } from '@/lib/scrapingCache';
import { postLocalStorage } from '@/lib/utilsClient';

export type { DataSourceMode } from '@/lib/dataSourceMode';

const STORAGE_KEY = DATA_SOURCE_KEY;
const CHANGE_EVENT = DATA_SOURCE_EVENT;

export default function useDataSourceMode() {
  const [mode, setModeState] = useState<DataSourceMode>('live');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const readMode = () => {
      setModeState(getStoredDataSourceMode());
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
    clearScrapingCache();
    void invoke('clear_management_sessions').catch(() => undefined);
    void invoke('close_other_ssh_profiles', { mocked: nextMode === 'mock' }).catch(() => undefined);
    postLocalStorage(STORAGE_KEY, nextMode);
    setModeState(nextMode);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return { mode, ready, setMode };
}
