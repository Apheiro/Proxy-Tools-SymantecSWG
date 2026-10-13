export type DataSourceMode = 'mock' | 'live';
export const DATA_SOURCE_KEY = 'data-source-mode';
export const DATA_SOURCE_EVENT = 'data-source-mode-change';

export function getStoredDataSourceMode(): DataSourceMode {
  if (typeof window === 'undefined') return 'live';
  try {
    return JSON.parse(
      localStorage.getItem(DATA_SOURCE_KEY) ?? 'null',
    ) === 'mock'
      ? 'mock'
      : 'live';
  } catch {
    return 'live';
  }
}
