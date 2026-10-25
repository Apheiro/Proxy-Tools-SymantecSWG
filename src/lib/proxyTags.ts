export const PROXY_GROUPING_KEY = 'proxy-inventory-grouping';

export type ProxyGrouping = { groupBy: 'none' | 'tags'; tag: string };

export function inventoryProxyId(proxy: Proxy) {
  return (
    proxy.registered_address ||
    proxy.primary_address ||
    proxy.hostname
  );
}

export function normalizeProxyTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const unique = new Map<string, string>();
  for (const value of tags) {
    if (typeof value !== 'string') continue;
    const tag = value.trim().replace(/\s+/g, ' ');
    if (tag && !unique.has(tag.toLocaleLowerCase()))
      unique.set(tag.toLocaleLowerCase(), tag);
  }
  return [...unique.values()];
}

export function inventoryTags(proxies: Proxy[]) {
  return normalizeProxyTags(
    proxies.flatMap((proxy) => normalizeProxyTags(proxy.tags)),
  ).sort((a, b) => a.localeCompare(b));
}

export function groupProxies(
  proxies: Proxy[],
  grouping: ProxyGrouping,
) {
  if (grouping.groupBy === 'none')
    return [{ key: '', label: '', proxies }];
  const groups = inventoryTags(proxies).map((tag) => ({
    key: `tag:${tag}`,
    label: tag,
    proxies: proxies.filter((proxy) =>
      normalizeProxyTags(proxy.tags).some(
        (value) =>
          value.toLocaleLowerCase() === tag.toLocaleLowerCase(),
      ),
    ),
  }));
  const untagged = proxies.filter(
    (proxy) => !normalizeProxyTags(proxy.tags).length,
  );
  if (untagged.length)
    groups.unshift({
      key: 'untagged',
      label: 'Untagged',
      proxies: untagged,
    });
  return grouping.tag
    ? groups.filter((group) => group.key === grouping.tag)
    : groups;
}
