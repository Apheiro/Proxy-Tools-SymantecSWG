import { expect, test } from '@playwright/test';
import {
  traceEntry,
  traceRelations,
} from '../../src/lib/policyTrace';
import {
  groupTraceFlows,
  traceDisplayRows,
} from '../../src/lib/traceFlows';
import { traceLog } from '../fixtures/policyTrace';

const entry = (id: string, parent?: string, second = 0) =>
  traceEntry(
    traceLog(id, {
      parent,
      time: `2026-08-02T15:51:${String(second).padStart(2, '0')}Z`,
    }),
    `RAW-${id}`,
  );

test('flows and their transactions use newest activity first while preserving relationships', () => {
  const root = entry('1', undefined, 10);
  const child = entry('2', '1', 5);
  const sibling = entry('3', '1', 7);
  const grandchild = entry('4', '2', 6);
  const independent = entry('5', undefined, 20);
  const entries = [grandchild, independent, sibling, child, root];
  const flows = groupTraceFlows(entries, traceRelations(entries));
  expect(flows).toHaveLength(2);
  expect(
    flows[0].entries.map(({ entry }) => entry.log.transaction.id),
  ).toEqual(['5']);
  expect(
    flows[1].entries.map(({ entry }) => entry.log.transaction.id),
  ).toEqual(['1', '3', '4', '2']);
  expect(flows[1].entries.map(({ depth }) => depth)).toEqual([
    0, 1, 2, 1,
  ]);
  expect(flows[1].first?.time).toBe('15:51:05');
  expect(flows[1].last?.time).toBe('15:51:10');
  expect(flows[1].counts.allowed).toBe(4);
});

test('matching destinations and timestamps never group unrelated records', () => {
  const entries = [entry('1'), entry('2'), entry('3')];
  expect(
    groupTraceFlows(entries, traceRelations(entries)),
  ).toHaveLength(3);
});

test('missing parents are marked as references and ambiguous parents never join flows', () => {
  const entries = [
    entry('1', '999'),
    entry('2', '999'),
    entry('3'),
    entry('3', undefined, 1),
    entry('4', '3'),
  ];
  const flows = groupTraceFlows(entries, traceRelations(entries));
  const missing = flows.find((flow) => flow.missingParent === '999')!;
  expect(missing.entries).toHaveLength(2);
  expect(
    missing.entries.some(
      ({ entry }) => entry.log.transaction.id === '999',
    ),
  ).toBe(false);
  expect(flows).toHaveLength(4);
  expect(
    flows.find((flow) => flow.anchor.log.transaction.id === '4')
      ?.issue,
  ).toBe('Ambiguous or self reference');
});

test('cycles and deep chains terminate without recursion or duplicate members', () => {
  const cyclic = [entry('1', '2'), entry('2', '1'), entry('3', '2')];
  const flows = groupTraceFlows(cyclic, traceRelations(cyclic));
  expect(flows).toHaveLength(1);
  expect(flows[0].issue).toContain('Cyclic');
  expect(
    new Set(flows[0].entries.map(({ entry }) => entry.key)).size,
  ).toBe(3);
  const deep = Array.from({ length: 10000 }, (_, index) =>
    entry(String(index), index ? String(index - 1) : undefined),
  ).reverse();
  const chain = groupTraceFlows(deep, traceRelations(deep));
  expect(chain).toHaveLength(1);
  expect(chain[0].entries).toHaveLength(10000);
  expect(chain[0].entries[0].depth).toBe(9999);
  expect(chain[0].entries.at(-1)?.depth).toBe(0);
});

test('equal timestamps show the last processing stage first and missing dates stay at the end', () => {
  const root = entry('1');
  const child = entry('2', '1');
  const last = entry('3', '2');
  const missing = traceEntry(
    traceLog('4', { parent: '3', time: null }),
    'RAW-4',
  );
  const entries = [root, child, last, missing];
  const [flow] = groupTraceFlows(entries, traceRelations(entries));
  expect(
    flow.entries.map(({ entry }) => entry.log.transaction.id),
  ).toEqual(['3', '2', '1', '4']);
});

test('filters keep full correlation and collapsing removes member rows from the virtual list', () => {
  const entries = [entry('1'), entry('2', '1'), entry('3', '2')];
  const flows = groupTraceFlows(entries, traceRelations(entries));
  const filtered = traceDisplayRows(
    [entries[2]],
    flows,
    new Set(),
    'flow',
  );
  expect(filtered).toHaveLength(2);
  expect(filtered[0]).toMatchObject({
    kind: 'flow',
    shown: 1,
    expanded: true,
  });
  expect(filtered[1]).toMatchObject({
    kind: 'transaction',
    depth: 2,
  });
  expect(
    traceDisplayRows(entries, flows, new Set([flows[0].key]), 'flow'),
  ).toHaveLength(1);
  expect(
    traceDisplayRows(entries, flows, new Set([flows[0].key]), 'none'),
  ).toHaveLength(3);
});
