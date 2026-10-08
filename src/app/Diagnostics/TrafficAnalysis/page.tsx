'use client';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  Activity,
  ArrowLeft,
  BarChart3,
  CircleAlert,
  FileUp,
  Radio,
  ShieldAlert,
  Users,
  Wifi,
} from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  bytesOf,
  createTrafficTimeFormatter,
  destinationOf,
  evaluateRecord,
  fieldValue,
  formatBytes,
  mergeDataset,
  ranked,
  totalBytes,
  timelineOf,
  trafficTimelineBins,
  trafficTimeZones,
  utcTrafficEpoch,
  type TrafficDataset,
  type TrafficProcessingConfig,
} from '@/lib/trafficAnalysis';

type Mode = 'static' | 'live';
type ParseProgress = {
  fileName: string;
  totalBytes: number;
  loadedBytes: number;
  records: number;
  fields: number;
  malformed: number;
  stage: 'starting' | 'reading' | 'complete' | 'error';
  error?: string;
};
const SELECT = 'h-9 rounded-md border bg-background px-3 text-sm';
function Page() {
  return (
    <Suspense
      fallback={
        <main className='p-8 text-muted-foreground'>
          Loading traffic analysis…
        </main>
      }
    >
      <TrafficAnalysis />
    </Suspense>
  );
}
export default Page;

