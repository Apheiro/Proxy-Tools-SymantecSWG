import { expect, test } from '@playwright/test';
import {
  mergeProxyCheck,
  normalizeProxyIdentity,
} from '../../src/lib/proxyIdentity';
function proxy(overrides: Partial<Proxy> = {}): Proxy {
  return {
    hostname: 'SWG',
    registered_address: 'swg.example.test',
    primary_address: '192.0.2.10',
    active: true,
    pinglog: '',
    nslookup: '',
    last_check: 'old',
    hostinfo: {
      hostname: 'swg.example.test',
      ip: '192.0.2.10',
      dnsname: 'unknown',
      dnsip: '192.0.2.53',
    },
    tags: ['Production'],
    ...overrides,
  };
}
function ipCheck(address = '192.0.2.10', active = true): Proxy {
  return proxy({
    hostname: address,
    registered_address: address,
    primary_address: address,
    active,
    last_check: 'new',
    pinglog: `Pinging ${address} [${address}] with 32 bytes of data:\n`,
    nslookup: `Resolution: ${address}\nName: unknown\nAddresses: ${address}\nPTR unavailable`,
    hostinfo: {
      hostname: 'unknown',
      ip: address,
      dnsname: 'unknown',
      dnsip: 'unknown',
    },
    tags: undefined,
  });
}
test('identity model: successful ICMP without PTR never overwrites a saved name', () => {
  const result = mergeProxyCheck(proxy(), ipCheck());
  expect(result.hostname).toBe('SWG');
  expect(result.hostinfo.hostname).toBe('swg.example.test');
  expect(result.registered_address).toBe('swg.example.test');
  expect(result.primary_address).toBe('192.0.2.10');
  expect(result.tags).toEqual(['Production']);
  expect(result.last_check).toBe('new');
  expect(result.active).toBe(true);
  expect(result.pinglog).toContain('192.0.2.10');
});
test('identity model: repeated failed checks preserve IPv4 and IPv6 identity', () => {
  for (const address of ['192.0.2.10', '2001:db8::10']) {
    let current = proxy({
      primary_address: address,
      hostinfo: { ...proxy().hostinfo, ip: address },
    });
    for (let i = 0; i < 8; i++)
      current = mergeProxyCheck(current, ipCheck(address, false));
    expect(current.hostname).toBe('SWG');
    expect(current.hostinfo.hostname).toBe('swg.example.test');
    expect(current.active).toBe(false);
  }
});
test('identity model: existing IP display is repaired using surviving identity fields or diagnostic evidence', () => {
  const lost = ipCheck();
  const entries = [
    {
      ...lost,
      hostinfo: { ...lost.hostinfo, hostname: 'saved.example.test' },
    },
    { ...lost, registered_address: 'saved.example.test' },
    {
      ...lost,
      pinglog:
        'Pinging saved.example.test [192.0.2.10] with 32 bytes of data:',
    },
    {
      ...lost,
      nslookup:
        'Server: dns.example.test\nName: saved.example.test\nAddress: 192.0.2.10',
    },
    {
      ...lost,
      nslookup:
        'Resolution: saved.example.test\nName: unknown\nAddresses: unknown',
    },
  ];
  for (const entry of entries) {
    const normalized = normalizeProxyIdentity(entry);
    expect(normalized.hostname).toBe('saved.example.test');
    expect(normalized.primary_address).toBe('192.0.2.10');
  }
});
test('identity model: IP-only inventory is not renamed after the DNS server', () => {
  const entry = ipCheck('2001:db8::10');
  entry.nslookup =
    'Server: resolver.example.test\nAddress: 192.0.2.53\nName: unknown';
  const normalized = normalizeProxyIdentity(entry);
  expect(normalized.hostname).toBe('2001:db8::10');
  expect(normalized.hostinfo.hostname).toBe('unknown');
  expect(normalized.registered_address).toBe('2001:db8::10');
});
test('identity model: fresh real PTR names can still update the observations', () => {
  const check = ipCheck();
  check.hostname = 'NEW';
  check.hostinfo.hostname = 'new.example.test';
  const result = mergeProxyCheck(proxy(), check);
  expect(result.hostname).toBe('NEW');
  expect(result.hostinfo.hostname).toBe('new.example.test');
  expect(result.registered_address).toBe('swg.example.test');
});
test('identity model: resolution failure does not discard known address or mutate the saved entry', () => {
  const previous = proxy();
  const original = structuredClone(previous);
  const check = ipCheck();
  check.hostname = 'unknown';
  check.primary_address = undefined;
  check.hostinfo.ip = 'unknown';
  const result = mergeProxyCheck(previous, check);
  expect(result.hostname).toBe('SWG');
  expect(result.hostinfo.ip).toBe('192.0.2.10');
  expect(result.primary_address).toBe('192.0.2.10');
  expect(previous).toEqual(original);
  expect(
    normalizeProxyIdentity(normalizeProxyIdentity(result)),
  ).toEqual(normalizeProxyIdentity(result));
});

test('identity model: legacy IPv6 DNS errors cannot be mistaken for a numeric hostname', () => {
  const entry = ipCheck('2001:db8::10');
  entry.nslookup =
    "DNS server can't find 2001:db8::10: Non-existent domain";
  expect(normalizeProxyIdentity(entry).hostname).toBe('2001:db8::10');
  expect(normalizeProxyIdentity(entry).hostinfo.hostname).toBe(
    'unknown',
  );
});
