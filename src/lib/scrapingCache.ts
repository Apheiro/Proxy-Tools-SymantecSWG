'use client';

import { useEffect, useState } from 'react';

type Entry = {
  data: unknown;
  serialized: string;
  updated: number;
  bytes: number;
};
const entries = new Map<string, Entry>();
const pending = new Map<string, Promise<unknown>>();
const MAX_AGE = 30 * 60 * 1000;
const MAX_BYTES = 16 * 1024 * 1024;
let generation = 0;

export function clearScrapingCache() {
  generation++;
  entries.clear();
  pending.clear();
  if (typeof window !== 'undefined')
    window.dispatchEvent(new Event('scraping-cache-cleared'));
}

export function readScrapingCache<T>(key: string): T | undefined {
  const entry = entries.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.updated > MAX_AGE) {
    entries.delete(key);
    return undefined;
  }
  entries.delete(key);
  entries.set(key, entry);
  return entry.data as T;
}

export async function refreshScrapingCache<T>(
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  const existing = pending.get(key);
  if (existing) return existing as Promise<T>;
  const revision = generation;
  const request = load()
    .then((data) => {
      if (revision !== generation)
        throw new Error('The connection context changed.');
      const serialized = JSON.stringify(data);
      const previous = entries.get(key);
      if (previous?.serialized === serialized) {
        previous.updated = Date.now();
        return previous.data as T;
      }
      const bytes = serialized.length * 2;
      if (bytes <= MAX_BYTES) {
        entries.delete(key);
        while (
          entries.size >= 16 ||
          [...entries.values()].reduce(
            (total, item) => total + item.bytes,
            0,
          ) +
            bytes >
            MAX_BYTES
        ) {
          const oldest = entries.keys().next().value;
          if (oldest === undefined) break;
          entries.delete(oldest);
        }
        entries.set(key, {
          data,
          serialized,
          bytes,
          updated: Date.now(),
        });
      }
      return data;
    })
    .finally(() => {
      if (pending.get(key) === request) pending.delete(key);
    });
  pending.set(key, request);
  return request;
}

/** Session-only stale-while-revalidate cache; keys never contain passwords. */
export function useScrapedData<T>(
  key: string,
  enabled: boolean,
  load: () => Promise<T>,
) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    key: string;
    data?: T;
    busy: boolean;
    error?: string;
  }>({ key: '', busy: false });
  useEffect(() => {
    const invalidate = () => {
      setState({ key: '', busy: false });
      setRevision((value) => value + 1);
    };
    window.addEventListener('scraping-cache-cleared', invalidate);
    return () =>
      window.removeEventListener(
        'scraping-cache-cleared',
        invalidate,
      );
  }, []);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let running = false;
    let refreshed = 0;
    const refresh = async () => {
      if (running || Date.now() - refreshed < 30_000) return;
      running = true;
      setState((previous) => ({
        key,
        data:
          previous.key === key
            ? previous.data
            : readScrapingCache<T>(key),
        busy: true,
      }));
      try {
        const data = await refreshScrapingCache(key, load);
        if (!cancelled) setState({ key, data, busy: false });
      } catch (error) {
        if (!cancelled) {
          const message = String(error);
          if (/HTTP 401|HTTP 403/.test(message)) entries.delete(key);
          setState((previous) => ({
            key,
            data: /HTTP 401|HTTP 403/.test(message)
              ? undefined
              : previous.data,
            busy: false,
            error: message,
          }));
        }
      } finally {
        running = false;
        refreshed = Date.now();
      }
    };
    void refresh();
    const focus = () => {
      void refresh();
    };
    window.addEventListener('focus', focus);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', focus);
    };
  }, [key, enabled, load, revision]);
  if (!enabled)
    return { data: undefined, busy: false, error: undefined };
  return state.key === key
    ? state
    : {
        data: readScrapingCache<T>(key),
        busy: true,
        error: undefined,
      };
}
