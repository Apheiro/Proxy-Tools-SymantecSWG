/** biome-ignore-all lint/suspicious/noControlCharactersInRegex: SSH terminal escape sequences are intentional. */
export type BackupMode = 'encrypted' | 'unencrypted';

export interface BackupRecord {
  id: string;
  appliance: string;
  address: string;
  createdAt: string;
  mode: BackupMode;
  mocked: boolean;
  bytes: number;
  warning: string | null;
}

export interface BackupStatus {
  running: boolean;
  id: string;
  destination: string;
  phase: string;
  actions: string[];
  bytes: number;
  error: string | null;
  warning: string | null;
}

/** Presentation only: the complete original SSH bytes remain in the backup file. */
export function displayBackupLine(line: string) {
  return line
    .replace(
      /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\))/g,
      '',
    )
    .replace(/\r$/, '');
}

export function findBackupAppliance(
  proxies: Proxy[],
  address: string,
) {
  return proxies.find((proxy) =>
    [
      proxy.primary_address,
      proxy.registered_address,
      proxy.hostinfo.ip,
      proxy.hostinfo.hostname,
      proxy.hostname,
    ].includes(address),
  );
}
