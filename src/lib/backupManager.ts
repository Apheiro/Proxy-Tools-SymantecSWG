/** biome-ignore-all lint/suspicious/noControlCharactersInRegex: SSH terminal escape sequences are intentional. */
export type BackupMode = 'encrypted' | 'unencrypted';

export interface BackupRecord {
  id: string;
  appliance: string;
  applianceIdentity?: string | null;
  requestedAddress?: string | null;
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

const backupIdentity = (value?: string | null) => {
  const normalized = value?.trim().toLowerCase().replace(/\.$/, '') ?? '';
  return ['unknown', 'unkown'].includes(normalized) ? '' : normalized;
};

type BackupOwner = { id: string; aliases: string[]; names: string[] };

/** Retain observed aliases across restarts without changing the proxy inventory. */
export function createBackupScope(proxies: Proxy[], address: string, mocked: boolean) {
  const key = `backupOwners.v1.${mocked ? 'mock' : 'live'}`;
  let owners: BackupOwner[] = [];
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    if (Array.isArray(saved)) owners = saved.filter((item): item is BackupOwner =>
      typeof item?.id === 'string' && Array.isArray(item.aliases) &&
      item.aliases.every((v: unknown) => typeof v === 'string') &&
      Array.isArray(item.names) && item.names.every((v: unknown) => typeof v === 'string'));
  } catch { /* The inventory still provides current ownership if storage is unavailable. */ }
  const current = proxies.map((proxy) => {
    const aliases = [proxy.registered_address, proxy.primary_address,
      proxy.hostinfo?.ip, proxy.hostinfo?.hostname, proxy.hostname]
      .map(backupIdentity).filter(Boolean);
    const id = backupIdentity(proxy.registered_address) || aliases[0];
    const previous = owners.find((owner) => owner.id === id);
    const owner = {
      id,
      aliases: [...new Set([...(previous?.aliases ?? []), ...aliases])],
      names: [...new Set([...(previous?.names ?? []), ...[proxy.hostname, proxy.hostinfo?.hostname].map(backupIdentity).filter(Boolean)])],
    };
    owners = [...owners.filter((item) => item.id !== id), owner];
    return { proxy, owner, aliases };
  });
  const target = backupIdentity(address);
  const registered = current.filter(({ proxy }) => backupIdentity(proxy.registered_address) === target);
  const matches = registered.length ? registered : current.filter(({ aliases }) => aliases.includes(target));
  const selected = matches.length === 1 ? matches[0] : undefined;
  const identity = selected?.owner.id ?? (matches.length === 0 ? target : '');
  if (identity && !owners.some((owner) => owner.id === identity)) {
    owners.push({ id: identity, aliases: [target], names: [] });
  }
  try { localStorage.setItem(key, JSON.stringify(owners)); } catch { /* Best effort alias history. */ }
  return {
    identity,
    appliance: selected?.proxy.hostname || address,
    includes(record: BackupRecord) {
      if (!identity || record.mocked !== mocked) return false;
      if (record.applianceIdentity) return backupIdentity(record.applianceIdentity) === identity;
      const recordAddress = backupIdentity(record.requestedAddress || record.address);
      // Older mock captures share a loopback destination; only their appliance name identifies them.
      const sharedMockAddress = mocked && !record.requestedAddress && ['127.0.0.1', 'localhost', '::1'].includes(recordAddress);
      let candidates = sharedMockAddress ? [] : owners.filter((owner) => owner.aliases.includes(recordAddress));
      const named = owners.filter((owner) => owner.names.includes(backupIdentity(record.appliance)));
      if (!candidates.length) candidates = named;
      else if (named.length) candidates = candidates.filter((owner) => named.includes(owner));
      return candidates.length === 1 && candidates[0].id === identity;
    },
  };
}
