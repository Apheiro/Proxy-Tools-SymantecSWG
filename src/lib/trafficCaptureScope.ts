import {
  getProxyPrimaryAddress,
  knownProxyValue,
} from './proxyIdentity';

export type TrafficCaptureScope = {
  proxyIdentity: string;
  profile: 'live' | 'mock';
};

const identity = (value?: string) =>
  knownProxyValue(value)?.toLowerCase() ?? '';

/** Resolve an inventory alias to its registered address, never to a log source. */
export function trafficProxyIdentity(
  selected: string,
  inventory: Proxy[],
) {
  const target = identity(selected);
  if (!target) return '';
  const registered = inventory.filter(
    (proxy) => identity(proxy.registered_address) === target,
  );
  const matches = registered.length
    ? registered
    : inventory.filter((proxy) =>
        [
          getProxyPrimaryAddress(proxy) ?? '',
          proxy.hostname,
          proxy.hostinfo?.hostname,
          proxy.hostinfo?.ip,
        ].some((address) => identity(address) === target),
      );
  const identities = new Set(
    matches.map(
      (proxy) => identity(proxy.registered_address) || target,
    ),
  );
  // Ambiguous inventory aliases stay scoped to the explicitly selected target.
  return identities.size === 1 ? [...identities][0] : target;
}
