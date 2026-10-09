'use client';
import {
  credentialValue,
  removeCredentials,
} from '@/lib/credentialStore';

export function postLocalStorage<T>(key: string, value: T) {
  if (key === 'credentials' || key === 'one-time-credentials')
    throw new Error('Use secure credential storage.');
  localStorage.setItem(key, JSON.stringify(value));
}

export function getLocalStorage<T>(key: string): T | null {
  if (key === 'credentials' || key === 'one-time-credentials')
    return credentialValue(key) as T | null;
  const item = localStorage.getItem(key);
  return item ? JSON.parse(item) : null;
}

export function deleteLocalStorage(key: string) {
  if (key === 'credentials' || key === 'one-time-credentials') {
    void removeCredentials(key).catch(() => undefined);
    return;
  }
  localStorage.removeItem(key);
}

export function clearLocalStorage() {
  localStorage.clear();
}
