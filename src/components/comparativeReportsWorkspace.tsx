'use client';

import { invoke, isTauri } from '@tauri-apps/api/core';
import {
  ArrowLeft,
  ChartNoAxesCombined,
  Download,
  Loader2,
  RefreshCw,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import PageHeader from '@/components/pageHeader';
import { TimeZonePicker } from '@/components/ui/time-zone-picker';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DatePicker } from '@/components/ui/date-time-picker';
import CompactTimePicker from '@/components/compactTimePicker';
import ComparisonActivity from '@/components/comparisonActivity';
import { useComparisonZoomSlider } from '@/components/comparisonChartZoom';
import ComparisonPeriods, {
  TrafficDelta,
} from '@/components/comparisonPeriods';
import { periodColor } from '@/lib/trafficComparisonPresentation';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { formatBytes } from '@/lib/trafficAnalysis';
import type { CaptureArchive } from '@/lib/trafficCapture';
import {
  trafficProxyIdentity,
  type TrafficCaptureScope,
} from '@/lib/trafficCaptureScope';
import { buildComparisonPeriods } from '@/lib/trafficComparisonTime';
import {
  COMPARISON_NOTE,
  comparisonCsv,
  comparisonNumber as num,
  comparisonRate,
  type ComparisonEntry,
  type ComparisonPeriod,
  type ComparisonResult,
  type ComparisonSnapshot,
  type ComparisonSource,
} from '@/lib/trafficComparison';
import type { ReportMetric } from '@/lib/trafficReport';
import useDataSourceMode from '@/lib/useDataSourceMode';

const Chart = dynamic(() => import('echarts-for-react'), {
  ssr: false,
});
const INPUT =
  'h-9 rounded-md border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const COLORS = [
  '#3b82f6',
  '#14b8a6',
  '#a855f7',
  '#f59e0b',
  '#ef4444',
  '#06b6d4',
  '#ec4899',
  '#84cc16',
];
const FIELDS: Record<string, string> = {
  host: 'Destinations',
  client: 'Clients',
  category: 'Categories',
  action: 'Actions',
  status: 'HTTP status',
  application: 'Applications',
  user: 'Users',
};
type Discovery = {
  utcMinutes: number[];
  sources: ComparisonSource[];
};
const metricValue = (value: number, metric: ReportMetric) =>
  metric === 'bytes' ? formatBytes(value) : num(value);
const download = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
};

export default function ComparativeReportsWorkspace({
  proxy,
}: {
  proxy: string;
}) {
  const { mode, ready } = useDataSourceMode();
  const [identity, setIdentity] = useState<{
    target: string;
    value: string;
  } | null>(null);
  useEffect(() => {
    const read = () => {
      let inventory: Proxy[] = [];
      try {
        const stored = JSON.parse(
          localStorage.getItem('proxies') ?? '[]',
        );
        if (Array.isArray(stored))
          inventory = stored.filter(
            (item) => item && typeof item === 'object',
          );
      } catch {
        /* Explicit target is a safe fallback. */
      }
      setIdentity({
        target: proxy,
        value: trafficProxyIdentity(proxy, inventory),
      });
    };
    read();
    window.addEventListener('storage', read);
    window.addEventListener('focus', read);
    return () => {
      window.removeEventListener('storage', read);
      window.removeEventListener('focus', read);
    };
  }, [proxy]);
  const scope = useMemo(
    () => ({ proxyIdentity: identity?.value ?? '', profile: mode }),
    [identity?.value, mode],
  );
  if (!ready || identity?.target !== proxy)
    return (
      <main className='p-8 text-muted-foreground'>
        Loading capture context…
      </main>
    );
  return (
    <Workspace
      key={JSON.stringify(scope)}
      proxy={proxy}
      scope={scope}
    />
  );
}

