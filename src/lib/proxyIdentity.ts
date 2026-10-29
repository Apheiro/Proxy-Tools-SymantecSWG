/** Pure inventory identity handling. Persistent storage remains localStorage["proxies"]. */
export function knownProxyValue(value?: string) {
  const normalized = value?.trim();
  const normalizedLowercase = normalized?.toLowerCase();
  return normalized &&
    normalizedLowercase !== 'unknown' &&
    normalizedLowercase !== 'unkown'
    ? normalized
    : undefined;
}

export function isIpAddress(value?: string) {
  if (!value || value.trim() !== value || /\s/.test(value))
    return false;
  if (value.includes(':')) {
    try {
      return new URL(`http://[${value}]/`).hostname.length > 0;
    } catch {
      return false;
    }
  }
  const octets = value.split('.');
  return (
    octets.length === 4 &&
    octets.every(
      (octet) =>
        /^\d{1,3}$/.test(octet) &&
        Number(octet) >= 0 &&
        Number(octet) <= 255,
    )
  );
}

function hostnameValue(value?: string) {
  const known = knownProxyValue(value);
  return known && !isIpAddress(known) ? known : undefined;
}
function getLoggedHostname(proxy: Proxy) {
  const pingTarget = proxy.pinglog?.match(
    /Pinging\s+([^\s[]+)(?:\s+\[([^\]]+)\])?/i,
  )?.[1];
  const dnsName = proxy.nslookup?.match(
    /^\s*Name:\s*([^\s]+)\s*$/im,
  )?.[1];
  const resolution = proxy.nslookup?.match(
    /^\s*Resolution:\s*([^\s]+)\s*$/im,
  )?.[1];
  const dnsQuery = proxy.nslookup
    ?.match(/can't find\s+(\S+)/i)?.[1]
    ?.replace(/:$/, '');
  return [pingTarget, dnsName, resolution, dnsQuery]
    .map(hostnameValue)
    .find(Boolean);
}
/** An IP fallback is connectivity information, never evidence that a known name disappeared. */
export function knownProxyHostname(proxy: Proxy) {
  return (
    hostnameValue(proxy.hostname) ??
    hostnameValue(proxy.hostinfo?.hostname) ??
    hostnameValue(proxy.registered_address) ??
    getLoggedHostname(proxy)
  );
}

export function getProxyPrimaryAddress(proxy: Proxy) {
  const primaryAddress = knownProxyValue(proxy.primary_address);
  if (primaryAddress) return primaryAddress;

  const resolvedIp = knownProxyValue(proxy.hostinfo?.ip);
  if (isIpAddress(resolvedIp)) return resolvedIp;

  const registeredAddress = knownProxyValue(proxy.registered_address);
  if (registeredAddress) return registeredAddress;

  const hostname = knownProxyValue(proxy.hostname);
  if (hostname) return hostname;

  const pingTarget = proxy.pinglog?.match(
    /Pinging\s+([^\s[]+)(?:\s+\[([^\]]+)\])?/i,
  );
  if (isIpAddress(pingTarget?.[2])) return pingTarget?.[2];
  if (knownProxyValue(pingTarget?.[1])) return pingTarget?.[1];

  const dnsQuery = proxy.nslookup
    ?.match(/can't find\s+(\S+)/i)?.[1]
    ?.replace(/:$/, '');
  return knownProxyValue(dnsQuery) ?? null;
}

export function normalizeProxyIdentity(proxy: Proxy): Proxy {
  const recoveredHostname = knownProxyHostname(proxy);
  const primaryAddress = getProxyPrimaryAddress(proxy);
  return {
    ...proxy,
    registered_address:
      knownProxyValue(proxy.registered_address) ??
      recoveredHostname ??
      primaryAddress ??
      undefined,
    primary_address: primaryAddress ?? proxy.primary_address,
    hostname: recoveredHostname ?? proxy.hostname,
    hostinfo: {
      ...proxy.hostinfo,
      hostname:
        hostnameValue(proxy.hostinfo?.hostname) ??
        hostnameValue(proxy.registered_address) ??
        recoveredHostname ??
        'unknown',
      ip:
        knownProxyValue(proxy.hostinfo?.ip) ??
        (isIpAddress(primaryAddress) ? primaryAddress! : 'unknown'),
    },
  };
}
export function mergeProxyCheck(
  previous: Proxy,
  check: Proxy,
): Proxy {
  const keepKnown = (latest?: string, saved?: string) =>
    knownProxyValue(latest) ?? knownProxyValue(saved) ?? 'unknown';
  const saved = normalizeProxyIdentity(previous);
  const checkedPrimary = knownProxyValue(check.primary_address);
  return {
    ...saved,
    ...check,
    // Tags and registered identity belong to the inventory, not the network response.
    tags: saved.tags,
    isg_appliance: saved.isg_appliance,
    hostname:
      knownProxyHostname(check) ??
      knownProxyHostname(saved) ??
      keepKnown(check.hostname, saved.hostname),
    registered_address:
      knownProxyValue(saved.registered_address) ??
      knownProxyValue(check.registered_address) ??
      saved.hostname,
    primary_address:
      checkedPrimary ?? getProxyPrimaryAddress(saved) ?? undefined,
    hostinfo: {
      ...saved.hostinfo,
      ...check.hostinfo,
      hostname:
        hostnameValue(check.hostinfo?.hostname) ??
        hostnameValue(saved.hostinfo?.hostname) ??
        knownProxyHostname(check) ??
        knownProxyHostname(saved) ??
        'unknown',
      ip: keepKnown(check.hostinfo?.ip, saved.hostinfo?.ip),
      dnsname: keepKnown(
        check.hostinfo?.dnsname,
        saved.hostinfo?.dnsname,
      ),
      dnsip: keepKnown(check.hostinfo?.dnsip, saved.hostinfo?.dnsip),
    },
  };
}
