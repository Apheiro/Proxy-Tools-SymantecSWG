'use client';

import { invoke } from '@tauri-apps/api/core';
import {
  Activity,
  ArrowLeft,
  RefreshCw,
  Pause,
  Play,
  Square,
  Save,
  FolderOpen,
  X,
} from 'lucide-react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import { Tabs } from 'radix-ui';
import { useReducedMotion } from 'motion/react';
import { TooltipOne } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { useDiagnosticsVisible } from '@/components/diagnosticsTasks';
import PageHeader from '@/components/pageHeader';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TimeZonePicker } from '@/components/ui/time-zone-picker';
import { DateTimePicker } from '@/components/ui/date-time-picker';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from '@/components/ui/dialog';
import { useComparisonZoomSlider } from '@/components/comparisonChartZoom';
import getCredentials from '@/lib/getCredentials';
import useDataSourceMode from '@/lib/useDataSourceMode';
import { formatBytes } from '@/lib/trafficAnalysis';
import {
  useActiveQuery,
  formatDuration,
  pollingLabel,
  xmlValue,
  XML_FIELDS,
  type ActiveScope,
  type MonitorStatus,
  type ConnectionSnapshot,
  type CaptureEntry,
  type QueryResult,
  type ConnectionRow,
  type RankingRow,
  type ConnectionDetail,
  type XmlNode,
} from '@/lib/activeConnections';

const Chart = dynamic(() => import('echarts-for-react'), {
  ssr: false,
});
const INPUT =
  'h-9 min-w-0 rounded-md border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const display = (value: string | number | null | undefined) =>
  value == null ? '—' : value === '' ? '(empty)' : String(value);
const number = (value: number | null | undefined) =>
  value == null ? '—' : value.toLocaleString();
const classified = (value: string | null) =>
  !value || value.toLowerCase() === 'none' ? 'Unclassified' : value;

export default function ActiveConnectionsWorkspace({
  proxy,
}: {
  proxy: string;
}) {
  const { mode, ready } = useDataSourceMode();
  return ready ? (
    <Workspace
      key={`${mode}:${proxy}`}
      scope={{ proxy, profile: mode }}
    />
  ) : (
    <main className='p-8'>Loading data profile…</main>
  );
}