function Workspace({
  proxy,
  scope,
}: {
  proxy: string;
  scope: TrafficCaptureScope;
}) {
  const [archives, setArchives] = useState<CaptureArchive[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [unassigned, setUnassigned] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [mode, setMode] = useState<'hourly' | 'daily' | 'weekly'>(
    'daily',
  );
  const [from, setFrom] = useState('09:00');
  const [to, setTo] = useState('10:00');
  const zoneKey = `comparative-reports:timezone:${scope.profile}:${scope.proxyIdentity}`;
  const [timeZone, setTimeZone] = useState(() => {
    try {
      const stored = localStorage.getItem(zoneKey);
      if (stored) {
        new Intl.DateTimeFormat('en', { timeZone: stored });
        return stored;
      }
    } catch {
      /* Use the system preference if storage is unavailable. */
    }
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  });
  const [captureSearch, setCaptureSearch] = useState('');
  const [dateOpen, setDateOpen] = useState(false);
  const [rankingPage, setRankingPage] = useState({
    key: '',
    page: 0,
  });
  const zoomSlider = useComparisonZoomSlider();
  useEffect(() => {
    try {
      localStorage.setItem(zoneKey, timeZone);
    } catch {
      /* Optional local preference. */
    }
  }, [zoneKey, timeZone]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [metric, setMetric] = useState<ReportMetric>('requests');
  const [topN, setTopN] = useState(10);
  const [commonInterval, setCommonInterval] = useState(false);
  const [field, setField] = useState('host');
  const [rankingMode, setRankingMode] = useState<'period' | 'common'>(
    'period',
  );
  const [snapshot, setSnapshot] = useState<ComparisonSnapshot | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<string | null>(null);
  const generation = useRef(0);
  const automaticTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const configKey = JSON.stringify([
    selected,
    unassigned,
    mode,
    from,
    to,
    timeZone,
    dateFrom,
    dateTo,
    metric,
    topN,
    commonInterval,
  ]);
  const snapshotKey = useRef('');
  const stale = !!snapshot && snapshotKey.current !== configKey;
  const time = (epoch: number) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: snapshot?.timeZone ?? timeZone,
      dateStyle: 'medium',
      timeStyle: 'medium',
      hourCycle: 'h23',
    }).format(epoch);
  useEffect(() => {
    let active = true;
    setArchiveBusy(true);
    setArchiveError('');
    setSelected([]);
    setSnapshot(null);
    invoke<CaptureArchive[]>('list_traffic_comparison_captures', {
      scope,
      unassigned,
    })
      .then((value) => {
        if (active) setArchives(value);
      })
      .catch((e) => {
        if (active) {
          setArchives([]);
          setArchiveError(String(e));
        }
      })
      .finally(() => {
        if (active) setArchiveBusy(false);
      });
    return () => {
      active = false;
    };
  }, [scope, unassigned, refresh]);
  const cancel = () => {
    if (automaticTimer.current) {
      clearTimeout(automaticTimer.current);
      automaticTimer.current = null;
    }
    generation.current++;
    setBusy(false);
    if (pending.current) {
      void invoke('cancel_traffic_comparison', {
        requestId: pending.current,
      }).catch(() => {});
      pending.current = null;
    }
  };
  useEffect(
    () => () => {
      generation.current++;
      if (pending.current)
        void invoke('cancel_traffic_comparison', {
          requestId: pending.current,
        }).catch(() => {});
    },
    [],
  );
  useEffect(() => {
    cancel();
    setError('');
  }, [configKey]); // Discard stale work immediately when filters change.
  const analyze = async () => {
    cancel();
    const current = ++generation.current;
    const requestId = crypto.randomUUID();
    pending.current = requestId;
    setBusy(true);
    setError('');
    try {
      if (!selected.length)
        throw new Error(
          'Select at least one saved, indexed capture.',
        );
      if (dateFrom && dateTo && dateFrom > dateTo)
        throw new Error(
          'The start date must be on or before the end date.',
        );
      const discovery = await invoke<Discovery>(
        'discover_traffic_comparison',
        {
          captureIds: selected,
          scope,
          includeUnassigned: unassigned,
          requestId,
        },
      );
      if (current !== generation.current) return;
      const periods = buildComparisonPeriods(discovery.utcMinutes, {
        mode,
        timeZone,
        from,
        to,
        dateFrom,
        dateTo,
      });
      if (!periods.length)
        throw new Error(
          'No event dates match the selected dates and time zone.',
        );
      const query = (ranges: typeof periods) =>
        invoke<ComparisonResult>('query_traffic_comparison', {
          request: {
            captureIds: selected,
            scope,
            includeUnassigned: unassigned,
            periods: ranges,
            metric,
            topN,
            bucketSeconds: mode === 'hourly' ? 60 : 900,
          },
          requestId,
        });
      let result = await query(periods);
      if (current !== generation.current) return;
      // Keep requested ranges explicitly attached for faithful coverage and export.
      result.periods = result.periods.map((p) => ({
        ...periods.find((r) => r.id === p.id)!,
        ...p,
        ranges:
          p.ranges ?? periods.find((r) => r.id === p.id)!.ranges,
      }));
      let original: ComparisonResult | undefined;
      if (commonInterval) {
        if (mode !== 'hourly')
          throw new Error(
            'The common time intersection is available in hourly mode.',
          );
        if (result.periods.length < 2)
          throw new Error(
            'At least two observed periods are needed for a common interval.',
          );
        const minute = (epoch: number) => {
          const parts = new Intl.DateTimeFormat('en-GB', {
            timeZone,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hourCycle: 'h23',
          }).formatToParts(epoch);
          const part = (name: string) =>
            Number(parts.find((p) => p.type === name)?.value ?? 0);
          return (
            part('hour') * 3600000 +
            part('minute') * 60000 +
            part('second') * 1000 +
            (epoch % 1000)
          );
        };
        const start = Math.max(
          ...result.periods.map((p) => minute(p.first)),
        );
        const end = Math.min(
          ...result.periods.map((p) => minute(p.last)),
        );
        if (start >= end)
          throw new Error(
            'There is no positive common observed clock interval across these periods. Original results remain available when this option is disabled.',
          );
        // Restrict each UTC range by its local clock overlap, including both DST occurrences.
        const common = result.periods.map((p) => ({
          ...p,
          ranges: p.ranges.flatMap((r) => {
            const spans: { start: number; end: number }[] = [];
            for (let t = r.start; t < r.end; t += 60000) {
              const clock = minute(t);
              const left = Math.max(t, t + start - clock);
              const right = Math.min(
                t + 60000,
                r.end,
                t + end - clock + 1,
              );
              if (left < right) {
                const last = spans.at(-1);
                if (last?.end === left) last.end = right;
                else spans.push({ start: left, end: right });
              }
            }
            return spans;
          }),
        }));
        if (common.some((p) => !p.ranges.length))
          throw new Error(
            'No compatible common interval is available.',
          );
        original = result;
        result = await query(common);
        result.excluded += original.excluded;
        if (current !== generation.current) return;
        result.periods = result.periods.map((p) => ({
          ...p,
          ranges:
            p.ranges ?? common.find((r) => r.id === p.id)!.ranges,
        }));
      }
      snapshotKey.current = configKey;
      setSnapshot({
        result,
        original,
        metric,
        topN,
        timeZone,
        mode,
        from,
        to,
        dateFrom,
        dateTo,
        commonInterval,
        proxy,
        profile: scope.profile,
        generatedAt: new Date().toISOString(),
      });
    } catch (e) {
      if (current === generation.current) setError(String(e));
    } finally {
      if (current === generation.current) {
        pending.current = null;
        setBusy(false);
      }
    }
  };
  // Debounce preference changes, keeping the previous immutable snapshot on screen.
  const analyzeLatest = useRef(analyze);
  analyzeLatest.current = analyze;
  useEffect(() => {
    if (!snapshot || !selected.length) return;
    setBusy(true);
    automaticTimer.current = setTimeout(() => {
      automaticTimer.current = null;
      void analyzeLatest.current();
    }, 180);
    return () => {
      if (automaticTimer.current)
        clearTimeout(automaticTimer.current);
    };
  }, [metric, topN, timeZone]);
  const exportPdf = async () => {
    if (!snapshot) return;
    setExporting(true);
    try {
      const { comparisonReportBlob } = await import(
        '@/components/pdf/trafficComparisonDocument'
      );
      const blob = await comparisonReportBlob(snapshot);
      const filename = `comparative-report-${snapshot.generatedAt.replace(/[:.]/g, '-')}.pdf`;
      if (isTauri()) {
        await invoke('save_traffic_pdf', {
          filename,
          bytes: Array.from(new Uint8Array(await blob.arrayBuffer())),
        });
        await invoke('open_traffic_pdf', { filename, folder: false });
        toast.success('Comparative PDF saved.');
      } else download(blob, filename);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setExporting(false);
    }
  };
  const result = snapshot?.result;
  const periods = result?.periods ?? [];
  const missingBytes =
    result?.sources.filter(
      (s) =>
        s.fieldAvailability?.length &&
        !s.fieldAvailability.some(
          (f) =>
            ['cs-bytes', 'sc-bytes'].includes(f.name) &&
            f.populated > 0,
        ),
    ).length ?? 0;
  const fmt = (n: number) =>
    metricValue(n, snapshot?.metric ?? metric);
  const chronologicalPeriods = [...periods].sort(
    (a, b) => a.start - b.start,
  );
  const rankingPageKey = JSON.stringify(
    chronologicalPeriods.map((p) => p.id),
  );
  const rankingPages = Math.ceil(chronologicalPeriods.length / 3);
  const currentRankingPage =
    rankingPage.key === rankingPageKey
      ? Math.min(rankingPage.page, Math.max(0, rankingPages - 1))
      : 0;
  const rankingPeriods = chronologicalPeriods.slice(
    currentRankingPage * 3,
    currentRankingPage * 3 + 3,
  );
  const ranked = periods.map((p) => p.rankings[field] ?? []);
  const rankingMax = Math.max(
    1,
    ...ranked.flatMap((entries) =>
      entries.map((e) => e[snapshot?.metric ?? metric]),
    ),
  );
  const chartBase = {
    backgroundColor: 'transparent',
    color: COLORS,
    tooltip: { trigger: 'axis' },
    legend: { type: 'scroll', textStyle: { color: '#888' } },
    grid: { left: 65, right: 20, top: 45, bottom: 65 },
    textStyle: { fontFamily: 'inherit' },
  };
  return (
    <main className='mx-auto flex w-full min-w-0 max-w-7xl flex-col gap-5 px-4 py-5 md:px-6 [&>[data-slot=card]]:min-w-0'>
      <Link
        href={{ pathname: '/Diagnostics', query: { proxy } }}
        className='flex w-fit items-center gap-2 text-sm text-muted-foreground hover:text-foreground'
      >
        <ArrowLeft className='size-4' />
        Diagnostic Tools
      </Link>
      <PageHeader
        icon={ChartNoAxesCombined}
        eyebrow={`${proxy || 'No proxy selected'} · ${scope.profile === 'mock' ? 'Mocked Data' : 'Live'}`}
        title='Comparative Reports'
        description='Compare historical traffic from saved, indexed captures. Event dates determine the periods.'
        actions={
          <>
            <TimeZonePicker
              value={timeZone}
              onChange={setTimeZone}
              title='Report time zone'
              description='Saved locally for this proxy/profile. Existing results keep their original zone until recalculation succeeds.'
            />

            <Button
              variant='outline'
              disabled={!snapshot || exporting}
              title={
                snapshot
                  ? `Export displayed results in ${snapshot.timeZone}`
                  : 'Compare captures first'
              }
              onClick={() =>
                snapshot &&
                download(
                  new Blob([comparisonCsv(snapshot)], {
                    type: 'text/csv;charset=utf-8',
                  }),
                  'comparative-report.csv',
                )
              }
            >
              <Download />
              CSV
            </Button>
            <Button
              variant='outline'
              disabled={!snapshot || exporting}
              title={
                snapshot
                  ? `Export displayed results in ${snapshot.timeZone}`
                  : 'Compare captures first'
              }
              onClick={() => void exportPdf()}
            >
              {exporting ? (
                <Loader2 className='animate-spin' />
              ) : (
                <Download />
              )}
              PDF
            </Button>
          </>
        }
      />
      <Card className='gap-0 overflow-hidden py-0'>
        <div className='flex flex-wrap items-center justify-between gap-3 border-b p-4'>
          <div>
            <h2 className='text-sm font-semibold'>
              Build a comparison
            </h2>
            <p className='mt-1 text-xs text-muted-foreground'>
              Saved, indexed traffic ·{' '}
              {scope.profile === 'mock' ? 'Mocked Data' : 'Live'}
              {unassigned ? ' · Unassigned sources' : ` · ${proxy}`}
            </p>
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant='outline'
                aria-label='Choose saved captures'
              >
                <span>
                  {selected.length
                    ? `${selected.length} capture${selected.length === 1 ? '' : 's'} selected`
                    : 'Choose saved captures'}
                </span>
                <ChevronDown className='size-3' />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className='w-[440px] space-y-3'
              aria-label='Saved captures'
            >
              <div className='flex items-center justify-between gap-2'>
                <h3 className='text-sm font-medium'>
                  Saved captures
                </h3>
                <Button
                  size='icon'
                  variant='ghost'
                  aria-label='Refresh saved captures'
                  disabled={archiveBusy}
                  onClick={() => setRefresh((n) => n + 1)}
                >
                  <RefreshCw className='size-4' />
                </Button>
              </div>
              <label className='flex items-center gap-2 text-xs'>
                <input
                  type='checkbox'
                  checked={unassigned}
                  onChange={(e) => {
                    cancel();
                    setUnassigned(e.target.checked);
                  }}
                />
                Browse unassigned legacy captures
              </label>
              {unassigned && (
                <p className='rounded-md bg-muted/50 p-2 text-xs text-muted-foreground'>
                  Unassigned captures have no verified proxy or
                  profile. Selecting one explicitly includes it as
                  Unassigned; it will never be attributed to this
                  appliance.
                </p>
              )}
              <input
                aria-label='Search saved captures'
                className={`${INPUT} w-full`}
                placeholder='Find a saved capture…'
                value={captureSearch}
                onChange={(e) => setCaptureSearch(e.target.value)}
              />
              {archiveBusy ? (
                <p
                  role='status'
                  className='text-xs text-muted-foreground'
                >
                  Discovering saved captures…
                </p>
              ) : archiveError ? (
                <p role='alert' className='text-xs text-destructive'>
                  {archiveError}
                </p>
              ) : !archives.length ? (
                <p className='text-xs text-muted-foreground'>
                  No saved captures in this scope. Save one in Traffic
                  Analysis or explicitly browse Unassigned.
                </p>
              ) : (
                <div className='max-h-64 divide-y overflow-y-auto'>
                  {archives
                    .filter((a) =>
                      `${a.source} ${a.id}`
                        .toLowerCase()
                        .includes(captureSearch.toLowerCase()),
                    )
                    .map((a) => (
                      <label
                        key={a.id}
                        className='flex min-w-0 cursor-pointer items-start gap-3 rounded-md p-2 text-sm hover:bg-accent/40'
                      >
                        <input
                          type='checkbox'
                          className='mt-1'
                          checked={selected.includes(a.id)}
                          onChange={(e) =>
                            setSelected((ids) =>
                              e.target.checked
                                ? [...ids, a.id]
                                : ids.filter((id) => id !== a.id),
                            )
                          }
                        />
                        <span className='min-w-0 flex-1'>
                          <span
                            className='block truncate font-medium'
                            title={a.source}
                          >
                            {a.source}
                          </span>
                          <span className='block text-xs text-muted-foreground'>
                            {num(a.records)} records ·{' '}
                            {unassigned
                              ? 'Unassigned'
                              : scope.profile}
                          </span>
                          <span className='block break-all text-[10px] text-muted-foreground'>
                            {a.id}
                          </span>
                        </span>
                      </label>
                    ))}
                </div>
              )}
              <p className='border-t pt-2 text-[11px] text-muted-foreground'>
                Read-only SQLite v3. Overlapping captures cannot be
                combined unless record uniqueness is established.
              </p>
            </PopoverContent>
          </Popover>
        </div>
        <div className='space-y-4 p-4'>
          <div className='flex flex-wrap items-center gap-3'>
            <div
              role='group'
              aria-label='Comparison type'
              className='inline-flex max-w-full rounded-lg bg-muted/60 p-1'
            >
              {(['hourly', 'daily', 'weekly'] as const).map(
                (value) => (
                  <button
                    type='button'
                    key={value}
                    aria-pressed={mode === value}
                    onClick={() => {
                      setMode(value);
                      setCommonInterval(false);
                    }}
                    className={`rounded-md px-3 py-2 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring ${mode === value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    {value === 'hourly'
                      ? 'Hourly'
                      : value === 'daily'
                        ? 'Daily'
                        : 'Weekly'}
                  </button>
                ),
              )}
            </div>
            {mode === 'hourly' && (
              <div className='flex flex-wrap items-center gap-2'>
                <CompactTimePicker
                  label='From'
                  value={from}
                  onChange={setFrom}
                />
                <span className='text-xs text-muted-foreground'>
                  –
                </span>
                <CompactTimePicker
                  label='Until'
                  value={to}
                  onChange={setTo}
                />
              </div>
            )}
            <Popover open={dateOpen} onOpenChange={setDateOpen}>
              <PopoverTrigger asChild>
                <Button size='sm' variant='ghost'>
                  {dateFrom || dateTo
                    ? `${dateFrom || 'First event'} → ${dateTo || 'Last event'}`
                    : 'All available dates'}
                  <ChevronDown className='size-3' />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className='w-72 space-y-3'
                aria-label='Optional date filters'
              >
                <h3 className='text-sm font-medium'>
                  Limit event dates
                </h3>
                <p className='text-xs text-muted-foreground'>
                  Empty bounds discover dates from actual events.
                </p>
                <DatePicker
                  label='From date'
                  value={dateFrom || null}
                  onChange={(next) => setDateFrom(next ?? '')}
                />
                <DatePicker
                  label='Until date'
                  value={dateTo || null}
                  onChange={(next) => setDateTo(next ?? '')}
                />
                <Button
                  size='sm'
                  variant='ghost'
                  onClick={() => {
                    setDateFrom('');
                    setDateTo('');
                  }}
                >
                  Clear date filters
                </Button>
              </PopoverContent>
            </Popover>
          </div>
          <p className='text-xs text-muted-foreground'>
            {mode === 'hourly'
              ? 'Repeat this local clock window on every actual event date. Start must precede end.'
              : mode === 'daily'
                ? 'Compare full local days with events. Previous hourly selections do not apply.'
                : 'Compare local Monday–Sunday weeks with records. Optional dates clip week boundaries.'}
          </p>
          {mode === 'hourly' && (
            <label className='flex items-start gap-2 text-xs text-muted-foreground'>
              <input
                type='checkbox'
                checked={commonInterval}
                onChange={(e) => setCommonInterval(e.target.checked)}
              />
              <span>
                Use common observed clock interval{' '}
                <span title='Intersects first/last local event times and preserves original totals. This does not certify uninterrupted logs.'>
                  ⓘ
                </span>
              </span>
            </label>
          )}
        </div>
        <div className='flex flex-wrap items-center gap-3 border-t bg-muted/20 p-3'>
          <div
            role='group'
            aria-label='Primary metric'
            className='flex rounded-lg border bg-background p-1'
          >
            {(['requests', 'bytes'] as const).map((m) => (
              <button
                key={m}
                type='button'
                aria-pressed={metric === m}
                onClick={() => setMetric(m)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring ${metric === m ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground'}`}
              >
                {m === 'bytes' ? 'Bytes' : 'Requests'}
              </button>
            ))}
          </div>
          <label className='flex items-center gap-2 text-xs text-muted-foreground'>
            Top
            <select
              aria-label='Top N'
              className={`${INPUT} h-8`}
              value={topN}
              onChange={(e) => setTopN(Number(e.target.value))}
            >
              {[5, 10, 20, 50].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <div className='ml-auto flex items-center gap-2'>
            {busy && (
              <Button size='sm' variant='ghost' onClick={cancel}>
                Cancel
              </Button>
            )}
            <Button
              disabled={!selected.length || busy}
              onClick={() => void analyze()}
            >
              {busy && <Loader2 className='size-4 animate-spin' />}
              Compare
              {selected.length
                ? ` ${selected.length} capture${selected.length === 1 ? '' : 's'}`
                : ''}
            </Button>
          </div>
        </div>
      </Card>
      {error && (
        <p
          role='alert'
          className='rounded-lg border border-destructive/40 p-4 text-sm text-destructive'
        >
          {error}
        </p>
      )}
      {busy && (
        <p
          role='status'
          className='flex items-center gap-2 text-sm text-muted-foreground'
        >
          <Loader2 className='size-4 animate-spin' />
          {snapshot
            ? `Updating for ${timeZone}… Previous results remain visible.`
            : 'Querying indexed captures…'}
        </p>
      )}
      {stale && (
        <p role='status' className='text-sm text-muted-foreground'>
          Showing the previous comparison in {snapshot?.timeZone} (
          {snapshot?.result.sources.length} source(s)).{' '}
          {busy
            ? 'Updating in the background…'
            : 'Settings differ; Compare to apply pending filters. Exports use the displayed snapshot.'}
        </p>
      )}
      {snapshot && (
        <>
          <div className='flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground'>
            <span>
              {periods.length} observed periods ·{' '}
              {result?.excluded ?? 0} periods excluded without events
              in the requested window · {snapshot.timeZone}
            </span>
            <span>
              {snapshot.metric === 'bytes' ? 'Bytes' : 'Requests'} ·
              Top {snapshot.topN}
              {snapshot.commonInterval ? ' · Common interval' : ''}
            </span>
          </div>
          {missingBytes > 0 && (
            <p className='text-xs text-muted-foreground'>
              Byte fields are unavailable in {missingBytes} selected
              source(s). Byte totals include populated values only;
              displayed zero cannot establish zero traffic volume. See
              source availability.
            </p>
          )}
          {!periods.length ? (
            <Card className='p-8 text-center text-sm text-muted-foreground'>
              No events in these windows. These periods are excluded,
              never counted as zero.
            </Card>
          ) : (
            <>
              <div className='grid min-w-0 gap-3 sm:grid-cols-3'>
                <Card className='gap-1 p-4'>
                  <p className='text-xs text-muted-foreground'>
                    Observed periods
                  </p>
                  <p className='text-2xl font-semibold'>
                    {periods.length}
                  </p>
                  <p className='text-xs text-muted-foreground'>
                    No missing dates filled with zeros
                  </p>
                </Card>
                <Card className='gap-1 p-4'>
                  <p className='text-xs text-muted-foreground'>
                    Total observed requests
                  </p>
                  <p className='text-2xl font-semibold'>
                    {num(periods.reduce((n, p) => n + p.requests, 0))}
                  </p>
                  <p className='text-xs text-muted-foreground'>
                    Across the selected windows
                  </p>
                </Card>
                <Card className='gap-1 p-4'>
                  <p className='text-xs text-muted-foreground'>
                    Total observed volume
                  </p>
                  <p className='text-2xl font-semibold'>
                    {formatBytes(
                      periods.reduce((n, p) => n + p.bytes, 0),
                    )}
                  </p>
                  <p className='text-xs text-muted-foreground'>
                    Available byte fields only
                  </p>
                </Card>
              </div>
              <ComparisonPeriods snapshot={snapshot} time={time} />
              <Card className='gap-2 p-4'>
                <h2 className='text-sm font-semibold'>
                  Observed totals & normalized rates
                </h2>
                <p className='text-xs text-muted-foreground'>
                  Rates divide actual totals by first-to-last elapsed
                  event time. Compare totals alongside observed
                  intervals; neither measure certifies complete logs.
                </p>
                <Chart
                  style={{ height: 300 }}
                  notMerge
                  option={{
                    ...chartBase,
                    dataZoom: [
                      {
                        type: 'inside',
                        xAxisIndex: 0,
                        filterMode: 'none',
                      },
                      zoomSlider,
                    ],
                    legend: {
                      data: ['Total', 'Per observed minute'],
                      textStyle: { color: '#888' },
                    },
                    xAxis: {
                      type: 'category',
                      data: periods.map((p) => p.label),
                      axisLabel: {
                        rotate: periods.length > 6 ? 35 : 0,
                      },
                    },
                    yAxis: [
                      { type: 'value', name: snapshot.metric },
                      {
                        type: 'value',
                        name: '/ minute',
                        splitLine: { show: false },
                      },
                    ],
                    series: [
                      {
                        name: 'Total',
                        type: 'bar',
                        data: periods.map((p) => p[snapshot.metric]),
                        itemStyle: {
                          borderRadius: [4, 4, 0, 0],
                          color: (item: { dataIndex: number }) =>
                            periodColor(item.dataIndex),
                        },
                        barMaxWidth: 45,
                      },
                      {
                        name: 'Per observed minute',
                        type: 'line',
                        yAxisIndex: 1,
                        data: periods.map((p) => {
                          const r = comparisonRate(
                            p,
                            snapshot.metric,
                          );
                          return r === null ? null : r * 60;
                        }),
                      },
                    ],
                  }}
                />
              </Card>
              <ComparisonActivity
                key={JSON.stringify([
                  snapshot.mode,
                  snapshot.timeZone,
                  periods.map((p) => p.id),
                ])}
                snapshot={snapshot}
              />
              <Card className='gap-4 p-4'>
                <div className='flex flex-wrap items-center gap-3'>
                  <h2 className='mr-auto text-sm font-semibold'>
                    Contributors
                  </h2>
                  <select
                    aria-label='Ranking dimension'
                    className={INPUT}
                    value={field}
                    onChange={(e) => setField(e.target.value)}
                  >
                    {Object.entries(FIELDS).map(([key, title]) => (
                      <option key={key} value={key}>
                        {title}
                      </option>
                    ))}
                  </select>
                  {['host', 'client'].includes(field) && (
                    <select
                      aria-label='Ranking scope'
                      className={INPUT}
                      value={rankingMode}
                      onChange={(e) =>
                        setRankingMode(
                          e.target.value as typeof rankingMode,
                        )
                      }
                    >
                      <option value='period'>Top per period</option>
                      <option value='common'>
                        Common to every observed period
                      </option>
                    </select>
                  )}
                </div>
                <nav
                  aria-label='Contributor ranking pages'
                  className='flex items-center justify-end gap-2 border-t pt-3'
                >
                  <span
                    className='mr-auto text-xs text-muted-foreground'
                    aria-live='polite'
                  >
                    Periods {currentRankingPage * 3 + 1}–
                    {Math.min(
                      (currentRankingPage + 1) * 3,
                      periods.length,
                    )}{' '}
                    of {periods.length}
                  </span>
                  <Button
                    size='icon'
                    variant='outline'
                    aria-label='Previous contributor page'
                    disabled={currentRankingPage === 0}
                    onClick={() =>
                      setRankingPage({
                        key: rankingPageKey,
                        page: currentRankingPage - 1,
                      })
                    }
                  >
                    <ChevronLeft />
                  </Button>
                  <span className='text-xs tabular-nums'>
                    {currentRankingPage + 1} / {rankingPages}
                  </span>
                  <Button
                    size='icon'
                    variant='outline'
                    aria-label='Next contributor page'
                    disabled={currentRankingPage >= rankingPages - 1}
                    onClick={() =>
                      setRankingPage({
                        key: rankingPageKey,
                        page: currentRankingPage + 1,
                      })
                    }
                  >
                    <ChevronRight />
                  </Button>
                </nav>
                {rankingMode === 'common' &&
                ['host', 'client'].includes(field) ? (
                  <>
                    <p className='text-xs text-muted-foreground'>
                      Intersection is computed from all entities in
                      every observed period before applying Top{' '}
                      {snapshot.topN}.
                    </p>
                    <div
                      className='max-h-96 min-w-0 overflow-auto'
                      tabIndex={0}
                    >
                      <table className='w-full text-left text-xs'>
                        <thead>
                          <tr>
                            <th className='p-2'>Entity</th>
                            {rankingPeriods.map((p) => (
                              <th key={p.id} className='p-2'>
                                {p.label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {(result?.common[field] ?? []).map((e) => (
                            <tr key={e.name} className='border-t'>
                              <td className='max-w-64 break-all p-2'>
                                {e.name}
                              </td>
                              {rankingPeriods.map((p) => (
                                <td
                                  key={p.id}
                                  className='whitespace-nowrap p-2'
                                >
                                  {fmt(
                                    e.values.find(
                                      (v) => v.periodId === p.id,
                                    )?.[snapshot.metric] ?? 0,
                                  )}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!result?.common[field]?.length && (
                        <p className='p-4 text-muted-foreground'>
                          No populated entities common to every
                          period.
                        </p>
                      )}
                    </div>
                  </>
                ) : (
                  <div
                    className={`grid min-w-0 gap-5 ${
                      periods.length === 1 ||
                      rankingPeriods.length === 2
                        ? 'md:grid-cols-2'
                        : rankingPeriods.length === 3
                          ? 'md:grid-cols-3'
                          : 'md:grid-cols-1'
                    }`}
                  >
                    {rankingPeriods.map((p) => (
                      <section
                        key={p.id}
                        className='max-h-96 min-w-0 overflow-y-auto pr-2'
                      >
                        <h3 className='mb-3 text-xs font-medium'>
                          {p.label}
                        </h3>
                        {(p.rankings[field] ?? []).length ? (
                          (p.rankings[field] ?? []).map((e) => (
                            <RankingRow
                              key={e.name}
                              entry={e}
                              metric={snapshot.metric}
                              max={rankingMax}
                              color={periodColor(
                                periods.findIndex(
                                  (period) => period.id === p.id,
                                ),
                              )}
                            />
                          ))
                        ) : (
                          <p className='text-xs text-muted-foreground'>
                            No populated values available.
                          </p>
                        )}
                      </section>
                    ))}
                    {periods.length === 1 && (
                      <section
                        aria-hidden='true'
                        className='pointer-events-none min-w-0 select-none space-y-4 rounded-lg border border-dashed p-3 opacity-40'
                      >
                        <p className='text-xs text-muted-foreground'>
                          No additional period
                        </p>
                        {[80, 65, 90, 45, 70].map((width) => (
                          <div key={width} className='space-y-2'>
                            <div className='flex justify-between gap-3'>
                              <div className='h-2.5 w-24 rounded bg-muted' />
                              <div className='h-2.5 w-10 rounded bg-muted' />
                            </div>
                            <div
                              className='h-1 rounded-full bg-muted'
                              style={{ width: `${width}%` }}
                            />
                          </div>
                        ))}
                      </section>
                    )}
                  </div>
                )}
              </Card>
              <Card className='gap-3 p-4'>
                <h2 className='text-sm font-semibold'>
                  HTTP errors & policy outcomes
                </h2>
                <div
                  className='max-h-96 min-w-0 overflow-auto'
                  tabIndex={0}
                >
                  <table className='w-full whitespace-nowrap text-left text-xs'>
                    <thead>
                      <tr>
                        {[
                          'Period',
                          'HTTP 4xx',
                          'HTTP 5xx',
                          'Policy denials',
                          'Record issues',
                          'Parse failures',
                          'Observed interval',
                        ].map((x) => (
                          <th key={x} className='p-2'>
                            {x}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {periods.map((p) => (
                        <tr key={p.id} className='border-t'>
                          <td className='p-2'>{p.label}</td>
                          <td className='p-2'>{num(p.http4xx)}</td>
                          <td className='p-2'>{num(p.http5xx)}</td>
                          <td className='p-2'>{num(p.denied)}</td>
                          <td className='p-2'>{num(p.issues)}</td>
                          <td className='p-2'>
                            {p.parseFailures === undefined
                              ? 'Unavailable'
                              : num(p.parseFailures)}
                          </td>
                          <td className='p-2'>
                            {time(p.first)} – {time(p.last)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className='text-xs text-muted-foreground'>
                  These are request counts; the primary metric applies
                  to contributor and HTTP/action distributions above.
                  Indexed parse failures are separate from HTTP
                  failures. Unassigned ingestion diagnostics remain
                  source-level; missing fields cannot establish
                  absence of failures.
                </p>
              </Card>
              {['host', 'client'].includes(field) && (
                <Card className='gap-3 p-4'>
                  <h2 className='text-sm font-semibold'>
                    Emerging & disappeared{' '}
                    {FIELDS[field].toLowerCase()}
                  </h2>
                  <p className='text-xs text-muted-foreground'>
                    Presence changes use complete entity sets between
                    consecutive observed periods, before Top N.
                    Absence means no observed event in that selected
                    period.
                  </p>
                  {(
                    result?.changes?.[field]?.filter((change) =>
                      rankingPeriods.some(
                        (p) => p.id === change.toPeriod,
                      ),
                    ) ?? []
                  ).map((change) => (
                    <div
                      key={`${change.fromPeriod}:${change.toPeriod}`}
                      className='border-t pt-3'
                    >
                      <h3 className='mb-2 text-xs font-medium'>
                        {
                          periods.find(
                            (p) => p.id === change.fromPeriod,
                          )?.label
                        }{' '}
                        →{' '}
                        {
                          periods.find(
                            (p) => p.id === change.toPeriod,
                          )?.label
                        }
                      </h3>
                      <div className='grid gap-4 sm:grid-cols-2'>
                        {(['emerged', 'disappeared'] as const).map(
                          (kind) => (
                            <div key={kind}>
                              <p className='mb-2 text-xs text-muted-foreground'>
                                {kind === 'emerged'
                                  ? 'Newly observed'
                                  : 'No longer observed'}
                              </p>
                              {change[kind].length ? (
                                change[kind].map((e) => (
                                  <p
                                    key={e.name}
                                    className='flex justify-between gap-3 text-xs'
                                  >
                                    <span
                                      className='truncate'
                                      title={e.name}
                                    >
                                      {e.name}
                                    </span>
                                    <span>
                                      {fmt(e[snapshot.metric])}
                                    </span>
                                  </p>
                                ))
                              ) : (
                                <p className='text-xs text-muted-foreground'>
                                  None
                                </p>
                              )}
                            </div>
                          ),
                        )}
                      </div>
                    </div>
                  ))}
                  {!result?.changes?.[field]?.length && (
                    <p className='text-xs text-muted-foreground'>
                      A second observed period is needed.
                    </p>
                  )}
                </Card>
              )}
              <Insights periods={periods} metric={snapshot.metric} />
              {snapshot.original && (
                <details className='rounded-xl border p-4 text-sm'>
                  <summary className='cursor-pointer font-medium'>
                    Original observed totals before common interval
                    restriction
                  </summary>
                  <div className='mt-3 space-y-1 text-xs text-muted-foreground'>
                    {snapshot.original.periods.map((p) => (
                      <p key={p.id}>
                        {p.label}: {num(p.requests)} requests ·{' '}
                        {formatBytes(p.bytes)} · {time(p.first)} –{' '}
                        {time(p.last)}
                      </p>
                    ))}
                  </div>
                </details>
              )}
            </>
          )}
          <details className='rounded-xl border p-4 text-sm'>
            <summary className='cursor-pointer font-medium'>
              Sources & comparability
            </summary>
            <p className='mt-3 text-xs leading-relaxed text-muted-foreground'>
              {COMPARISON_NOTE} Unique counts are computed across the
              consolidated set, never summed between captures. Missing
              field values are omitted from rankings; zero does not
              establish field availability.
            </p>
            <div className='mt-3 space-y-2'>
              {result?.sources.map((s) => (
                <div
                  key={s.id}
                  className='text-xs text-muted-foreground'
                >
                  <p className='break-all'>
                    {s.source} · {s.id}
                  </p>
                  <p>
                    {s.scope
                      ? `${s.scope.proxyIdentity} / ${s.scope.profile}`
                      : 'Unassigned · proxy/profile unknown'}{' '}
                    · {num(s.records)} indexed records ·{' '}
                    {num(s.untimedRecords)} without usable timestamps
                    · {num(s.diagnosticsTotal ?? 0)} ingestion
                    diagnostics ({num(s.unassignedDiagnostics ?? 0)}{' '}
                    unassigned)
                  </p>
                  <details className='mt-2'>
                    <summary className='cursor-pointer'>
                      Available fields and limitations
                    </summary>
                    <div className='mt-2 grid gap-1 sm:grid-cols-2'>
                      {s.fieldAvailability?.length ? (
                        s.fieldAvailability.map((f) => (
                          <p key={f.name} className='break-all'>
                            {f.name}: {f.status} · {num(f.populated)}{' '}
                            / {num(f.total)} populated
                          </p>
                        ))
                      ) : (
                        <p>No field availability metadata.</p>
                      )}
                    </div>
                  </details>
                </div>
              ))}
            </div>
          </details>
        </>
      )}
    </main>
  );
}
function RankingRow({
  entry: e,
  metric,
  max,
  color,
}: {
  entry: ComparisonEntry;
  metric: ReportMetric;
  max: number;
  color: string;
}) {
  return (
    <div className='mb-3 min-w-0'>
      <div className='mb-1 flex gap-3 text-xs'>
        <span className='min-w-0 flex-1 truncate' title={e.name}>
          {e.name}
        </span>
        <span
          className='shrink-0 tabular-nums'
          title={`${num(e.requests)} requests · ${formatBytes(e.bytes)}`}
        >
          {metricValue(e[metric], metric)}
        </span>
      </div>
      <div className='h-1 rounded-full bg-muted'>
        <div
          className='h-full rounded-full'
          style={{
            width: `${(e[metric] / max) * 100}%`,
            backgroundColor: color,
          }}
        />
      </div>
    </div>
  );
}
function Insights({
  periods,
  metric,
}: {
  periods: ComparisonPeriod[];
  metric: ReportMetric;
}) {
  const first = periods[0],
    last = periods.at(-1)!;
  const rates = periods
    .map((p) => comparisonRate(p, metric))
    .filter((r): r is number => r !== null);
  const spans = periods.map((p) => p.last - p.first);
  return (
    <Card className='gap-2 p-4'>
      <h2 className='text-sm font-semibold'>Observed findings</h2>
      <p className='text-xs text-muted-foreground'>
        {periods.length < 2 ? (
          'A second observed period is needed to calculate change.'
        ) : (
          <>
            {last.label} vs {first.label}:{' '}
            <TrafficDelta
              value={last[metric]}
              before={first[metric]}
              metric={metric}
            />{' '}
            {metric}. Observed totals may have different coverage.
          </>
        )}
      </p>
      {Math.max(...spans) > Math.min(...spans) * 1.1 && (
        <p className='text-xs text-muted-foreground'>
          Observed durations differ by more than 10%. Compare
          normalized rates and the common interval before interpreting
          total changes.
        </p>
      )}
      {rates.length > 1 && (
        <p className='text-xs text-muted-foreground'>
          Observed rates range from{' '}
          {metricValue(Math.min(...rates) * 60, metric)} to{' '}
          {metricValue(Math.max(...rates) * 60, metric)} per minute.
          No cause or anomaly classification is inferred.
        </p>
      )}
    </Card>
  );
}
