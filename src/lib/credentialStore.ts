'use client';

import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import {
  type DataSourceMode,
  getStoredDataSourceMode,
} from '@/lib/dataSourceMode';
import { clearScrapingCache } from '@/lib/scrapingCache';

export const MOCK_CREDENTIALS_KEY = 'mock-management-credentials';
const saved: Record<DataSourceMode, Credentials | null> = {
  live: null,
  mock: null,
};
const temporary: Record<DataSourceMode, Credentials | null> = {
  live: null,
  mock: null,
};
const initialization: Partial<Record<DataSourceMode, Promise<void>>> =
  {};
let credentialRevision = 0;
function changed() {
  clearScrapingCache();
  credentialRevision++;
  window.dispatchEvent(new Event('management-credentials-changed'));
}

function readMockCredentials(): Credentials | null {
  const raw = localStorage.getItem(MOCK_CREDENTIALS_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Credentials;
    return typeof value?.username === 'string' &&
      typeof value?.password === 'string'
      ? value
      : null;
  } catch {
    return null;
  }
}
export function useCredentialRevision() {
  const [revision, setRevision] = useState(credentialRevision);
  useEffect(() => {
    const changed = () => setRevision(credentialRevision);
    window.addEventListener(
      'management-credentials-changed',
      changed,
    );
    return () =>
      window.removeEventListener(
        'management-credentials-changed',
        changed,
      );
  }, []);
  return revision;
}

export function credentialValue(key: string): Credentials | null {
  const mode = getStoredDataSourceMode();
  return key === 'credentials'
    ? mode === 'mock'
      ? readMockCredentials()
      : saved.live
    : temporary[mode];
}

export function initializeCredentials() {
  const mode = getStoredDataSourceMode();
  changed();
  if (!initialization[mode])
    initialization[mode] = (async () => {
      if (mode === 'mock') {
        saved.mock = readMockCredentials();
        return;
      }
      saved.live = await invoke<Credentials | null>(
        'read_management_credentials',
      );
      const legacy = localStorage.getItem('credentials');
      if (legacy && !saved.live) {
        const value = JSON.parse(legacy) as Credentials;
        await invoke('save_management_credentials', {
          credentials: value,
        });
        saved.live = value;
      }
      // Remove legacy plaintext only after a successful vault migration.
      localStorage.removeItem('credentials');
      localStorage.removeItem('one-time-credentials');
    })().catch((error) => {
      delete initialization[mode];
      throw error;
    });
  return initialization[mode].then(changed);
}

export async function storeCredentials(
  value: Credentials,
  persist = true,
) {
  const mode = getStoredDataSourceMode();
  if (persist) {
    if (mode === 'mock') {
      localStorage.setItem(
        MOCK_CREDENTIALS_KEY,
        JSON.stringify(value),
      );
    } else
      await invoke('save_management_credentials', {
        credentials: value,
      });
    saved[mode] = { ...value };
    temporary[mode] = null;
  } else {
    if (mode === 'live') await invoke('clear_management_sessions');
    temporary[mode] = { ...value };
  }
  changed();
}

export async function removeCredentials(key: string) {
  const mode = getStoredDataSourceMode();
  if (key === 'credentials') {
    if (mode === 'mock')
      localStorage.removeItem(MOCK_CREDENTIALS_KEY);
    else await invoke('delete_management_credentials');
    saved[mode] = null;
    temporary[mode] = null;
  } else {
    temporary[mode] = null;
    if (mode === 'live') await invoke('clear_management_sessions');
  }
  changed();
}
