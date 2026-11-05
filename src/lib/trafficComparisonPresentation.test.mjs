import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = ts
  .transpileModule(
    readFileSync(
      new URL('./trafficComparisonPresentation.ts', import.meta.url),
      'utf8',
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    },
  )
  .outputText.replaceAll(
    "'./trafficComparison'",
    JSON.stringify(
      new URL('./trafficComparison.ts', import.meta.url).href,
    ),
  )
  .replaceAll(
    "'./trafficAnalysis'",
    JSON.stringify(
      new URL('./trafficAnalysis.ts', import.meta.url).href,
    ),
  );
const { activityAxis, activityPoints, trafficDelta } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);
test('hourly bounds use chosen wall clock, daily/week labels use hours and weekdays', () => {
  const hour = activityAxis({
    mode: 'hourly',
    from: '09:00',
    to: '10:00',
  });
  assert.equal(hour.min, 540);
  assert.equal(hour.max, 600);
  assert.equal(hour.label(570), '09:30');
  assert.equal(activityAxis({ mode: 'daily' }).label(1440), '24:00');
  assert.equal(
    activityAxis({ mode: 'weekly' }).label(3 * 1440 + 540),
    'Thu 09:00',
  );
});
test('delta directions are neutral without baseline and never produce non-finite text', () => {
  assert.match(trafficDelta(12, 10, 'requests').tone, /emerald/);
  assert.match(trafficDelta(5, 10, 'bytes').tone, /rose/);
  assert.equal(
    trafficDelta(0, 0, 'requests').tone,
    'text-muted-foreground',
  );
  assert.equal(
    trafficDelta(10, 0, 'bytes').tone,
    'text-muted-foreground',
  );
  assert.doesNotMatch(
    trafficDelta(Infinity, 3, 'bytes').text,
    /NaN|Infinity/,
  );
});
test('DST repeated local times retain both UTC identities and break the curve', () => {
  const p = {
    timeline: ['2026-11-01T05:30:00Z', '2026-11-01T06:30:00Z'].map(
      (epoch) => ({
        epoch: Date.parse(epoch),
        requests: 3,
        bytes: 9,
      }),
    ),
  };
  const points = activityPoints(p, {
    mode: 'hourly',
    timeZone: 'America/New_York',
    metric: 'requests',
  });
  assert.equal(points.length, 3);
  assert.equal(points[1].value[1], null);
  assert.equal(points[0].value[0], 90);
  assert.equal(points[2].value[0], 90);
  assert.notEqual(points[0].observedAt, points[2].observedAt);
});
test('gaps remain absent, and spring-forward discontinuity is not connected', () => {
  const p = {
    timeline: ['2026-03-08T06:59:00Z', '2026-03-08T07:00:00Z'].map(
      (epoch) => ({
        epoch: Date.parse(epoch),
        requests: 1,
        bytes: 1,
      }),
    ),
  };
  const points = activityPoints(p, {
    mode: 'hourly',
    timeZone: 'America/New_York',
    metric: 'bytes',
  });
  assert.equal(points[1].value[1], null);
  assert.equal(points[2].value[0], 180);
});
