'use client';

import { invoke } from '@tauri-apps/api/core';
import type { DataSourceMode } from '@/lib/dataSourceMode';

export const MOCK_UPDATE_TOKEN_KEY = 'mock-github-release-token';
export const UPDATE_TOKEN_EVENT = 'github-release-token-change';
export const UPDATE_CHECK_EVENT = 'app-update-check';
export interface AppUpdate {
  id: number;
  version: string;
  currentVersion: string;
  notes: string;
  filename: string;
  bytes: number;
}
export interface DownloadedUpdate {
  filename: string;
  path: string;
  currentExecutable: string;
}
export function mockUpdateToken(): string | null {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(MOCK_UPDATE_TOKEN_KEY) ?? 'null',
    );
    return typeof value === 'string' && value.length > 0
      ? value
      : null;
  } catch {
    return null;
  }
}
export async function hasUpdateToken(
  mode: DataSourceMode,
): Promise<boolean> {
  return mode === 'mock'
    ? Boolean(mockUpdateToken())
    : Boolean(await invoke('has_update_token'));
}
export async function saveUpdateToken(
  mode: DataSourceMode,
  value: string,
) {
  const token = value.trim();
  if (!token || token.length > 4096 || !/^[\x21-\x7e]+$/.test(token))
    throw new Error('Enter a valid GitHub token without whitespace.');
  if (mode === 'mock')
    localStorage.setItem(
      MOCK_UPDATE_TOKEN_KEY,
      JSON.stringify(token),
    );
  else await invoke('save_update_token', { token });
  window.dispatchEvent(
    new CustomEvent(UPDATE_TOKEN_EVENT, { detail: mode }),
  );
}
export async function deleteUpdateToken(mode: DataSourceMode) {
  if (mode === 'mock') localStorage.removeItem(MOCK_UPDATE_TOKEN_KEY);
  else await invoke('delete_update_token');
  window.dispatchEvent(
    new CustomEvent(UPDATE_TOKEN_EVENT, { detail: mode }),
  );
}
export function updateRequest(mode: DataSourceMode) {
  return {
    mocked: mode === 'mock',
    mockToken: mode === 'mock' ? mockUpdateToken() : null,
  };
}