function Workspace({ scope: passedScope }: { scope: ActiveScope }) {
  const visible = useDiagnosticsVisible();
  const scope = useMemo(
    () => passedScope,
    [passedScope.proxy, passedScope.profile],
  );
  const [status, setStatus] = useState<MonitorStatus | null>(null);
  const [attached, setAttached] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [interval, setIntervalSeconds] = useState(10);
  const [zone, setZone] = useState('UTC');
  const [clock, setClock] = useState(Date.now());
  const [saved, setSaved] = useState<CaptureEntry | null>(null);
  const [library, setLibrary] = useState<CaptureEntry[]>([]);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [selected, setSelected] = useState<ConnectionSnapshot | null>(
    null,
  );
  const [through, setThrough] = useState<string | null>(null);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [tab, setTab] = useState('connections');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sort, setSort] = useState('session');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const reduceMotion = useReducedMotion();
  const [detailId, setDetailId] = useState('');
  const [collapsedSessions, setCollapsedSessions] = useState<
    Set<number>
  >(new Set());
  const slider = useComparisonZoomSlider();
  const [zoom, setZoom] = useState<{ startValue: number; endValue: number } | null>(null);
  const [chartEpoch, setChartEpoch] = useState(0);
  const [frozenTimeline, setFrozenTimeline] = useState<QueryResult<ConnectionSnapshot> | null>(null);
  const captureId = saved?.id ?? status?.id ?? '';
  const revision = status?.last?.id ?? 0;
  useEffect(() => {
    setZoom(null);
    setFrozenTimeline(null);
  }, [captureId, through, historyOffset]);
  const timeline = useActiveQuery<QueryResult<ConnectionSnapshot>>(
    scope,
    captureId,
    {
      kind: 'timeline',
      limit: 200,
      offset: historyOffset,
      ...(through ? { before: Date.parse(through) } : {}),
      // A changing revision retriggers bounded queries without becoming an SQL predicate.
      ...(saved ? {} : { connection: String(revision) }),
    },
    true,
  );
  const samples = (frozenTimeline ?? timeline.data)?.items ?? [];
  const newest = samples.at(-1) ?? null;
  const liveSample = saved
    ? ([...samples]
        .reverse()
        .find((s) => s.quality === 'OK' || s.quality === 'Empty') ??
      null)
    : (status?.last_good ?? null);
  const inspected =
    selected ?? (saved ? newest : status?.last) ?? newest;
  const validInspection =
    inspected?.quality === 'OK' || inspected?.quality === 'Empty';
  const inspectionId = validInspection ? captureId : '';
  const rows = useActiveQuery<
    QueryResult<ConnectionRow & RankingRow>
  >(scope, inspectionId, {
    kind:
      tab === 'clients'
        ? 'clients'
        : tab === 'destinations'
          ? 'destinations'
          : 'connections',
    snapshot: inspected?.id,
    offset: page * pageSize,
    limit: pageSize,
    search: debouncedSearch,
    sort,
    filter,
  });
  const detail = useActiveQuery<ConnectionDetail>(
    scope,
    detailId ? inspectionId : '',
    { kind: 'detail', snapshot: inspected?.id, connection: detailId },
  );
  const metadata = useActiveQuery<{ raw: XmlNode | null }>(
    scope,
    tab === 'diagnostics' ? inspectionId : '',
    { kind: 'metadata', snapshot: inspected?.id },
  );
  const time = (value: number, compact = false) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      ...(compact
        ? {}
        : { year: 'numeric', month: 'short', day: '2-digit' }),
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(value);

  useEffect(() => {
    if (!scope.proxy) {
      setAttached(true);
      return;
    }
    let current = true;
    void invoke<MonitorStatus | null>('ac_attach', { scope })
      .then((value) => {
        if (current) {
          setStatus(value);
          if (value) setIntervalSeconds(value.interval);
        }
      })
      .catch((reason) => {
        if (current) setError(String(reason));
      })
      .finally(() => {
        if (current) setAttached(true);
      });
    return () => {
      current = false;
    };
  }, [scope]);
  useEffect(() => {
    if (!attached || !scope.proxy) return;
    let current = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const value = await invoke<MonitorStatus | null>(
          'ac_status',
          { scope },
        );
        if (current) {
          setStatus(value);
          setClock(Date.now());
        }
      } catch (reason) {
        if (current) setError(String(reason));
      }
      if (current) timer = setTimeout(poll, 2000);
    };
    timer = setTimeout(poll, 2000);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [scope, attached]);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(timer);
  }, [search]);
  // Pin inspection independently from the live summary/timeline. Incoming samples
  // must never replace the rows the user is reading or their detail snapshot.
  useEffect(() => {
    if (!selected && inspected) setSelected(inspected);
  }, [selected, inspected]);
  useEffect(() => {
    setPage(0);
  }, [tab, debouncedSearch, sort, filter, pageSize, captureId]);
  useEffect(() => {
    if (!rows.data || rows.busy) return;
    setPage((current) => Math.min(current, Math.max(0, Math.ceil(rows.data!.total / pageSize) - 1)));
  }, [rows.data, rows.busy, pageSize]);

  async function start() {
    setBusy(true);
    setError('');
    try {
      const credentials =
        scope.profile === 'live' ? getCredentials() : null;
      if (scope.profile === 'live' && !credentials)
        throw new Error(
          'Save management credentials in Settings first.',
        );
      const value = await invoke<MonitorStatus>('ac_start', {
        scope,
        interval,
        username:
          scope.profile === 'live'
            ? (credentials?.username ?? '')
            : '',
        password:
          scope.profile === 'live'
            ? (credentials?.password ?? '')
            : '',
      });
      setStatus(value);
      setSaved(null);
      setSelected(null);
      setThrough(null);
      setHistoryOffset(0);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }
  async function control(action: string) {
    if (!status) return;
    setBusy(true);
    setError('');
    try {
      const credentials =
        action === 'resume' && scope.profile === 'live'
          ? getCredentials()
          : null;
      if (
        action === 'resume' &&
        scope.profile === 'live' &&
        !credentials
      )
        throw new Error(
          'Save management credentials in Settings before resuming.',
        );
      setStatus(
        await invoke<MonitorStatus>('ac_control', {
          scope,
          id: status.id,
          action,
          username: credentials?.username ?? null,
          password: credentials?.password ?? null,
        }),
      );
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!captureId) return;
    setBusy(true);
    try {
      await invoke('ac_save', { scope, id: captureId });
      toast.success('Capture saved to this proxy/profile library.');
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }
  async function loadLibrary() {
    setLibraryOpen(true);
    setLibraryBusy(true);
    try {
      setLibrary(await invoke<CaptureEntry[]>('ac_list', { scope }));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setLibraryBusy(false);
    }
  }
  function resetView() {
    setChartEpoch((value) => value + 1);
    setSelected(null);
    setThrough(null);
    setHistoryOffset(0);
    setDetailId('');
    setZoom(null);
    setFrozenTimeline(null);
  }
  const running =
    !!status && !['Stopped', 'Stopping'].includes(status.state);
  const stale =
    !saved &&
    !!liveSample &&
    clock - liveSample.received_at >
      Math.max(30_000, (status?.interval ?? interval) * 2500);
  const latestGood = samples.filter(
    (s) => s.quality === 'OK' || s.quality === 'Empty',
  );
  const previous = latestGood
    .filter((s) => liveSample && s.id < liveSample.id)
    .at(-1);
  const delta = (key: 'sessions' | 'connections') => {
    const value = liveSample?.[key];
    const prev = previous?.[key];
    if (
      value == null ||
      prev == null ||
      saved ||
      through ||
      historyOffset
    )
      return 'Last valid sample';
    const diff = value - prev;
    return `${diff > 0 ? '+' : ''}${number(diff)} vs previous valid sample`;
  };
  const peak = latestGood.length
    ? Math.max(...latestGood.map((s) => s.sessions ?? 0))
    : null;
  const usage = liveSample && (status?.interval ?? interval) > 0
    ? (liveSample.response_bytes * 3600) /
      (status?.interval ?? interval)
    : null;
  const queryError = timeline.error || rows.error;
  const chartOption = useMemo(() => ({
    animation: !reduceMotion,
    animationDuration: 0,
    animationDurationUpdate: !saved && !through && !historyOffset && !frozenTimeline && !reduceMotion ? 300 : 0,
    animationEasingUpdate: 'linear',
    color: ['#3b82f6', '#14b8a6'],
    tooltip: {
      trigger: 'axis',
      confine: true,
      renderMode: 'richText',
      formatter: (
        params: Array<{
          seriesName: string;
          value: [number, number | null, number];
        }>,
      ) => {
        const first = params[0];
        if (!first) return '';
        const point = samples.find((s) => s.id === first.value[2]);
        return `${time(first.value[0])} (${zone})\n${params.map((p) => `${p.seriesName}: ${p.value[1] == null ? 'Missing sample' : number(p.value[1])}`).join('\n')}\nSample #${point?.id ?? '—'} · ${point?.quality ?? 'Unknown'}`;
      },
    },
    legend: { top: 0, textStyle: { color: 'inherit' } },
    grid: { left: 46, right: 18, top: 40, bottom: 58 },
    xAxis: {
      type: 'time',
      axisLabel: { formatter: (value: number) => time(value, true) },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      name: 'Concurrency',
      splitLine: { lineStyle: { opacity: 0.12 } },
    },
    dataZoom: [{ id: 'inside', type: 'inside', filterMode: 'none', ...zoom }, { ...slider, id: 'slider', ...zoom }],
    series: (['sessions', 'connections'] as const).map((key, i) => ({
      id: key,
      name: i === 0 ? 'Proxied Sessions' : 'Proxied Connections',
      type: 'line',
      connectNulls: true,
      showSymbol: samples.length < 80,
      symbolSize: 7,
      lineStyle: { width: 2 },
      // Connect valid observations directly across failures and elapsed time.
      // Keep their original timestamps and IDs; never invent a measurement.
      data: samples.flatMap((s) => {
        const value = s[key];
        return (s.quality === 'OK' || s.quality === 'Empty') &&
          typeof value === 'number' && Number.isFinite(value)
          ? [[s.received_at, value, s.id]]
          : [];
      }),
      markLine: { data: [] },
      ...(i === 0 &&
      liveSample &&
      !saved &&
      !through &&
      !historyOffset &&
      !frozenTimeline
        ? {
            markLine: {
              symbol: 'none',
              label: {
                formatter: 'Latest good',
                position: 'insideEndTop',
              },
              data: [{ xAxis: liveSample.received_at }],
            },
          }
        : {}),
    })),
  }), [samples, zone, slider, zoom, reduceMotion, saved, through, historyOffset, status?.interval, interval, liveSample?.id, frozenTimeline]);

  return (
    <main className='mx-auto flex w-full min-w-0 max-w-7xl flex-col gap-5 px-4 py-5 md:px-6'>
      <Link
        href={{
          pathname: '/Diagnostics',
          query: { proxy: scope.proxy },
        }}
        className='flex w-fit items-center gap-2 text-sm text-muted-foreground hover:text-foreground'
      >
        <ArrowLeft className='size-4' /> Diagnostic Tools
      </Link>
      <PageHeader
        icon={Activity}
        eyebrow='Proxy diagnostics'
        title='Active Connections'
        description={
          <>
            {scope.proxy || 'No proxy selected'} ·{' '}
            {scope.profile === 'mock'
              ? 'Mocked Data · synthetic only'
              : 'Live'}
            <br />
            <span className='break-all font-mono text-xs'>
              {saved?.route ??
                status?.route ??
                '/AS/ProxiedConnections/XML'}
            </span>
          </>
        }
        actions={
          <>
            <TimeZonePicker value={zone} onChange={setZone} />
            <Badge variant='secondary'>
              {saved
                ? 'Saved review'
                : stale
                  ? `${status?.state ?? 'Idle'} · stale`
                  : (status?.state ?? 'Not started')}
            </Badge>
          </>
        }
      />
      <Card className='gap-3 p-4'>
        <div className='flex flex-wrap items-center gap-2'>
          <label className='flex items-center gap-2 text-xs text-muted-foreground'>
            Polling mode
            <select
              aria-label='Sampling interval'
              className={INPUT}
              value={interval}
              onChange={(e) =>
                setIntervalSeconds(Number(e.target.value))
              }
              disabled={running}
            >
              <option value={0}>Continuous</option>
              {[5, 10, 30, 60].map((n) => (
                <option key={n} value={n}>
                  {n}s
                </option>
              ))}
            </select>
          </label>
          <Button
            onClick={() => void start()}
            disabled={!scope.proxy || !attached || busy || running}
          >
            <Play /> Start
          </Button>
          <Button
            variant='outline'
            onClick={() =>
              void control(
                status?.state === 'Paused' ? 'resume' : 'pause',
              )
            }
            disabled={busy || !running || !!saved}
          >
            {status?.state === 'Paused' ? <Play /> : <Pause />}
            {status?.state === 'Paused' ? 'Resume' : 'Pause'}
          </Button>
          <Button
            variant='outline'
            onClick={() => void control('stop')}
            disabled={busy || !running || !!saved}
          >
            <Square /> Stop
          </Button>
          <Button
            variant='ghost'
            aria-label='Refresh one sample'
            onClick={() => void control('refresh')}
            disabled={busy || !running || !!saved}
          >
            <RefreshCw /> Refresh
          </Button>
          <div className='ml-auto flex gap-2'>
            <Button
              variant='outline'
              disabled={!captureId || busy}
              onClick={() => void save()}
            >
              <Save /> Save Capture
            </Button>
            <Button
              variant='outline'
              disabled={!scope.proxy || busy}
              onClick={() => void loadLibrary()}
            >
              <FolderOpen /> Load Saved
            </Button>
          </div>
        </div>
        <p className='text-xs text-muted-foreground'>
          {pollingLabel(saved?.interval ?? status?.interval ?? interval)}. Read-only snapshots.{' '}
          {usage == null
            ? (saved?.interval ?? status?.interval ?? interval) === 0
              ? 'Continuous mode uses a 350 ms safety delay after each completed sample; bandwidth depends on response and processing time.'
              : 'Bandwidth estimate will be available after the first valid sample.'
            : `Estimated ${formatBytes(usage)}/hour uncompressed at this response size.`}{' '}
          Missing polls are gaps. ICAP and acceleration codes do not
          measure timing.
        </p>
        {running && !saved && (
          <p className='text-xs text-muted-foreground'>
            Capture continues when navigating. Several proxies can collect in parallel. Switching
            data profile stops incompatible captures. Save
            explicitly to keep it in the library.
          </p>
        )}
        {saved && (
          <div className='flex flex-wrap items-center justify-between gap-2 text-sm'>
            <span>
              Saved capture · {time(saved.started)} · historical
              review
              {running
                ? ' · a current capture continues in the background'
                : ''}
            </span>
            <Button
              variant='secondary'
              size='sm'
              onClick={() => {
                setSaved(null);
                resetView();
              }}
            >
              Return to current capture
            </Button>
          </div>
        )}
      </Card>
      {(error || (status?.error && !saved) || queryError) && (
        <div
          role='alert'
          className='rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive'
        >
          {error || (!saved ? status?.error : '') || queryError}
        </div>
      )}
      <section
        aria-label={
          saved ? 'Historical summary' : 'Latest valid sample summary'
        }
        className='grid grid-cols-2 gap-3 lg:grid-cols-4'
      >
        {[
          [
            'Proxied Sessions',
            number(liveSample?.sessions),
            delta('sessions'),
          ],
          [
            'Proxied Connections',
            number(liveSample?.connections),
            delta('connections'),
          ],
          [
            'Unique Clients',
            number(liveSample?.clients),
            'Distinct addresses in this sample',
          ],
          [
            'Peak Sessions',
            number(peak),
            'Maximum in loaded timeline window',
          ],
        ].map(([label, value, note]) => (
          <Card key={label} className='gap-1 p-4'>
            <h2 className='text-xs font-medium text-muted-foreground'>
              {label}
            </h2>
            <div className='text-3xl font-semibold tabular-nums'>
              {value}
            </div>
            <p className='text-xs text-muted-foreground'>{note}</p>
          </Card>
        ))}
      </section>
      <Card className='min-w-0 gap-3 p-4'>
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <div>
            <h2 className='font-semibold'>Sampled concurrency</h2>
            <p className='text-xs text-muted-foreground'>
              {zone} · click a point to inspect its exact snapshot ·
              gaps do not mean zero
            </p>
          </div>
          <div className='flex flex-wrap items-end gap-2'>
            <DateTimePicker
              label='History through'
              value={through}
              onChange={(v) => {
                setThrough(v);
                setHistoryOffset(0);
              }}
              timeZone={zone}
              className='w-56 max-w-full'
            />
            <Button
              size='sm'
              variant='outline'
              onClick={() => {
                setThrough(
                  new Date(Date.now() - 3600000).toISOString(),
                );
                setHistoryOffset(0);
              }}
            >
              1 hour ago
            </Button>
            {(selected || through || historyOffset > 0) && (
              <Button
                size='sm'
                variant='secondary'
                onClick={resetView}
              >
                {saved ? 'Latest saved sample' : 'Inspect latest sample'}
              </Button>
            )}
          </div>
        </div>
        {samples.length ? (
          <Chart
            key={`${captureId}:${through}:${historyOffset}:${chartEpoch}`}
            option={chartOption}
            style={{ height: 310, width: '100%' }}
            notMerge={false}
            onEvents={{
              datazoom: (_event: unknown, instance: { getOption: () => { dataZoom?: Array<{ startValue?: number; endValue?: number }> } }) => {
                const range = instance.getOption().dataZoom?.[0];
                if (typeof range?.startValue === 'number' && typeof range?.endValue === 'number') {
                  setFrozenTimeline((previous) => previous ?? timeline.data);
                  setZoom({ startValue: range.startValue, endValue: range.endValue });
                }
              },
              click: (event: {
                data?: [number, number | null, number];
              }) => {
                const point = samples.find(
                  (s) => s.id === event.data?.[2],
                );
                if (point) setSelected(point);
              },
            }}
          />
        ) : (
          <div className='flex h-64 items-center justify-center text-sm text-muted-foreground'>
            {timeline.busy
              ? 'Reading timeline…'
              : captureId
                ? 'No samples in this window. Change History through or return to latest.'
                : 'Start a capture or load a saved capture.'}
          </div>
        )}
        {frozenTimeline && <p className='text-xs text-muted-foreground'>Timeline pinned while zoomed. Inspect latest sample to resume the live timeline.</p>}
        {samples.some(
          (sample) =>
            sample.quality !== 'OK' && sample.quality !== 'Empty',
        ) && (
          <details className='rounded-md border border-amber-500/30 p-2 text-xs'>
            <summary className='cursor-pointer'>
              Missing polls in this window · select to inspect quality
            </summary>
            <div className='mt-2 flex flex-wrap gap-2'>
              {samples
                .filter(
                  (sample) =>
                    sample.quality !== 'OK' &&
                    sample.quality !== 'Empty',
                )
                .map((sample) => (
                  <Button
                    key={sample.id}
                    size='sm'
                    variant='outline'
                    onClick={() => setSelected(sample)}
                  >
                    #{sample.id} · {time(sample.received_at, true)} ·{' '}
                    {sample.quality}
                  </Button>
                ))}
            </div>
          </details>
        )}
        <div className='flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground'>
          <span>
            {samples.length} of {number(timeline.data?.total ?? 0)}{' '}
            matching samples · latest valid{' '}
            {liveSample ? time(liveSample.received_at) : '—'}
            {stale ? ' · STALE' : ''}
          </span>
          <div className='flex gap-2'>
            <Button
              size='sm'
              variant='ghost'
              disabled={
                timeline.busy ||
                historyOffset + 200 >= (timeline.data?.total ?? 0)
              }
              onClick={() => setHistoryOffset((v) => v + 200)}
            >
              Older 200
            </Button>
            <Button
              size='sm'
              variant='ghost'
              disabled={timeline.busy || historyOffset === 0}
              onClick={() =>
                setHistoryOffset((v) => Math.max(0, v - 200))
              }
            >
              Newer 200
            </Button>
          </div>
        </div>
      </Card>
      <Card className='min-w-0 gap-3 p-4'>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <div>
            <h2 className='font-semibold'>
              {selected
                ? 'Pinned sample inspection'
                : saved
                  ? 'Saved sample inspection'
                  : 'Current sample inspection'}
            </h2>
            <p className='text-xs text-muted-foreground'>
              {inspected
                ? `#${inspected.id} · ${time(inspected.received_at)} · ${inspected.quality}`
                : 'No sample yet'}
              {selected && !saved
                ? ' · summary above remains live; inspect latest to update these rows'
                : ''}
            </p>
          </div>
          {inspected && (
            <Badge variant='outline'>{inspected.endpoint}</Badge>
          )}
        </div>
        {inspected?.warnings.map((warning) => (
          <p
            key={warning}
            className='rounded-md bg-amber-500/10 p-2 text-xs'
          >
            {warning}
          </p>
        ))}
        {inspected && !validInspection && (
          <p className='text-sm text-muted-foreground'>
            No connection state was sampled at this point. Select a
            valid point; previous state is not carried across this
            gap.
          </p>
        )}
        <Tabs.Root
          value={tab}
          onValueChange={(value) => {
            setTab(value);
            setFilter('all');
          }}
          className='min-w-0'
        >
          <Tabs.List
            aria-label='Snapshot views'
            className='mb-4 flex flex-wrap gap-1 rounded-lg border bg-muted/40 p-1'
          >
            {[
              ['connections', 'Connections'],
              ['clients', 'Top Clients'],
              ['destinations', 'Destinations'],
              ['diagnostics', 'Diagnostics'],
            ].map(([value, label]) => (
              <Tabs.Trigger
                key={value}
                value={value}
                className='rounded-md px-3 py-2 text-sm text-muted-foreground data-[state=active]:bg-background data-[state=active]:text-foreground'
              >
                {label}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          <div className='mb-3 flex flex-wrap items-center gap-2'>
            <input
              aria-label='Search client, server, application or protocol'
              placeholder='Search client, destination, application…'
              className={`${INPUT} w-72 max-w-full`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <details className='text-sm'>
              <summary className='cursor-pointer text-muted-foreground'>
                Filters & order
              </summary>
              <div className='mt-2 flex flex-wrap gap-2'>
                <select
                  aria-label='Connection order'
                  className={INPUT}
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                >
                  <option value='session'>Session / member</option>
                  <option value='client'>Client</option>
                  <option value='server'>Destination</option>
                  <option value='duration'>Longest duration</option>
                </select>
                <select
                  aria-label='Diagnostic filter'
                  className={INPUT}
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value='all'>All members</option>
                  <option value='long'>Duration &gt; 1 hour</option>
                  <option value='legs'>
                    Client active / server inactive
                  </option>
                  <option value='errors'>
                    Connection error code
                  </option>
                </select>
              </div>
            </details>
          </div>
          {tab === 'diagnostics' && (
            <div className='mb-4 grid gap-3 text-xs md:grid-cols-2'>
              <div className='space-y-2 rounded-lg border p-3'>
                <h3 className='font-medium'>Poll quality</h3>
                <p>
                  Received:{' '}
                  {inspected ? time(inspected.received_at) : '—'}
                </p>
                <p>
                  Device time (raw): {display(inspected?.device_time)}
                </p>
                <p>
                  Clock skew:{' '}
                  {inspected?.clock_skew_ms == null
                    ? 'Unknown (timestamp not recognized)'
                    : `${number(inspected.clock_skew_ms)} ms (includes response latency)`}
                </p>
                <p>
                  Response:{' '}
                  {formatBytes(inspected?.response_bytes ?? 0)} · poll{' '}
                  {number(inspected?.duration_ms)} ms
                </p>
                <p>
                  Parsed / reported:{' '}
                  {number(inspected?.parsed_sessions)} /{' '}
                  {number(inspected?.sessions)} sessions;{' '}
                  {number(inspected?.parsed_connections)} /{' '}
                  {number(inspected?.connections)} members
                </p>
                <p>Route: {inspected?.endpoint ?? '—'}</p>
                <p>Polling mode: {pollingLabel(saved?.interval ?? status?.interval ?? interval)}</p>
              </div>
              <div className='space-y-2 rounded-lg border p-3'>
                <h3 className='font-medium'>Interpretation limits</h3>
                <p>
                  Long-lived threshold: 1 hour. Use filters to inspect
                  matching members.
                </p>
                <p>
                  ICAPREQMOD/RESPMOD and
                  ObjectCache/Latency/BandwidthManagement are raw
                  status codes. Open a member to inspect them; no ICAP
                  duration is available.
                </p>
                <p>
                  Counter resets, inferred closures and transfer rates
                  are not calculated in this cut. Bytes are cumulative
                  by side, never upload/download.
                </p>
                <p>
                  Failed samples are gaps. Snapshot count is not
                  request count. Identical content still records a new
                  time point.
                </p>
              </div>
              <details className='min-w-0 rounded-lg border p-3 md:col-span-2'>
                <summary className='cursor-pointer'>
                  Device, Stats, totals and unexpected metadata
                  (serial masked)
                </summary>
                <pre className='mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all'>
                  {metadata.busy
                    ? 'Loading…'
                    : JSON.stringify(
                        metadata.data?.raw ?? null,
                        null,
                        2,
                      )}
                </pre>
              </details>
            </div>
          )}
          {tab === 'clients' || tab === 'destinations' ? (
            <>
              <p className='mb-3 text-xs text-muted-foreground'>
                Counts of observed members in this snapshot, including
                Secondary. Active refers to client leg. No summed
                snapshot bytes or period throughput.
              </p>
              <div className='overflow-x-auto'>
                <table className='w-full text-left text-sm'>
                  <thead className='text-xs text-muted-foreground'>
                    <tr>
                      <th className='p-2'>
                        {tab === 'clients' ? 'Client' : 'Destination'}
                      </th>
                      <th className='p-2'><TooltipOne content='Connections observed for this client or destination in this snapshot, including Primary and Secondary members.' classNameContent='max-w-72'><button type='button' className='rounded underline decoration-dotted underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring'>Connections observed</button></TooltipOne></th>
                      <th className='p-2'><TooltipOne content='Primary connections for this client or destination in this snapshot; a subset of Connections observed.' classNameContent='max-w-72'><button type='button' className='rounded underline decoration-dotted underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring'>Primary connections</button></TooltipOne></th>
                      <th className='p-2'><TooltipOne content='Connections with the client-side Active flag in this snapshot. This does not describe the whole connection. Counts overlap with Primary connections; do not add these totals.' classNameContent='max-w-72'><button type='button' className='rounded underline decoration-dotted underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring'>Client-side active</button></TooltipOne></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.data?.items.map((row, i) => (
                      <tr
                        key={`${row.name}:${i}`}
                        className='border-t'
                      >
                        <td className='p-2 font-mono text-xs'>
                          {display(row.name)}
                        </td>
                        <td className='p-2'>
                          {number(row.observed_members)}
                        </td>
                        <td className='p-2'>
                          {number(row.primary_members)}
                        </td>
                        <td className='p-2'>
                          {number(row.active_client_legs)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className='max-h-[540px] overflow-auto'>
              <p className='mb-2 text-xs text-muted-foreground'>
                Expand a Primary row to show its Secondary members on
                this page. Pages can split a session; the S number
                preserves grouping.
              </p>
              <table className='w-full min-w-[780px] text-left text-sm'>
                <thead className='sticky top-0 z-10 bg-card text-xs text-muted-foreground'>
                  <tr>
                    {[
                      'Session / member',
                      'Client',
                      'Destination',
                      'Application / protocol',
                      'Client / server active',
                      'Duration',
                      'Detail',
                    ].map((label) => (
                      <th key={label} className='p-2 font-medium'>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.data?.items
                    .filter(
                      (row) =>
                        row.kind !== 'Secondary' ||
                        !collapsedSessions.has(row.session),
                    )
                    .map((row) => (
                      <tr
                        key={row.id}
                        className={`border-t hover:bg-accent/30 ${row.kind === 'Secondary' ? 'bg-muted/20' : ''}`}
                      >
                        <td className='p-2'>
                          {row.kind === 'Primary' ? (
                            <button
                              type='button'
                              aria-expanded={
                                !collapsedSessions.has(row.session)
                              }
                              className='rounded text-left font-medium focus-visible:ring-2 focus-visible:ring-ring'
                              onClick={() =>
                                setCollapsedSessions((previous) => {
                                  const next = new Set(previous);
                                  if (next.has(row.session))
                                    next.delete(row.session);
                                  else next.add(row.session);
                                  return next;
                                })
                              }
                            >
                              {collapsedSessions.has(row.session)
                                ? '▸'
                                : '▾'}{' '}
                              S{row.session + 1} · {display(row.kind)}
                            </button>
                          ) : (
                            <span className='pl-3 text-muted-foreground'>
                              ↳ S{row.session + 1} ·{' '}
                              {display(row.kind)}
                            </span>
                          )}
                          {row.ambiguous && (
                            <span className='block text-xs text-amber-600'>
                              Ambiguous identity
                            </span>
                          )}
                        </td>
                        <td className='p-2 font-mono text-xs'>
                          {display(row.client)}
                        </td>
                        <td className='p-2 font-mono text-xs'>
                          {display(row.server)}
                        </td>
                        <td className='p-2 text-xs'>
                          {classified(row.application)}
                          <span className='block text-muted-foreground'>
                            {display(row.protocol)}
                          </span>
                        </td>
                        <td className='p-2 font-mono text-xs'>
                          {display(row.client_active)} /{' '}
                          {display(row.server_active)}
                        </td>
                        <td className='p-2 tabular-nums text-xs'>
                          {formatDuration(row.duration)}
                        </td>
                        <td className='p-2'>
                          <Button
                            size='sm'
                            variant='ghost'
                            aria-label={`Inspect session ${row.session + 1} member ${row.ordinal + 1}`}
                            onClick={() => {
                              if (inspected) setSelected(inspected);
                              setDetailId(row.id);
                            }}
                          >
                            Inspect
                          </Button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
          {!rows.busy && !rows.data?.items.length && (
            <p className='p-6 text-center text-sm text-muted-foreground'>
              {validInspection
                ? 'No members match this view.'
                : 'Choose a valid snapshot to inspect connections.'}
            </p>
          )}
          <div
            className='mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground'
            aria-live='polite'
          >
            <span>
              {rows.busy
                ? 'Reading indexed page…'
                : `${rows.data?.total ? number(page * pageSize + 1) : 0}–${number(Math.min((page + 1) * pageSize, rows.data?.total ?? 0))} of ${number(rows.data?.total ?? 0)} · Page ${page + 1} of ${Math.max(1, Math.ceil((rows.data?.total ?? 0) / pageSize))}`}
            </span>
            <div className='flex flex-wrap items-center gap-2'>
              <label className='flex items-center gap-2'>Rows per page
                <select aria-label='Rows per page' className={INPUT} value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
                  {[10, 20, 30, 50].map((size) => <option key={size} value={size}>{size}</option>)}
                </select>
              </label>
              <Button
                size='sm'
                variant='outline'
                disabled={rows.busy || page === 0}
                onClick={() => setPage((v) => v - 1)}
              >
                Previous
              </Button>
              <Button
                size='sm'
                variant='outline'
                disabled={
                  rows.busy ||
                  (page + 1) * pageSize >= (rows.data?.total ?? 0)
                }
                onClick={() => setPage((v) => v + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </Tabs.Root>
      </Card>
      <Dialog open={visible && libraryOpen} onOpenChange={setLibraryOpen}>
        <DialogContent className='max-h-[85vh] overflow-auto sm:max-w-xl'>
          <DialogTitle>Saved Active Connections</DialogTitle>
          <DialogDescription>
            Only captures for {scope.proxy} · {scope.profile}. Opening
            uses SQLite only.
          </DialogDescription>
          {libraryBusy ? (
            <p>Reading library…</p>
          ) : !library.length ? (
            <p className='text-sm text-muted-foreground'>
              No saved captures for this proxy/profile.
            </p>
          ) : (
            library.map((entry) => (
              <button
                type='button'
                key={entry.id}
                className='rounded-lg border p-3 text-left text-sm hover:bg-accent'
                onClick={() => {
                  setSaved(entry);
                  resetView();
                  setLibraryOpen(false);
                }}
              >
                <span className='block font-medium'>
                  {time(entry.started)}
                </span>
                <span className='text-xs text-muted-foreground'>
                  {entry.ended
                    ? `Stopped ${time(entry.ended)}`
                    : 'Open capture'}{' '}
                  · {pollingLabel(entry.interval)} · {entry.route}
                </span>
              </button>
            ))
          )}
          <DialogClose asChild>
            <Button variant='outline'>Close</Button>
          </DialogClose>
        </DialogContent>
      </Dialog>
      <Dialog
        open={visible && !!detailId}
        onOpenChange={(open) => {
          if (!open) setDetailId('');
        }}
      >
        <DialogContent className='max-h-[90vh] overflow-auto sm:max-w-3xl'>
          <div className='flex items-center justify-between gap-3'>
            <DialogTitle>
              Connection · exact sampled state
            </DialogTitle>
            <DialogClose asChild>
              <Button
                size='icon'
                variant='ghost'
                aria-label='Close connection details'
              >
                <X />
              </Button>
            </DialogClose>
          </div>
          <DialogDescription>
            Sample #{inspected?.id}. Missing and empty are distinct.
            Status codes have no verified numeric interpretation.
          </DialogDescription>
          {detail.error && <p role='alert'>{detail.error}</p>}
          {detail.busy ? (
            <p>Reading member…</p>
          ) : (
            detail.data && (
              <ConnectionFields detail={detail.data} time={time} />
            )
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}

function ConnectionFields({
  detail,
  time,
}: {
  detail: ConnectionDetail;
  time: (value: number) => string;
}) {
  return (
    <div className='min-w-0 space-y-3 text-xs'>
      <p className='text-muted-foreground'>
        First observed {time(detail.first_observed_at)} (sample #
        {detail.first_observed_sample}); last observed{' '}
        {time(detail.last_observed_at)} (sample #
        {detail.last_observed_sample}). These are observation bounds,
        not appliance StartTime/EndTime.
        {detail.ambiguous
          ? ' Identity is ambiguous; bounds are local to this observation.'
          : ' Identity is best-effort.'}
      </p>
      <div className='grid grid-cols-2 gap-2 rounded-lg border p-3'>
        <span>Connection.Type: {display(detail.raw.attrs.Type)}</span>
        <span>
          Connection.Error: {display(detail.raw.attrs.Error)}
        </span>
      </div>
      {Object.entries(XML_FIELDS).map(([group, fields]) => (
        <section
          key={group}
          className='overflow-hidden rounded-lg border'
        >
          <h3 className='bg-muted/40 px-3 py-2 font-semibold'>
            {group}
            {['ICAPREQMOD', 'ICAPRESPMOD', 'Acceleration'].includes(
              group,
            )
              ? ' · raw codes, not timings'
              : ''}
            {group === 'Client' || group === 'Server'
              ? ' · bytes are bidirectional on this side'
              : ''}
          </h3>
          <dl className='grid gap-x-4 gap-y-2 p-3 sm:grid-cols-2'>
            {fields.map((key) => {
              const value = xmlValue(detail.raw, group, key);
              return (
                <div key={key} className='min-w-0'>
                  <dt className='text-muted-foreground'>{key}</dt>
                  <dd className='break-all font-mono'>
                    {value == null
                      ? '(missing)'
                      : value === ''
                        ? '(empty string)'
                        : key === 'Seconds' && ['Age', 'Duration'].includes(group)
                          ? formatDuration(Number(value)) : value}
                  </dd>
                </div>
              );
            })}
          </dl>
        </section>
      ))}
      <details className='rounded-lg border p-3'>
        <summary className='cursor-pointer'>
          Complete structured XML fields, including unexpected
          attributes
        </summary>
        <pre className='mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-all'>
          {JSON.stringify(detail.raw, null, 2)}
        </pre>
      </details>
    </div>
  );
}