function TrafficAnalysis() {
  const params = useSearchParams();
  const proxy = params.get('proxy') || '';
  const [mode, setMode] = useState<Mode>('static');
  const [dataset, setDataset] = useState<TrafficDataset | null>(null);
  const [busy, setBusy] = useState(false);
  const [parseProgress, setParseProgress] =
    useState<ParseProgress | null>(null);
  const [processingConfig, setProcessingConfig] =
    useState<TrafficProcessingConfig | null>(null);
  const [workerChoice, setWorkerChoice] = useState(0);
  const [timeZone, setTimeZone] = useState('UTC');
  const [timeZones, setTimeZones] = useState(['UTC']);
  const parseSessionRef = useRef<string | null>(null);
  const [saveReady, setSaveReady] = useState(false);
  const [archives, setArchives] = useState<
    {
      id: string;
      source: string;
      records: number;
      savedAt: string;
      path: string;
    }[]
  >([]);
  const refreshArchives = useCallback(async () => {
    setArchives(await invoke('list_traffic_analyses'));
  }, []);
  useEffect(() => {
    void refreshArchives().catch((error) =>
      toast.error(`Could not list saved analyses: ${String(error)}`),
    );
  }, [refreshArchives]);
  const discardPending = async () => {
    if (parseSessionRef.current) {
      await invoke('abort_access_log_parse', {
        parseId: parseSessionRef.current,
      });
      parseSessionRef.current = null;
    }
    setSaveReady(false);
  };
  const saveProcessed = async () => {
    if (!parseSessionRef.current || busy) return;
    setBusy(true);
    try {
      const path = await invoke<string>('save_traffic_analysis', {
        parseId: parseSessionRef.current,
      });
      setSaveReady(false);
      await refreshArchives();
      toast.success('Processed log saved locally.', {
        description: path,
      });
    } catch (error) {
      toast.error(`Could not save processed log: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };
  const loadProcessed = async (id: string) => {
    if (!id || busy) return;
    setBusy(true);
    try {
      const next = await invoke<TrafficDataset>(
        'load_traffic_analysis',
        { id },
      );
      await discardPending();
      setMode('static');
      setDataset(next);
      setParseProgress(null);
      toast.success(
        `Loaded ${next.recordsProcessed.toLocaleString()} processed records without parsing the source log.`,
      );
    } catch (error) {
      toast.error(`Could not load processed log: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };
  const formatTime = useMemo(
    () => createTrafficTimeFormatter(timeZone),
    [timeZone],
  );
  useEffect(() => {
    const zones = trafficTimeZones();
    setTimeZones(zones);
    try {
      const savedZone = localStorage.getItem(
        'traffic-analysis-timezone',
      );
      if (savedZone && zones.includes(savedZone))
        setTimeZone(savedZone);
      const savedWorkers = Number(
        localStorage.getItem('traffic-analysis-workers'),
      );
      if (
        Number.isInteger(savedWorkers) &&
        savedWorkers >= 0 &&
        savedWorkers <= 16
      )
        setWorkerChoice(savedWorkers);
    } catch {
      /* Preferences remain usable when browser storage is unavailable. */
    }
    void invoke<TrafficProcessingConfig>(
      'get_traffic_processing_config',
    )
      .then((config) => {
        setProcessingConfig(config);
        setWorkerChoice((current) =>
          current > config.maxWorkers ? 0 : current,
        );
      })
      .catch((error) =>
        console.error(
          '[Traffic Analysis] Hardware detection failed',
          error,
        ),
      );
    return () => {
      if (parseSessionRef.current)
        void invoke('abort_access_log_parse', {
          parseId: parseSessionRef.current,
        }).catch(() => {});
    };
  }, []);
  const [tab, setTab] = useState('Overview');
  const [limit, setLimit] = useState(10);
  const [metric, setMetric] = useState<'requests' | 'bytes'>(
    'requests',
  );
  const [filters, setFilters] = useState({
    search: '',
    client: '',
    user: '',
    host: '',
    threat: '',
    method: '',
    range: 'all',
    category: '',
    action: '',
    status: '',
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const loadSample = useCallback(async () => {
    setBusy(true);
    try {
      if (parseSessionRef.current) {
        await invoke('abort_access_log_parse', {
          parseId: parseSessionRef.current,
        });
        parseSessionRef.current = null;
      }
      setSaveReady(false);
      const content = await invoke<string>('get_mock_access_log');
      const next = await invoke<TrafficDataset>('parse_access_log', {
        content,
        source: 'mock-static',
      });
      setDataset(next);
      setParseProgress(null);
    } catch (error) {
      console.error('[Traffic Analysis] Sample parse failed', error);
      toast.error(`Could not parse sample log: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  }, []);
  const loadFile = async (file?: File) => {
    if (!file || busy) return;
    let parseId: string | undefined;
    setBusy(true);
    setDataset(null);
    setMode('static');
    setParseProgress({
      fileName: file.name,
      totalBytes: file.size,
      loadedBytes: 0,
      records: 0,
      fields: 0,
      malformed: 0,
      stage: 'starting',
    });
    console.info('[Traffic Analysis] Static log parse started', {
      fileName: file.name,
      sizeBytes: file.size,
      size: formatBytes(file.size),
    });
    let offset = 0;
    let finalDataset: TrafficDataset | null = null;
    try {
      await discardPending();
      const config =
        processingConfig ??
        (await invoke<TrafficProcessingConfig>(
          'get_traffic_processing_config',
        ));
      setProcessingConfig(config);
      const workers =
        workerChoice === 0
          ? config.recommendedWorkers
          : Math.min(workerChoice, config.maxWorkers);
      const chunkSize = config.chunkBytes;
      parseId = await invoke<string>('start_access_log_parse', {
        source: file.name,
        workers,
      });
      parseSessionRef.current = parseId;
      console.info('[Traffic Analysis] Processing pipeline', {
        workers,
        logicalCpus: config.logicalCpus,
        chunkSize,
        prefetchedBlocks: 1,
      });
      const decoder = new TextDecoder('utf-8');
      const readBlock = (start: number, end: number) =>
        file
          .slice(start, end)
          .arrayBuffer()
          .then(
            (buffer) => ({ ok: true as const, buffer }),
            (error) => ({ ok: false as const, error }),
          );
      let prefetched = readBlock(0, Math.min(chunkSize, file.size));
      let accumulated: TrafficDataset | null = null;
      let lastPaint = 0;
      do {
        const nextOffset = Math.min(offset + chunkSize, file.size);
        const isFinal = nextOffset >= file.size;
        const read = await prefetched;
        if (read.ok === false) throw read.error;
        // Overlap disk I/O with native parsing, keeping only one block ahead in memory.
        if (!isFinal)
          prefetched = readBlock(
            nextOffset,
            Math.min(nextOffset + chunkSize, file.size),
          );
        const chunk = decoder.decode(read.buffer, {
          stream: !isFinal,
        });
        const next = await invoke<TrafficDataset>(
          'append_access_log_parse_chunk',
          { parseId, chunk, isFinal },
        );
        finalDataset = next;
        accumulated = mergeDataset(accumulated, next);
        offset = nextOffset;
        const progress: ParseProgress = {
          fileName: file.name,
          totalBytes: file.size,
          loadedBytes: offset,
          records: next.recordsProcessed,
          fields: next.fields.length,
          malformed: next.diagnosticsTotal,
          stage: isFinal ? 'complete' : 'reading',
        };
        if (isFinal || performance.now() - lastPaint >= 500) {
          setDataset(accumulated);
          setParseProgress(progress);
          lastPaint = performance.now();
        }
        if (isFinal || offset % (32 * 1024 * 1024) < chunkSize)
          console.info('[Traffic Analysis] Static log progress', {
            fileName: file.name,
            percent: file.size
              ? Math.floor((offset / file.size) * 100)
              : 100,
            loadedBytes: offset,
            records: next.recordsProcessed,
            fields: next.fields.length,
            malformed: next.diagnosticsTotal,
          });
        if (isFinal) break;
      } while (offset < file.size);
      toast.success(
        `Parsed ${file.name}: ${finalDataset?.recordsProcessed ?? 0} records processed.`,
      );
      setSaveReady(true);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      console.error('[Traffic Analysis] Static log parse failed', {
        fileName: file.name,
        loadedBytes: offset,
        error,
      });
      if (parseId)
        await invoke('abort_access_log_parse', { parseId }).catch(
          () => {},
        );
      parseSessionRef.current = null;
      setParseProgress((current) =>
        current
          ? { ...current, stage: 'error', error: message }
          : null,
      );
      toast.error(`Could not analyze ${file.name}: ${message}`);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  useEffect(() => {
    if (mode !== 'live') return;
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;
    const streamId = proxy || 'unselected';
    void (async () => {
      unlisten = await listen<[string, TrafficDataset]>(
        'traffic-analysis:update',
        (event) => {
          const [id, incoming] = event.payload;
          if (id === streamId)
            setDataset((current) => mergeDataset(current, incoming));
        },
      );
      if (!cancelled) {
        setDataset(null);
        await invoke('start_mock_traffic_stream', { streamId });
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
      void invoke('stop_mock_traffic_stream', { streamId }).catch(
        () => {},
      );
    };
  }, [mode, proxy]);
  const records = dataset?.records ?? [];
  const referenceTime =
    mode === 'live'
      ? Date.now()
      : records.reduce((latest, record) => {
          const epoch = utcTrafficEpoch(record.timestamp);
          return Number.isFinite(epoch)
            ? Math.max(latest, epoch)
            : latest;
        }, 0);
  const filtered = useMemo(
    () =>
      records.filter((record) => {
        const blob =
          `${fieldValue(record, 'c-ip')} ${fieldValue(record, 'cs-username')} ${destinationOf(record)} ${Object.values(
            record.rawFields,
          )
            .map((v) => v.value ?? '')
            .join(' ')}`.toLowerCase();
        const timestamp = utcTrafficEpoch(record.timestamp);
        const age = Number.isFinite(timestamp)
          ? referenceTime - timestamp
          : Infinity;
        const rangeMs =
          filters.range === '15m'
            ? 900000
            : filters.range === '1h'
              ? 3600000
              : filters.range === '6h'
                ? 21600000
                : filters.range === '24h'
                  ? 86400000
                  : Infinity;
        return (
          (!filters.search ||
            blob.includes(filters.search.toLowerCase())) &&
          (!filters.client ||
            fieldValue(record, 'c-ip')
              .toLowerCase()
              .includes(filters.client.toLowerCase())) &&
          (!filters.user ||
            fieldValue(record, 'cs-username')
              .toLowerCase()
              .includes(filters.user.toLowerCase())) &&
          (!filters.host ||
            destinationOf(record)
              .toLowerCase()
              .includes(filters.host.toLowerCase())) &&
          (!filters.threat ||
            `${fieldValue(record, 'cs-threat-risk')} ${fieldValue(record, 'cs-threat-id')} ${fieldValue(record, 'x-virus-id')}`
              .toLowerCase()
              .includes(filters.threat.toLowerCase())) &&
          (!filters.method ||
            fieldValue(record, 'cs-method') === filters.method) &&
          (filters.range === 'all' || age <= rangeMs) &&
          (!filters.category ||
            fieldValue(record, 'cs-categories').includes(
              filters.category,
            )) &&
          (!filters.action ||
            fieldValue(record, 's-action') === filters.action) &&
          (!filters.status ||
            fieldValue(record, 'sc-status') === filters.status)
        );
      }),
    [records, filters, referenceTime],
  );
  const hasActiveFilters =
    filters.search !== '' ||
    filters.client !== '' ||
    filters.user !== '' ||
    filters.host !== '' ||
    filters.threat !== '' ||
    filters.method !== '' ||
    filters.range !== 'all' ||
    filters.category !== '' ||
    filters.action !== '' ||
    filters.status !== '';
  const retainedBytes = totalBytes(filtered);
  const bytes = hasActiveFilters
    ? retainedBytes
    : (dataset?.bytesProcessed ?? retainedBytes);
  const displayedRequests = hasActiveFilters
    ? filtered.length
    : (dataset?.recordsProcessed ?? filtered.length);
  const errors = filtered.filter((r) => evaluateRecord(r).length > 0);
  const unique = (key: string) =>
    new Set(filtered.map((r) => fieldValue(r, key)).filter(Boolean))
      .size;
  const rankedData = (key: string) =>
    ranked(filtered, key, limit, metric);
  const fieldStatus = (name: string) =>
    dataset?.fieldAvailability.find((f) => f.name === name)?.status ??
    'not-in-log';
  const chart = useMemo(() => {
    const timeline =
      !hasActiveFilters && dataset
        ? dataset.timeline
        : timelineOf(filtered);
    const bins = trafficTimelineBins(timeline, metric, formatTime);
    const total =
      !hasActiveFilters && dataset
        ? metric === 'requests'
          ? dataset.recordsProcessed
          : dataset.bytesProcessed
        : metric === 'requests'
          ? filtered.length
          : totalBytes(filtered);
    const unknown =
      total - timeline.reduce((sum, item) => sum + item[metric], 0);
    if (unknown > 0) bins.push(['Unknown time', unknown]);
    return bins;
  }, [filtered, metric, formatTime, dataset, hasActiveFilters]);
  const peak = chart.reduce(
    (best, item) => (item[1] > best[1] ? item : best),
    ['', 0] as [string, number],
  );
  const timed = filtered
    .map((record) => utcTrafficEpoch(record.timestamp))
    .filter(Number.isFinite);
  const durationSeconds =
    timed.length > 1
      ? Math.max(1, (Math.max(...timed) - Math.min(...timed)) / 1000)
      : 1;
  const requestRate = filtered.length / durationSeconds;
  const throughput = retainedBytes / durationSeconds;
  const filterOptions = useMemo(
    () => ({
      categories: [
        ...new Set(
          records.flatMap((r) =>
            fieldValue(r, 'cs-categories').split(';').filter(Boolean),
          ),
        ),
      ].sort(),
      actions: [
        ...new Set(
          records
            .map((r) => fieldValue(r, 's-action'))
            .filter(Boolean),
        ),
      ].sort(),
      statuses: [
        ...new Set(
          records
            .map((r) => fieldValue(r, 'sc-status'))
            .filter(Boolean),
        ),
      ].sort(),
      methods: [
        ...new Set(
          records
            .map((r) => fieldValue(r, 'cs-method'))
            .filter(Boolean),
        ),
      ].sort(),
    }),
    [records],
  );
  return (
    <main className='mx-auto flex h-dvh max-w-[1600px] flex-col gap-5 overflow-hidden px-4 py-5 md:px-7'>
      <header className='flex shrink-0 flex-wrap items-center justify-between gap-4 border-b pb-4'>
        <div>
          <Link
            href={{ pathname: '/Diagnostics', query: { proxy } }}
            className='mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground'
          >
            <ArrowLeft className='size-4' /> Proxy diagnostics
          </Link>
          <div className='flex items-center gap-3'>
            <span className='rounded-xl bg-primary/10 p-2 text-primary'>
              <Activity className='size-5' />
            </span>
            <div>
              <h1 className='text-2xl font-bold tracking-tight'>
                Traffic Analysis
              </h1>
              <p className='text-sm text-muted-foreground'>
                {proxy || 'No proxy selected'} · ELFF access log
                observability
              </p>
            </div>
          </div>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          <Badge variant='outline' className='gap-1'>
            <Wifi className='size-3' />
            {mode === 'live' ? 'Mock live stream' : 'Static log'}
          </Badge>
          <Button
            variant={mode === 'static' ? 'default' : 'outline'}
            size='sm'
            disabled={busy}
            onClick={() => setMode('static')}
          >
            <FileUp className='size-4' />
            Static Log
          </Button>
          <Button
            variant={mode === 'live' ? 'default' : 'outline'}
            size='sm'
            disabled={busy}
            onClick={() => setMode('live')}
          >
            <Radio className='size-4' />
            Live Stream
          </Button>
          <input
            ref={fileRef}
            hidden
            type='file'
            accept='.log,.txt,.accesslog,*/*'
            onChange={(e) => void loadFile(e.target.files?.[0])}
          />
          {mode === 'static' && (
            <>
              <Button
                size='sm'
                variant='outline'
                disabled={busy || !saveReady}
                onClick={() => void saveProcessed()}
              >
                Save processed log
              </Button>
              <select
                className={SELECT}
                value=''
                disabled={busy || !archives.length}
                aria-label='Load saved processed log'
                onChange={(event) =>
                  void loadProcessed(event.target.value)
                }
              >
                <option value=''>
                  Load saved analysis ({archives.length})
                </option>
                {archives.map((archive) => (
                  <option key={archive.id} value={archive.id}>
                    {archive.source} ·{' '}
                    {archive.records.toLocaleString()} records ·{' '}
                    {new Date(archive.savedAt).toLocaleString()}
                  </option>
                ))}
              </select>
              <Button
                size='sm'
                variant='outline'
                disabled={busy}
                onClick={() => {
                  void invoke<string>('get_mock_access_log', {
                    chart: true,
                  })
                    .then((content) =>
                      loadFile(
                        new File([content], 'chart-sample.log'),
                      ),
                    )
                    .catch((error) => toast.error(String(error)));
                }}
              >
                Chart test sample
              </Button>
              <Button
                size='sm'
                variant='outline'
                disabled={busy}
                onClick={() => fileRef.current?.click()}
              >
                Upload log
              </Button>
              <Button
                size='sm'
                variant='outline'
                disabled={busy}
                onClick={() => void loadSample()}
              >
                {busy ? 'Loading…' : 'Load sample'}
              </Button>
            </>
          )}
        </div>
      </header>
      {parseProgress && (
        <Card className='shrink-0 gap-3 py-3'>
          <CardContent className='space-y-2 px-4'>
            <div className='flex flex-wrap items-center justify-between gap-2 text-sm'>
              <span className='font-medium'>
                {parseProgress.stage === 'complete'
                  ? 'Static log parsed'
                  : parseProgress.stage === 'error'
                    ? 'Static log parsing failed'
                    : 'Reading and parsing file'}{' '}
                · {parseProgress.fileName}
              </span>
              <span className='text-muted-foreground'>
                {parseProgress.totalBytes
                  ? Math.min(
                      100,
                      Math.floor(
                        (parseProgress.loadedBytes /
                          parseProgress.totalBytes) *
                          100,
                      ),
                    )
                  : parseProgress.stage === 'complete'
                    ? 100
                    : 0}
                % · {formatBytes(parseProgress.loadedBytes)} /{' '}
                {formatBytes(parseProgress.totalBytes)} ·{' '}
                {parseProgress.records.toLocaleString()} records ·{' '}
                {parseProgress.fields} fields ·{' '}
                {parseProgress.malformed} malformed
              </span>
            </div>
            <div className='h-2 overflow-hidden rounded-full bg-muted'>
              <div
                className={`h-full transition-[width] ${parseProgress.stage === 'error' ? 'bg-destructive' : 'bg-primary'}`}
                style={{
                  width: `${parseProgress.totalBytes ? Math.min(100, (parseProgress.loadedBytes / parseProgress.totalBytes) * 100) : parseProgress.stage === 'complete' ? 100 : 0}%`,
                }}
              />
            </div>
            {parseProgress.error && (
              <p className='text-sm text-destructive'>
                {parseProgress.error}
              </p>
            )}
            {parseProgress.stage === 'complete' &&
              parseProgress.records > 5000 && (
                <p className='text-xs text-muted-foreground'>
                  File-wide request and byte totals include all parsed
                  rows. The unfiltered timeline covers the complete
                  file. Interactive filters, rankings, and the record
                  table use the latest 5,000 rows retained for
                  detailed analysis.
                </p>
              )}
          </CardContent>
        </Card>
      )}
      <section className='grid shrink-0 gap-2 rounded-xl border bg-card p-3 md:grid-cols-4 xl:grid-cols-8'>
        <span className='flex items-center text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
          Filters
        </span>
        <select
          aria-label='Time range'
          className={SELECT}
          value={filters.range}
          onChange={(e) =>
            setFilters({ ...filters, range: e.target.value })
          }
        >
          <option value='all'>All time</option>
          <option value='15m'>Last 15 minutes</option>
          <option value='1h'>Last hour</option>
          <option value='6h'>Last 6 hours</option>
          <option value='24h'>Last 24 hours</option>
        </select>
        <input
          aria-label='Search logs'
          className='h-9 rounded-md border bg-background px-3 text-sm'
          placeholder='Search all fields'
          value={filters.search}
          onChange={(e) =>
            setFilters({ ...filters, search: e.target.value })
          }
        />
        <input
          aria-label='Client IP filter'
          className='h-9 rounded-md border bg-background px-3 text-sm'
          placeholder='Client IP'
          value={filters.client}
          onChange={(e) =>
            setFilters({ ...filters, client: e.target.value })
          }
        />
        <input
          aria-label='User filter'
          className='h-9 rounded-md border bg-background px-3 text-sm'
          placeholder='User'
          value={filters.user}
          onChange={(e) =>
            setFilters({ ...filters, user: e.target.value })
          }
        />
        <input
          aria-label='Destination filter'
          className='h-9 rounded-md border bg-background px-3 text-sm'
          placeholder='Host / destination'
          value={filters.host}
          onChange={(e) =>
            setFilters({ ...filters, host: e.target.value })
          }
        />
        <select
          aria-label='Category filter'
          className={SELECT}
          value={filters.category}
          onChange={(e) =>
            setFilters({ ...filters, category: e.target.value })
          }
        >
          <option value=''>All categories</option>
          {filterOptions.categories.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
        <select
          aria-label='Action filter'
          className={SELECT}
          value={filters.action}
          onChange={(e) =>
            setFilters({ ...filters, action: e.target.value })
          }
        >
          <option value=''>All actions</option>
          {filterOptions.actions.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
        <select
          aria-label='HTTP status filter'
          className={SELECT}
          value={filters.status}
          onChange={(e) =>
            setFilters({ ...filters, status: e.target.value })
          }
        >
          <option value=''>All HTTP status</option>
          {filterOptions.statuses.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
        <select
          aria-label='Method filter'
          className={SELECT}
          value={filters.method}
          onChange={(e) =>
            setFilters({ ...filters, method: e.target.value })
          }
        >
          <option value=''>All methods</option>
          {filterOptions.methods.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
        <input
          aria-label='Threat or risk filter'
          className='h-9 rounded-md border bg-background px-3 text-sm'
          placeholder='Threat / risk'
          value={filters.threat}
          onChange={(e) =>
            setFilters({ ...filters, threat: e.target.value })
          }
        />
        <Button
          size='sm'
          variant='ghost'
          onClick={() =>
            setFilters({
              search: '',
              client: '',
              user: '',
              host: '',
              threat: '',
              method: '',
              range: 'all',
              category: '',
              action: '',
              status: '',
            })
          }
        >
          Clear
        </Button>
      </section>
      <section
        aria-label='Processing and display preferences'
        className='flex shrink-0 flex-wrap items-center gap-3 text-sm'
      >
        {mode === 'static' && (
          <>
            <label htmlFor='traffic-workers' className='font-medium'>
              Processing
            </label>
            <select
              id='traffic-workers'
              className={SELECT}
              disabled={busy}
              value={workerChoice}
              onChange={(event) => {
                const value = Number(event.target.value);
                setWorkerChoice(value);
                try {
                  localStorage.setItem(
                    'traffic-analysis-workers',
                    String(value),
                  );
                } catch {}
              }}
            >
              <option value={0}>
                Auto
                {processingConfig
                  ? ` (${processingConfig.recommendedWorkers} workers)`
                  : ''}
              </option>
              {Array.from(
                { length: processingConfig?.maxWorkers ?? 1 },
                (_, index) => index + 1,
              ).map((count) => (
                <option key={count} value={count}>
                  {count} {count === 1 ? 'worker' : 'workers'}
                </option>
              ))}
            </select>
            <span className='text-xs text-muted-foreground'>
              {processingConfig
                ? `${processingConfig.logicalCpus} logical processors detected`
                : 'Detecting hardware…'}
            </span>
          </>
        )}
        <label
          htmlFor='traffic-timezone'
          className='font-medium md:ml-auto'
        >
          Display time zone
        </label>
        <select
          id='traffic-timezone'
          className={`${SELECT} max-w-72`}
          value={timeZone}
          onChange={(event) => {
            const value = event.target.value;
            setTimeZone(value);
            try {
              localStorage.setItem(
                'traffic-analysis-timezone',
                value,
              );
            } catch {}
          }}
        >
          {timeZones.map((zone) => (
            <option value={zone} key={zone}>
              {zone.replaceAll('_', ' ')}
            </option>
          ))}
        </select>
        <span className='text-xs text-muted-foreground'>
          Log timestamps are UTC
        </span>
      </section>
      <nav className='flex shrink-0 gap-1 overflow-x-auto border-b'>
        {[
          'Overview',
          'Rankings',
          'Errors & Security',
          'Fields & Records',
        ].map((name) => (
          <button
            key={name}
            type='button'
            onClick={() => setTab(name)}
            className={`border-b-2 px-4 py-2 text-sm font-medium ${tab === name ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            {name}
          </button>
        ))}
      </nav>
      <ScrollArea className='min-h-0 flex-1'>
        <div className='space-y-5 pb-6 pr-4'>
          {!dataset ? (
            <div className='grid min-h-64 place-items-center rounded-xl border border-dashed text-center text-sm text-muted-foreground'>
              <div>
                <Activity className='mx-auto mb-3 size-8 opacity-40' />
                <p>
                  {mode === 'live'
                    ? 'Connecting to simulated live stream…'
                    : 'Load a sample access log or upload a Static Log to begin.'}
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-6'>
                {[
                  [
                    hasActiveFilters
                      ? 'Requests (retained filter)'
                      : 'Requests processed',
                    displayedRequests.toLocaleString(),
                    Activity,
                  ],
                  [
                    hasActiveFilters
                      ? 'Traffic volume (retained filter)'
                      : 'Traffic volume (file total)',
                    formatBytes(bytes),
                    BarChart3,
                  ],
                  [
                    'Requests / sec (retained)',
                    requestRate.toFixed(2),
                    Activity,
                  ],
                  [
                    'Throughput (retained)',
                    `${formatBytes(throughput)}/s`,
                    Wifi,
                  ],
                  [
                    'Detected issues (retained rows)',
                    errors.length.toLocaleString(),
                    ShieldAlert,
                  ],
                  [
                    'Unique users / clients (retained)',
                    `${unique('cs-username')} / ${unique('c-ip')}`,
                    Users,
                  ],
                ].map(([label, value, Icon]: any) => (
                  <Card key={label} className='gap-3 py-4'>
                    <CardContent className='flex items-center justify-between px-4'>
                      <div>
                        <p className='text-xs font-medium text-muted-foreground'>
                          {label}
                        </p>
                        <p className='mt-1 text-2xl font-semibold'>
                          {value}
                        </p>
                      </div>
                      <Icon className='size-5 text-muted-foreground' />
                    </CardContent>
                  </Card>
                ))}
              </div>
              {tab === 'Overview' && (
                <>
                  <div className='grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]'>
                    <Card className='gap-3 py-4'>
                      <CardHeader className='flex-row items-center justify-between px-4'>
                        <CardTitle className='text-base'>
                          {metric === 'requests'
                            ? 'Requests'
                            : 'Bytes'}{' '}
                          over time{' '}
                          <span className='ml-2 text-xs font-normal text-muted-foreground'>
                            Peak {peak[0]} ·{' '}
                            {metric === 'bytes'
                              ? formatBytes(peak[1])
                              : `${peak[1]} requests`}
                          </span>
                        </CardTitle>
                        <select
                          className='h-8 rounded border bg-background px-2 text-xs'
                          value={metric}
                          onChange={(e) =>
                            setMetric(e.target.value as any)
                          }
                        >
                          <option value='requests'>Requests</option>
                          <option value='bytes'>Bytes</option>
                        </select>
                      </CardHeader>
                      <CardContent className='px-4'>
                        <div className='flex h-48 items-end gap-1 border-b border-l px-2 pb-1'>
                          {chart.map(([time, count]) => (
                            <div
                              key={time}
                              title={`${time}: ${metric === 'bytes' ? formatBytes(count) : `${count} requests`}`}
                              className='group relative flex h-full flex-1 items-end'
                            >
                              <div
                                className='w-full min-h-1 rounded-t bg-primary/70 transition-colors group-hover:bg-primary'
                                style={{
                                  height: `${(count / Math.max(1, ...chart.map((v) => v[1]))) * 100}%`,
                                  minHeight: count > 0 ? 2 : 0,
                                }}
                              />
                            </div>
                          ))}
                        </div>
                        <div className='mt-2 flex justify-between text-[10px] text-muted-foreground'>
                          <span>{chart[0]?.[0] || '—'}</span>
                          <span>
                            {hasActiveFilters
                              ? 'Retained records'
                              : 'Complete timeline'}{' '}
                            · Equal time intervals · {timeZone}
                          </span>
                          <span>{chart.at(-1)?.[0] || '—'}</span>
                        </div>
                      </CardContent>
                    </Card>
                    <Card className='gap-3 py-4'>
                      <CardHeader className='px-4'>
                        <CardTitle className='text-base'>
                          Traffic profile
                        </CardTitle>
                      </CardHeader>
                      <CardContent className='space-y-3 px-4 text-sm'>
                        {[
                          ['Unique clients', unique('c-ip'), 'c-ip'],
                          [
                            'Unique destinations',
                            new Set(filtered.map(destinationOf)).size,
                            'cs-host',
                          ],
                          [
                            'Applications',
                            unique('x-bluecoat-application-name'),
                            'x-bluecoat-application-name',
                          ],
                          [
                            'Categories',
                            new Set(
                              filtered.flatMap((r) =>
                                fieldValue(r, 'cs-categories')
                                  .split(';')
                                  .filter(Boolean),
                              ),
                            ).size,
                            'cs-categories',
                          ],
                        ].map(([label, value, key]: any) => (
                          <div
                            key={label}
                            className='flex items-center justify-between border-b pb-2'
                          >
                            <span className='text-muted-foreground'>
                              {label}
                            </span>
                            <span className='flex items-center gap-2 font-medium'>
                              {value}
                              <span
                                className={`size-2 rounded-full ${fieldStatus(key) === 'populated' ? 'bg-emerald-500' : fieldStatus(key) === 'present-empty' ? 'bg-amber-500' : 'bg-muted'}`}
                              />
                            </span>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  </div>
                  <div className='grid gap-4 xl:grid-cols-3'>
                    {[
                      ['Top sites', 'cs-host'],
                      ['Top clients', 'c-ip'],
                      ['Top categories', 'cs-categories'],
                    ].map(([label, key]) => (
                      <RankingCard
                        key={label}
                        label={label}
                        entries={rankedData(key)}
                        metric={metric}
                        onMetric={setMetric}
                      />
                    ))}
                  </div>
                </>
              )}
              {tab === 'Rankings' && (
                <>
                  <div className='flex flex-wrap items-center justify-end gap-2'>
                    <select
                      className={SELECT}
                      value={limit}
                      onChange={(e) =>
                        setLimit(Number(e.target.value))
                      }
                    >
                      {[10, 20, 30, 50].map((n) => (
                        <option key={n} value={n}>
                          Top {n}
                        </option>
                      ))}
                    </select>
                    <select
                      className={SELECT}
                      value={metric}
                      onChange={(e) =>
                        setMetric(e.target.value as any)
                      }
                    >
                      <option value='requests'>By requests</option>
                      <option value='bytes'>By bytes</option>
                    </select>
                  </div>
                  <div className='grid gap-4 lg:grid-cols-2'>
                    {[
                      ['Sites / domains', 'cs-host'],
                      ['Users', 'cs-username'],
                      ['Clients / source IPs', 'c-ip'],
                      ['Categories', 'cs-categories'],
                      ['Applications', 'x-bluecoat-application-name'],
                      ['Actions', 's-action'],
                    ].map(([label, key]) => (
                      <RankingCard
                        key={label}
                        label={label}
                        entries={rankedData(key)}
                        metric={metric}
                      />
                    ))}
                  </div>
                </>
              )}
              {tab === 'Errors & Security' && (
                <div className='grid gap-4 xl:grid-cols-2'>
                  <Card>
                    <CardHeader>
                      <CardTitle className='text-base'>
                        Detected issues · {errors.length}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className='space-y-2'>
                      {errors.length ? (
                        errors.slice(0, 100).map((r) => (
                          <div
                            key={r.id}
                            className='flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm'
                          >
                            <span className='flex items-center gap-2'>
                              <CircleAlert className='size-4 text-amber-500' />
                              {evaluateRecord(r).join(' · ')}
                            </span>
                            <span className='text-muted-foreground'>
                              <span className='block text-xs'>
                                {formatTime(r.timestamp)}
                              </span>
                              {fieldValue(r, 'cs-username') ||
                                fieldValue(r, 'c-ip') ||
                                'Unknown'}{' '}
                              → {destinationOf(r)} ·{' '}
                              {fieldValue(r, 'sc-status') || '—'}
                            </span>
                          </div>
                        ))
                      ) : (
                        <p className='text-sm text-muted-foreground'>
                          No issues detected in the selected records.
                        </p>
                      )}
                    </CardContent>
                  </Card>
                  <RankingCard
                    label='Issue classes'
                    entries={ranked(
                      errors.flatMap((r) =>
                        evaluateRecord(r).map((issue) => ({
                          ...r,
                          id: `${r.id}:${issue}`,
                          rawFields: {
                            ...r.rawFields,
                            'x-issue': {
                              raw: issue,
                              value: issue,
                              availability: 'value',
                            },
                          },
                        })),
                      ),
                      'x-issue',
                      limit,
                      'requests',
                    )}
                    metric='requests'
                  />
                </div>
              )}
              {tab === 'Fields & Records' && (
                <div className='grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]'>
                  <Card>
                    <CardHeader>
                      <CardTitle className='text-base'>
                        Schema coverage · {dataset.fields.length}{' '}
                        fields
                      </CardTitle>
                    </CardHeader>
                    <CardContent className='space-y-1'>
                      {dataset.fieldAvailability.map((field) => (
                        <div
                          key={field.name}
                          className='flex items-center justify-between gap-2 border-b py-1.5 text-xs'
                        >
                          <code className='truncate'>
                            {field.name}
                          </code>
                          <Badge
                            variant={
                              field.status === 'populated'
                                ? 'secondary'
                                : 'outline'
                            }
                          >
                            {field.status} {field.populated}/
                            {field.total}
                          </Badge>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle className='text-base'>
                        Parsed records · {filtered.length} shown
                      </CardTitle>
                    </CardHeader>
                    <CardContent className='overflow-x-auto'>
                      <table className='w-full min-w-[850px] text-left text-xs'>
                        <thead>
                          <tr className='border-b text-muted-foreground'>
                            {[
                              'Time',
                              'Client',
                              'User',
                              'Destination',
                              'Action',
                              'Status',
                              'Bytes',
                              'Diagnostics',
                            ].map((c) => (
                              <th
                                className='px-2 py-2 font-medium'
                                key={c}
                              >
                                {c}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {filtered
                            .slice(-500)
                            .reverse()
                            .map((r) => (
                              <tr
                                key={r.id}
                                className='border-b align-top'
                              >
                                <td className='whitespace-nowrap px-2 py-2'>
                                  {formatTime(r.timestamp)}
                                </td>
                                <td className='px-2 py-2'>
                                  {fieldValue(r, 'c-ip') || '—'}
                                </td>
                                <td className='px-2 py-2'>
                                  {fieldValue(r, 'cs-username') ||
                                    '—'}
                                </td>
                                <td
                                  className='max-w-56 truncate px-2 py-2'
                                  title={destinationOf(r)}
                                >
                                  {destinationOf(r)}
                                </td>
                                <td className='px-2 py-2'>
                                  {fieldValue(r, 's-action') || '—'}
                                </td>
                                <td className='px-2 py-2'>
                                  {fieldValue(r, 'sc-status') || '—'}
                                </td>
                                <td className='px-2 py-2'>
                                  {formatBytes(bytesOf(r))}
                                </td>
                                <td className='px-2 py-2'>
                                  {evaluateRecord(r).join(', ') ||
                                    '—'}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                      {dataset.diagnostics.length > 0 && (
                        <details className='mt-3 rounded-lg border border-amber-500/30 p-3 text-xs'>
                          <summary className='cursor-pointer font-medium text-amber-600'>
                            {dataset.diagnostics.length} malformed or
                            schema-less line(s) · inspect diagnostics
                          </summary>
                          <div className='mt-2 space-y-3'>
                            {dataset.diagnostics.map(
                              (diagnostic, index) => (
                                <div
                                  key={`${diagnostic.source}:${index}`}
                                  className='space-y-1 rounded border p-2'
                                >
                                  <div>
                                    {diagnostic.errorType} · expected{' '}
                                    {diagnostic.expectedFields}{' '}
                                    fields, received{' '}
                                    {diagnostic.receivedValues} ·{' '}
                                    {diagnostic.source}
                                  </div>
                                  <code className='block break-all text-muted-foreground'>
                                    {diagnostic.rawLine}
                                  </code>
                                </div>
                              ),
                            )}
                          </div>
                        </details>
                      )}
                    </CardContent>
                  </Card>
                </div>
              )}
            </>
          )}
        </div>
      </ScrollArea>
    </main>
  );
}

function RankingCard({
  label,
  entries,
  metric,
  onMetric,
}: {
  label: string;
  entries: { name: string; value: number }[];
  metric: 'requests' | 'bytes';
  onMetric?: (metric: 'requests' | 'bytes') => void;
}) {
  const max = Math.max(1, ...entries.map((e) => e.value));
  return (
    <Card className='gap-3 py-4'>
      <CardHeader className='flex-row items-center justify-between px-4'>
        <CardTitle className='text-base'>{label}</CardTitle>
        {onMetric && (
          <select
            className='h-8 rounded border bg-background px-2 text-xs'
            value={metric}
            onChange={(e) => onMetric(e.target.value as any)}
          >
            <option value='requests'>Requests</option>
            <option value='bytes'>Bytes</option>
          </select>
        )}
      </CardHeader>
      <CardContent className='space-y-3 px-4'>
        {entries.length ? (
          entries.map((item, i) => (
            <div key={item.name} className='space-y-1'>
              <div className='flex justify-between gap-3 text-xs'>
                <span className='truncate'>
                  <span className='mr-2 text-muted-foreground'>
                    {i + 1}.
                  </span>
                  {item.name}
                </span>
                <span className='shrink-0 font-medium'>
                  {metric === 'bytes'
                    ? formatBytes(item.value)
                    : item.value.toLocaleString()}
                </span>
              </div>
              <div className='h-1.5 overflow-hidden rounded bg-muted'>
                <div
                  className='h-full rounded bg-primary/70'
                  style={{ width: `${(item.value / max) * 100}%` }}
                />
              </div>
            </div>
          ))
        ) : (
          <p className='text-sm text-muted-foreground'>
            No populated fields for this ranking.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
