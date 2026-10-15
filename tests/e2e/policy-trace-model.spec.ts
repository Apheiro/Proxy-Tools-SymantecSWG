import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import {
  mergeTraceEntries,
  policyLineVerdict,
  traceEntry,
  traceOutcome,
  traceRelations,
  traceTime,
} from '../../src/lib/policyTrace';
import { traceLog } from '../fixtures/policyTrace';

for (const type of [
  'http.proxy',
  'tcp.tunnel',
  'ssl.tunnel',
  'https.forward-proxy',
  'unknown.processing',
]) {
  test(`${type}: absent checkpoints never override the reported verdict`, () => {
    expect(
      traceOutcome(
        traceLog('1', {
          type,
          verdict: 'ALLOWED (handed off)',
          checkpoints: {},
        }),
      ),
    ).toMatchObject({
      verdict: 'allowed',
      source: 'reported',
      evidence: 'ALLOWED (handed off)',
    });
    expect(
      traceOutcome(
        traceLog('1', { type, verdict: null, checkpoints: {} }),
      ).verdict,
    ).toBe('unknown');
    expect(
      traceOutcome(
        traceLog('1', {
          type,
          verdict:
            'EXCEPTION(authentication_failed): invalid credentials',
          matches: ['ALLOW'],
        }),
      ).verdict,
    ).toBe('exception');
    expect(
      traceOutcome(
        traceLog('1', {
          type,
          verdict: 'DENIED',
          matches: ['ALLOW'],
        }),
      ).verdict,
    ).toBe('rejected');
  });
}

test('only explicit matching actions are evidence when a final verdict is absent', () => {
  expect(
    traceOutcome(
      traceLog('1', {
        verdict: 'ALLOWED (without EXCEPTION(tcp_error))',
      }),
    ).verdict,
  ).toBe('allowed');
  for (const line of [
    'miss: DENY',
    'n/a: ALLOW',
    'late: EXCEPTION(tcp_error)',
    'condition=ALLOW_List',
    'url.path="ALLOW DENY EXCEPTION(test)"',
    'exception=none',
  ])
    expect(policyLineVerdict(line)).toBe('unknown');
  expect(
    traceOutcome(
      traceLog('1', {
        verdict: null,
        matches: ['miss: DENY', 'MATCH: ALLOW'],
      }),
    ),
  ).toMatchObject({
    verdict: 'allowed',
    source: 'matched',
    label: 'Matched allow',
  });
  expect(
    traceOutcome(
      traceLog('1', { verdict: 'UNRECOGNIZED', matches: ['ALLOW'] }),
    ),
  ).toMatchObject({
    verdict: 'unknown',
    source: 'reported',
    evidence: 'UNRECOGNIZED',
  });
});

test('timestamps retain UTC, support offsets and reject missing/invalid dates', () => {
  const expected = Date.UTC(2026, 7, 2, 15, 51, 32);
  expect(traceTime('2026-08-02 15:51:32 UTC')).toEqual({
    epoch: expected,
    date: '02 Aug 2026',
    time: '15:51:32',
    zone: 'UTC',
  });
  expect(traceTime('2026-08-02T12:51:32-03:00').epoch).toBe(expected);
  for (const value of [
    null,
    '',
    'bad timestamp',
    '2026-02-30 12:00:00 UTC',
    '2026-08-02 15:51:32 UTC\nuser: unauthenticated',
  ])
    expect(traceTime(value).epoch).toBeNull();
});

test('relationships require explicit unambiguous IDs, never proximity or URL', () => {
  const parent = traceEntry(traceLog('123'), 'parent raw');
  const child = traceEntry(
    traceLog('1234', { parent: '123', type: 'ssl.tunnel' }),
    'child raw',
  );
  const unrelated = traceEntry(traceLog('125'), 'unrelated raw');
  const missing = traceEntry(
    traceLog('126', { parent: '122' }),
    'missing raw',
  );
  const relations = traceRelations([
    parent,
    child,
    unrelated,
    missing,
  ]);
  expect(relations.parents.get(child.key)?.entry).toBe(parent);
  expect(relations.children.get(parent.key)?.[0].entry).toBe(child);
  expect(relations.parents.has(unrelated.key)).toBe(false);
  expect(relations.parents.get(missing.key)).toMatchObject({
    id: '122',
    note: 'Not in this capture',
  });
  const duplicate = traceEntry(
    traceLog('123', { time: '2026-08-02 15:51:30 UTC' }),
    'duplicate',
  );
  expect(
    traceRelations([parent, duplicate, child]).parents.get(child.key)
      ?.entry,
  ).toBeUndefined();
});

test('sorting and repeated batches keep the exact raw block with its record', () => {
  const a = traceEntry(
    traceLog('123', { time: '2026-08-02 15:51:30 UTC' }),
    'raw with transaction ID=1234 inside',
  );
  const b = traceEntry(traceLog('1234'), 'actual child raw');
  const merged = mergeTraceEntries([a], [b, a]);
  expect(merged.map((entry) => entry.log.transaction.id)).toEqual([
    '1234',
    '123',
  ]);
  expect(merged[0].raw).toBe('actual child raw');
  expect(merged[1].raw).toBe('raw with transaction ID=1234 inside');
});

test('optional local fixture preserves reported outcomes and valid timestamps', () => {
  const file = process.env.PROXYTOOLS_PARSED_TRACE_FIXTURE;
  test.skip(
    !file,
    'Set PROXYTOOLS_PARSED_TRACE_FIXTURE to the local parser export',
  );
  const logs = JSON.parse(
    readFileSync(file!, 'utf8'),
  ) as TransactionInfo[];
  expect(logs.length).toBeGreaterThan(0);
  let allowed = 0;
  let exceptions = 0;
  for (const log of logs) {
    expect(traceTime(log.connection.time).epoch).not.toBeNull();
    const outcome = traceOutcome(log);
    expect(outcome.source).toBe('reported');
    if (/^ALLOW/i.test(log.decision.verdict)) {
      expect(outcome.verdict).toBe('allowed');
      allowed++;
    }
    if (/^EXCEPTION/i.test(log.decision.verdict)) {
      expect(outcome.verdict).toBe('exception');
      exceptions++;
    }
  }
  console.log(
    `Local trace: ${logs.length} records, ${allowed} policy allowed, ${exceptions} exceptions; all timestamps valid`,
  );
});
