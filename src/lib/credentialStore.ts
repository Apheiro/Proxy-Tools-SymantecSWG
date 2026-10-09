'use client';

import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { clearScrapingCache } from '@/lib/scrapingCache';

let saved: Credentials | null = null;
let temporary: Credentials | null = null;
let initialization: Promise<void> | undefined;
let credentialRevision = 0;
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
  return key === 'credentials' ? saved : temporary;
}

export function initializeCredentials() {
  if (!initialization)
    initialization = (async () => {
      saved = await invoke<Credentials | null>(
        'read_management_credentials',
      );
      const legacy = localStorage.getItem('credentials');
      if (legacy && !saved) {
        const value = JSON.parse(legacy) as Credentials;
        await invoke('save_management_credentials', {
          credentials: value,
        });
        saved = value;
      }
      // Remove legacy plaintext only after a successful vault migration.
      localStorage.removeItem('credentials');
      localStorage.removeItem('one-time-credentials');
    })().catch((error) => {
      initialization = undefined;
      throw error;
    });
  return initialization;
}

export async function storeCredentials(
  value: Credentials,
  persist = true,
) {
  if (persist) {
    await invoke('save_management_credentials', {
      credentials: value,
    });
    saved = { ...value };
    temporary = null;
  } else {
    await invoke('clear_management_sessions');
    temporary = { ...value };
  }
  clearScrapingCache();
  credentialRevision++;
  window.dispatchEvent(new Event('management-credentials-changed'));
}

export async function removeCredentials(key: string) {
  if (key === 'credentials') {
    await invoke('delete_management_credentials');
    saved = null;
    temporary = null;
  } else {
    temporary = null;
    await invoke('clear_management_sessions');
  }
  clearScrapingCache();
  credentialRevision++;
  window.dispatchEvent(new Event('management-credentials-changed'));
}
