import { expect, test } from '@playwright/test';
import {
  adjacentPage,
  replacementForClose,
  shortcutAction,
  pageDomain,
  type EmbeddedPage,
} from '../../src/lib/embeddedBrowser';
const page = (
  id: string,
  groupId = id,
  parentId: string | null = null,
): EmbeddedPage => ({
  id,
  groupId,
  parentId,
  title: id,
  url: 'https://example.org/',
  loading: false,
  loaded: true,
});
const pages = [
  page('a'),
  page('b'),
  page('c', 'a', 'a'),
  page('d', 'a', 'c'),
  page('e'),
];
test('horizontal groups follow opening order, wrap and remember each group last active layer', () => {
  expect(adjacentPage(pages, 'd', 'next')).toBe('b');
  expect(adjacentPage(pages, 'b', 'previous', { a: 'c' })).toBe('c');
  expect(adjacentPage(pages, 'e', 'next')).toBe('a');
  expect(adjacentPage(pages, 'a', 'previous')).toBe('e');
  expect(adjacentPage(pages, 'b', 'previous', { a: 'closed' })).toBe(
    'a',
  );
});
test('vertical navigation traverses only related layers in opening order and wraps', () => {
  expect(adjacentPage(pages, 'a', 'down')).toBe('c');
  expect(adjacentPage(pages, 'c', 'down')).toBe('d');
  expect(adjacentPage(pages, 'a', 'up')).toBe('d');
  expect(adjacentPage(pages, 'd', 'down')).toBe('a');
  expect(adjacentPage(pages, 'b', 'down')).toBe('b');
});
test('closing one layer returns to its parent without removing unrelated pages', () => {
  expect(replacementForClose(pages, 'd')).toBe('c');
  expect(replacementForClose(pages, 'a')).toBe('c');
  expect(replacementForClose([page('a')], 'a')).toBeNull();
  expect(replacementForClose(pages, 'missing')).toBeNull();
});
test('empty/unknown pages are safe and ordinary caret shortcuts remain available outside the modal', () => {
  expect(adjacentPage([], 'a', 'next')).toBeNull();
  expect(adjacentPage(pages, 'missing', 'up')).toBeNull();
  expect(
    shortcutAction({
      key: 'ArrowRight',
      ctrlKey: true,
      altKey: false,
      metaKey: false,
    }),
  ).toBe('next');
  expect(
    shortcutAction({
      key: 'ArrowUp',
      ctrlKey: true,
      altKey: false,
      metaKey: false,
    }),
  ).toBe('up');
  expect(
    shortcutAction({
      key: 'ArrowRight',
      ctrlKey: false,
      altKey: false,
      metaKey: false,
    }),
  ).toBeNull();
  expect(
    shortcutAction({
      key: 'ArrowRight',
      ctrlKey: true,
      altKey: true,
      metaKey: false,
    }),
  ).toBeNull();
  expect(pageDomain('https://appliance.test:8082/path')).toBe(
    'appliance.test:8082',
  );
});
