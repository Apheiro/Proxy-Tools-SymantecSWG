'use client';
import { useSyncExternalStore } from 'react';
import {
  DEFAULT_SHORTCUTS,
  sanitizeShortcuts,
  type ShortcutMap,
} from './shortcutBindings';
export type AppPreferences = {
  proxyContextMenu: boolean;
  shortcuts: ShortcutMap;
};
const KEY = 'app-interface-preferences';
const EVENT = 'app-interface-preferences-changed';
const DEFAULTS: AppPreferences = {
  proxyContextMenu: false,
  shortcuts: DEFAULT_SHORTCUTS,
};
let rawCache: string | null | undefined;
let cache = DEFAULTS;
function read(): AppPreferences {
  if (typeof window === 'undefined') return DEFAULTS;
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return cache;
  }
  if (raw === rawCache) return cache;
  rawCache = raw;
  try {
    const stored = raw ? JSON.parse(raw) : {};
    cache = {
      proxyContextMenu: stored?.proxyContextMenu === true,
      shortcuts: sanitizeShortcuts(stored?.shortcuts),
    };
  } catch {
    cache = DEFAULTS;
  }
  return cache;
}
function subscribe(changed: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) changed();
  };
  window.addEventListener(EVENT, changed);
  window.addEventListener('storage', storage);
  return () => {
    window.removeEventListener(EVENT, changed);
    window.removeEventListener('storage', storage);
  };
}
export function setAppPreferences(patch: Partial<AppPreferences>) {
  const next = { ...read(), ...patch };
  localStorage.setItem(KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(EVENT));
}
export function useAppPreferences() {
  return useSyncExternalStore(subscribe, read, () => DEFAULTS);
}
