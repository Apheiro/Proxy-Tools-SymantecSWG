import {
  DEFAULT_SHORTCUTS,
  matchShortcut,
  type ShortcutMap,
} from './shortcutBindings';
/** Retained native page metadata. No document contents or credentials are stored here. */
export type EmbeddedPage = {
  id: string;
  url: string;
  sourceUrl?: string;
  title: string;
  parentId: string | null;
  groupId: string;
  loading: boolean;
  loaded: boolean;
};
export type EmbeddedSnapshot = {
  revision: number;
  pages: EmbeddedPage[];
};
export type EmbeddedAction =
  | 'previous'
  | 'next'
  | 'up'
  | 'down'
  | 'minimize';
export type EmbeddedOpenOptions = {
  url: string;
  title: string;
  authentication?: {
    username: string;
    password: string;
    acceptInvalidCertificates?: boolean;
  };
};
export type EmbeddedTransition =
  | 'open'
  | 'restore'
  | 'left'
  | 'right'
  | 'child';
export function pageDomain(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return 'Page';
  }
}
/** Horizontal navigation changes groups; vertical navigation changes related popup layers. */
export function adjacentPage(
  pages: EmbeddedPage[],
  activeId: string,
  action: EmbeddedAction,
  lastActive: Record<string, string> = {},
) {
  const current = pages.find((p) => p.id === activeId);
  if (!current || action === 'minimize') return null;
  const step = action === 'previous' || action === 'up' ? -1 : 1;
  if (action === 'up' || action === 'down') {
    const group = pages.filter((p) => p.groupId === current.groupId);
    return (
      group[
        (group.findIndex((p) => p.id === activeId) +
          step +
          group.length) %
          group.length
      ]?.id ?? null
    );
  }
  const groups = [...new Set(pages.map((p) => p.groupId))];
  const target =
    groups[
      (groups.indexOf(current.groupId) + step + groups.length) %
        groups.length
    ];
  const remembered = pages.find(
    (p) => p.groupId === target && p.id === lastActive[target],
  );
  return (
    remembered?.id ??
    pages.find((p) => p.groupId === target)?.id ??
    null
  );
}
export function replacementForClose(
  pages: EmbeddedPage[],
  id: string,
) {
  const current = pages.find((p) => p.id === id);
  if (!current) return null;
  const others = pages.filter((p) => p.id !== id);
  return (
    others.find((p) => p.id === current.parentId)?.id ??
    others.find((p) => p.groupId === current.groupId)?.id ??
    others[
      Math.min(
        pages.findIndex((p) => p.id === id),
        others.length - 1,
      )
    ]?.id ??
    null
  );
}
export function shortcutAction(
  event: Pick<
    KeyboardEvent,
    'key' | 'ctrlKey' | 'altKey' | 'metaKey'
  > & { shiftKey?: boolean },
  bindings: ShortcutMap = DEFAULT_SHORTCUTS,
) {
  return matchShortcut(event, bindings);
}
