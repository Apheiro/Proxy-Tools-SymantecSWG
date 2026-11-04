import type { PacSource } from './pac';
import { normalizeProxyTags } from './proxyTags';

export const PAC_GROUPING_KEY = 'pac-file-grouping';
export type PacFileGrouping = {
  groupBy: 'none' | 'tags';
  tag: string;
};

export function pacFileTags(sources: PacSource[]) {
  return normalizeProxyTags(
    sources.flatMap((source) => normalizeProxyTags(source.tags)),
  ).sort((a, b) => a.localeCompare(b, 'en'));
}

export function groupPacFiles(
  sources: PacSource[],
  grouping: PacFileGrouping,
) {
  if (grouping.groupBy === 'none')
    return [{ key: '', label: '', sources }];
  const collator = new Intl.Collator('en', {
    numeric: true,
    sensitivity: 'base',
  });
  const sorted = [...sources].sort((a, b) =>
    collator.compare(a.name, b.name),
  );
  const groups = pacFileTags(sources).map((tag) => ({
    key: `tag:${tag}`,
    label: tag,
    sources: sorted.filter((source) =>
      normalizeProxyTags(source.tags).some(
        (value) =>
          value.toLocaleLowerCase() === tag.toLocaleLowerCase(),
      ),
    ),
  }));
  const untagged = sorted.filter(
    (source) => !normalizeProxyTags(source.tags).length,
  );
  if (untagged.length)
    groups.unshift({
      key: 'untagged',
      label: 'Untagged',
      sources: untagged,
    });
  return grouping.tag
    ? groups.filter((group) => group.key === grouping.tag)
    : groups;
}
