'use client';
import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  comparisonCoverage,
  comparisonNumber as num,
  comparisonRate,
  type ComparisonPeriod,
  type ComparisonSnapshot,
} from '@/lib/trafficComparison';
import {
  periodColor,
  trafficDelta,
} from '@/lib/trafficComparisonPresentation';
import { formatBytes } from '@/lib/trafficAnalysis';
import type { ReportMetric } from '@/lib/trafficReport';
export function TrafficDelta({
  value,
  before,
  metric,
}: {
  value: number;
  before: number;
  metric: ReportMetric;
}) {
  const delta = trafficDelta(value, before, metric);
  return <span className={delta.tone}>{delta.text}</span>;
}
export function PeriodCoverage({
  period: p,
  time,
}: {
  period: ComparisonPeriod;
  time: (n: number) => string;
}) {
  const coverage = comparisonCoverage(p);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type='button'
          className='shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground'
          aria-label={`${p.label}: observed interval ${num(coverage)} percent; coverage details`}
        >
          ●{' '}
          {coverage < 99.9 ? 'Partial coverage' : 'Observed interval'}
        </button>
      </PopoverTrigger>
      <PopoverContent className='w-80 space-y-2 text-xs'>
        <p className='font-medium'>
          Estimated span from observed events
        </p>
        <p>
          Requested:{' '}
          {p.ranges
            .map(
              (r) => `${time(r.start)} – ${time(r.end)} (exclusive)`,
            )
            .join('; ')}
        </p>
        <p>
          Observed: {time(p.first)} – {time(p.last)}
        </p>
        <p>
          {num(coverage)}% of requested time between observed
          extremes; {p.activeMinutes} occupied minute buckets.
        </p>
        {(p.maxEventGapMs ?? 0) > 60000 && (
          <p>
            Possible discontinuity: largest separation between
            occupied minute buckets is {num(p.maxEventGapMs! / 60000)}{' '}
            minutes.
          </p>
        )}
        <p className='text-muted-foreground'>
          Events do not certify log ingestion. Gaps may be inactivity
          or missing logs; endpoints do not establish continuity.
        </p>
      </PopoverContent>
    </Popover>
  );
}
export default function ComparisonPeriods({
  snapshot,
  time,
}: {
  snapshot: ComparisonSnapshot;
  time: (n: number) => string;
}) {
  const [view, setView] = useState<'cards' | 'table'>('cards');
  const [page, setPage] = useState(0);
  const periods = snapshot.result.periods;
  const totalPages = Math.ceil(periods.length / 4);
  const current = Math.min(page, Math.max(0, totalPages - 1));
  const rate = (p: ComparisonPeriod) => {
    const n = comparisonRate(p, snapshot.metric);
    return n === null
      ? 'Unavailable'
      : `${snapshot.metric === 'bytes' ? formatBytes(n * 60) : num(n * 60)} / min`;
  };
  return (
    <section
      className='min-w-0 space-y-3'
      aria-label='Period summaries'
    >
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div>
          <h2 className='text-sm font-semibold'>Period summaries</h2>
          <p className='text-xs text-muted-foreground'>
            All {periods.length} periods remain in charts and exports.
            Colors indicate periods; increases are not a quality
            assessment.
          </p>
        </div>
        <div className='flex gap-1 rounded-lg border p-1'>
          {(['cards', 'table'] as const).map((v) => (
            <Button
              key={v}
              size='sm'
              variant={view === v ? 'secondary' : 'ghost'}
              aria-pressed={view === v}
              onClick={() => setView(v)}
            >
              {v === 'cards' ? 'Cards' : 'All periods table'}
            </Button>
          ))}
        </div>
      </div>
      {view === 'cards' ? (
        <>
          <div className='grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4'>
            {periods
              .slice(current * 4, current * 4 + 4)
              .map((p, index) => {
                const i = current * 4 + index;
                return (
                  <Card key={p.id} className='min-w-0 gap-2 p-3'>
                    <div className='flex flex-wrap items-center gap-2'>
                      <span
                        aria-hidden
                        style={{ backgroundColor: periodColor(i) }}
                        className='size-2 shrink-0 rounded-full'
                      />
                      <h3 className='text-xs font-medium'>
                        {p.label}
                      </h3>
                      <PeriodCoverage period={p} time={time} />
                    </div>
                    <p className='text-xl font-semibold tabular-nums'>
                      {snapshot.metric === 'bytes'
                        ? formatBytes(p.bytes)
                        : num(p.requests)}{' '}
                      <span className='text-xs font-normal text-muted-foreground'>
                        {snapshot.metric}
                      </span>
                    </p>
                    <p className='text-xs text-muted-foreground'>
                      {num(p.requests)} requests ·{' '}
                      {formatBytes(p.bytes)}
                    </p>
                    <p
                      className='text-xs'
                      title='Traffic increase/decrease, not a good/bad outcome. Totals may have different observed coverage.'
                    >
                      {i > 0 ? (
                        <>
                          <TrafficDelta
                            value={p[snapshot.metric]}
                            before={periods[i - 1][snapshot.metric]}
                            metric={snapshot.metric}
                          />
                          <span className='text-muted-foreground'>
                            {' '}
                            vs previous observed period
                          </span>
                        </>
                      ) : (
                        <span className='text-muted-foreground'>
                          First observed period · baseline
                        </span>
                      )}
                    </p>
                    <div className='space-y-1 border-t pt-2 text-xs text-muted-foreground'>
                      <p>{rate(p)} · observed span</p>
                      <p>
                        {p.clients} clients · {p.hosts} destinations
                      </p>
                      <p>
                        {p.activeMinutes} active minutes ·{' '}
                        {
                          new Set(
                            p.timeline.map((b) =>
                              new Intl.DateTimeFormat('en-CA', {
                                timeZone: snapshot.timeZone,
                                dateStyle: 'short',
                              }).format(b.epoch),
                            ),
                          ).size
                        }{' '}
                        observed days
                        {snapshot.mode === 'weekly' ? ' / 7' : ''}
                      </p>
                    </div>
                  </Card>
                );
              })}
          </div>
          <nav
            aria-label='Period card pages'
            className='flex items-center justify-end gap-2'
          >
            <span
              className='mr-auto text-xs text-muted-foreground'
              aria-live='polite'
            >
              Periods {current * 4 + 1}–
              {Math.min((current + 1) * 4, periods.length)} of{' '}
              {periods.length}
            </span>
            <Button
              size='icon'
              variant='outline'
              aria-label='Previous period page'
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
            >
              <ChevronLeft />
            </Button>
            <span className='text-xs tabular-nums'>
              {current + 1} / {totalPages}
            </span>
            <Button
              size='icon'
              variant='outline'
              aria-label='Next period page'
              disabled={current >= totalPages - 1}
              onClick={() => setPage(current + 1)}
            >
              <ChevronRight />
            </Button>
          </nav>
        </>
      ) : (
        <div
          role='region'
          aria-label='All period summary data'
          tabIndex={0}
          className='max-h-[32rem] min-w-0 overflow-auto rounded-lg border'
        >
          <table className='w-full whitespace-nowrap text-left text-xs'>
            <thead className='sticky top-0 z-10 bg-card'>
              <tr>
                {[
                  'Period',
                  'Requests',
                  'Bytes',
                  'Change vs previous',
                  'Observed rate',
                  'Clients',
                  'Destinations',
                  'HTTP 4xx / 5xx',
                  'Policy denials',
                  'Issues / parse failures',
                  'Active minutes',
                  'Observed interval',
                  'Coverage',
                ].map((label) => (
                  <th key={label} className='p-3 font-medium'>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {periods.map((p, i) => (
                <tr key={p.id} className='border-t'>
                  <th className='p-3 font-medium'>{p.label}</th>
                  <td className='p-3'>{num(p.requests)}</td>
                  <td className='p-3'>{formatBytes(p.bytes)}</td>
                  <td className='p-3'>
                    {i ? (
                      <TrafficDelta
                        value={p[snapshot.metric]}
                        before={periods[i - 1][snapshot.metric]}
                        metric={snapshot.metric}
                      />
                    ) : (
                      'Baseline'
                    )}
                  </td>
                  <td className='p-3'>{rate(p)}</td>
                  <td className='p-3'>{p.clients}</td>
                  <td className='p-3'>{p.hosts}</td>
                  <td className='p-3'>
                    {p.http4xx} / {p.http5xx}
                  </td>
                  <td className='p-3'>{p.denied}</td>
                  <td className='p-3'>
                    {p.issues} / {p.parseFailures ?? 'N/A'}
                  </td>
                  <td className='p-3'>{p.activeMinutes}</td>
                  <td className='p-3'>
                    {time(p.first)} – {time(p.last)}
                  </td>
                  <td className='p-3'>
                    <PeriodCoverage period={p} time={time} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
