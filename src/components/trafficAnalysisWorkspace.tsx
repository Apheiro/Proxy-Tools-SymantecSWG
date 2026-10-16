'use client';

import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  Activity,
  BookOpen,
  ChevronDown,
  CircleAlert,
  Download,
  FileUp,
  LoaderCircle,
  Radio,
  Save,
  SlidersHorizontal,
} from 'lucide-react';
import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { toast } from 'sonner';
import BackgroundRefresh from '@/components/backgroundRefresh';
import PageHeader from '@/components/pageHeader';
import TrafficTimeline from '@/components/trafficTimeline';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { DateTimePicker } from '@/components/ui/date-time-picker';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SelectField, SelectOption } from '@/components/ui/select';
import { useCredentialRevision } from '@/lib/credentialStore';
import { cva } from '@/lib/cva';
import { dateTimeToISO, isoToDateTime } from '@/lib/dateTime';
import getCredentials from '@/lib/getCredentials';
import { useScrapedData } from '@/lib/scrapingCache';
import {
  bytesOf,
  createTrafficTimeFormatter,
  destinationOf,
  fieldValue,
  formatBytes,
  type TrafficDataset,
  type TrafficRecord,
  trafficTimeZones,
  utcTrafficEpoch,
} from '@/lib/trafficAnalysis';
import {
  type AccessLogSource,
  type CaptureFilters,
  type CaptureRange,
  type CaptureRanking,
  type CaptureResult,
  type CaptureStreamStatus,
  emptyCaptureFilters,
} from '@/lib/trafficCapture';
import {
  collectTrafficReport,
  trafficReportPalette,
} from '@/lib/trafficReport';
import {
  disclosureIconStyles,
  refreshStyles,
} from '@/lib/uiVariants';
import useDataSourceMode from '@/lib/useDataSourceMode';
import useTrafficCapture from '@/lib/useTrafficCapture';

const workspaceTabStyles = cva({
  base: 'whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium',
  variants: {
    selected: {
      true: 'border-primary text-primary',
      false: 'border-transparent text-muted-foreground',
    },
  },
});

const INPUT =
  'h-9 min-w-0 rounded-md border bg-background px-2 text-sm';
const TABS = [
  'Overview',
  'Rankings',
  'Errors & Security',
  'Fields & Records',
] as const;
const dateInput = (epoch: number | null) =>
  epoch == null ? '' : new Date(epoch).toISOString().slice(0, 19);

export default function TrafficAnalysisWorkspace({
  proxy,
}: {
  proxy: string;
}) {
  const capture = useTrafficCapture();
  const workersId = useId();
  const accessLogId = useId();
  const timeZoneId = useId();
  const rangeControlsId = useId();
  const filterControlsId = useId();
  const { mode: sourceMode, ready } = useDataSourceMode();
  const [mode, setMode] = useState<'static' | 'live'>('static');
  const [tab, setTab] = useState<(typeof TABS)[number]>('Overview');
  const [metric, setMetric] = useState<'requests' | 'bytes'>(
    'requests',
  );
  const [limit, setLimit] = useState(10);
  const [workers, setWorkers] = useState(0);
  const [zone, setZone] = useState('UTC');
  const [zones, setZones] = useState(['UTC']);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [filters, setFilters] = useState<CaptureFilters>(
    emptyCaptureFilters,
  );
  const [range, setRange] = useState<CaptureRange>({
    start: null,
    end: null,
  });
  const [draftStart, setDraftStart] = useState('');
  const [draftEnd, setDraftEnd] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [pageDraft, setPageDraft] = useState('1');
  const [recordDraft, setRecordDraft] = useState('');
  const [analysis, setAnalysis] = useState<CaptureResult | null>(
    null,
  );
  const [queryBusy, setQueryBusy] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportMessage, setExportMessage] = useState('');
  const exportController = useRef<AbortController | null>(null);
  const [resolvedQuery, setResolvedQuery] = useState('');
  const [queryError, setQueryError] = useState('');
  const [logs, setLogs] = useState<AccessLogSource[]>([]);
  const [selectedLog, setSelectedLog] = useState('');
  const [indexKey, setIndexKey] = useState('');

  const [indexVersion, setIndexVersion] = useState(0);
  const [streamVersion, setStreamVersion] = useState(0);
  const [stream, setStream] = useState<CaptureStreamStatus | null>(
    null,
  );
  const [stopping, setStopping] = useState(false);
  const [savedId, setSavedId] = useState('');
  const streamId = useRef('');
  const fileInput = useRef<HTMLInputElement>(null);
  const credentialRevision = useCredentialRevision();
  const key = `${sourceMode}:${proxy}:${credentialRevision}`;
  const active =
    mode === 'live' &&
    ['connecting', 'streaming'].includes(stream?.status ?? '');
  const captureId =
    capture.dataset?.captureId ?? stream?.captureId ?? '';
  useEffect(
    () => () => {
      exportController.current?.abort();
    },
    [captureId],
  );
  const formatTime = useMemo(
    () => createTrafficTimeFormatter(zone),
    [zone],
  );

  useEffect(() => {
    const available = trafficTimeZones();
    setZones(available);
    try {
      const storedZone = localStorage.getItem(
        'traffic-analysis-timezone',
      );
      if (storedZone && available.includes(storedZone))
        setZone(storedZone);
      const storedWorkers = Number(
        localStorage.getItem('traffic-analysis-workers'),
      );
      if (
        Number.isInteger(storedWorkers) &&
        storedWorkers >= 0 &&
        storedWorkers <= 16
      )
        setWorkers(storedWorkers);
    } catch {
      /* Use defaults when storage is unavailable. */
    }
  }, []);
  useEffect(() => {
    setPage(1);
    setAnalysis(null);
    setSavedId('');
    setExportingPdf(false);
    setExportMessage('');
    setRange({ start: null, end: null });
  }, [captureId]);
  useEffect(() => {
    setPage(1);
  }, [filters, range.start, range.end, pageSize, tab]);
  useEffect(() => {
    setDraftStart(dateInput(range.start));
    setDraftEnd(dateInput(range.end));
  }, [range.start, range.end]);
  useEffect(() => {
    setPageDraft(String(page));
  }, [page]);

  const query = useMemo(
    () => ({
      ...filters,
      start: range.start,
      end: range.end,
      page,
      pageSize,
      errorsOnly: tab === 'Errors & Security',
      limit,
      metric,
    }),
    [
      filters,
      range.start,
      range.end,
      page,
      pageSize,
      tab,
      limit,
      metric,
    ],
  );
  const queryKey = JSON.stringify(query);
  const selectionPending =
    !!captureId && resolvedQuery !== `${captureId}:${queryKey}`;
  const analysisLoading =
    !queryError && (selectionPending || queryBusy);
  // One in-flight query per selection. A continuous stream cannot invalidate
  // each result before it arrives; schedule the next refresh after completion.
  useEffect(() => {
    if (!captureId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    setQueryError('');
    const run = async () => {
      setQueryBusy(true);
      try {
        const result = await invoke<CaptureResult>(
          'query_traffic_capture',
          { captureId, query: JSON.parse(queryKey) },
        );
        if (!cancelled) {
          setAnalysis(result);
          setResolvedQuery(`${captureId}:${queryKey}`);
          setPage((current) =>
            current === result.page ? current : result.page,
          );
        }
      } catch (error) {
        if (!cancelled) {
          const message = String(error);
          setQueryError(message);
          toast.error(`Could not query capture: ${message}`);
        }
      } finally {
        if (!cancelled) {
          setQueryBusy(false);
          if (active || capture.busy) timer = setTimeout(run, 1000);
        }
      }
    };
    timer = setTimeout(run, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [captureId, queryKey, active, capture.busy, stream?.status]);

  const loadIndex = useCallback(() => {
    void credentialRevision;
    void indexVersion; // Explicit Refresh reruns the same scoped cache entry.
    const credentials = getCredentials();
    return invoke<AccessLogSource[]>('get_traffic_access_logs', {
      proxyIp: proxy,
      username:
        sourceMode === 'live' ? (credentials?.username ?? '') : '',
      password:
        sourceMode === 'live' ? (credentials?.password ?? '') : '',
      useMockData: sourceMode === 'mock',
    });
  }, [proxy, sourceMode, indexVersion, credentialRevision]);
  const {
    data: sources,
    busy: indexBusy,
    error: indexError,
  } = useScrapedData(
    `access-log-index:${key}`,
    mode === 'live' && ready,
    loadIndex,
  );
  useEffect(() => {
    if (!sources) {
      setIndexKey('');
      setLogs([]);
      return;
    }
    setLogs(sources);
    setSelectedLog((previous) =>
      sources.some((log) => log.name === previous)
        ? previous
        : (sources[0]?.name ?? ''),
    );
    setIndexKey(key);
  }, [sources, key]);
  useEffect(() => {
    if (indexError)
      toast.error(`Could not update access logs: ${indexError}`);
  }, [indexError]);
  const selectedLogUrl =
    logs.find((log) => log.name === selectedLog)?.url ?? '';

  useEffect(() => {
    if (mode !== 'live' || !ready || indexKey !== key || !selectedLog)
      return;
    const id = crypto.randomUUID();
    streamId.current = id;
    let cancelled = false;
    let createdCapture = '';
    const listeners: UnlistenFn[] = [];
    capture.setDataset(null);
    setStream({
      streamId: id,
      captureId: '',
      status: 'connecting',
      url: selectedLogUrl,
      message: 'Connecting to the selected access log…',
    });
    const clean = async () => {
      await invoke('stop_traffic_stream', { streamId: id }).catch(
        () => {},
      );
      if (createdCapture)
        await invoke('abort_access_log_parse', {
          parseId: createdCapture,
        }).catch(() => {});
    };
    void (async () => {
      try {
        listeners.push(
          await listen<[string, TrafficDataset]>(
            'traffic-analysis:update',
            (event) => {
              if (!cancelled && event.payload[0] === id)
                capture.setDataset(event.payload[1]);
            },
          ),
        );
        listeners.push(
          await listen<CaptureStreamStatus>(
            'traffic-analysis:status',
            (event) => {
              if (cancelled || event.payload.streamId !== id) return;
              setStream(event.payload);
              if (event.payload.status === 'error')
                toast.error(event.payload.message);
            },
          ),
        );
        if (cancelled) return;
        const credentials = getCredentials();
        createdCapture = await invoke<string>(
          'start_traffic_stream',
          {
            streamId: id,
            proxyIp: proxy,
            logName: selectedLog,
            username: credentials?.username ?? '',
            password: credentials?.password ?? '',
            useMockData: sourceMode === 'mock',
          },
        );
        if (!cancelled)
          setStream((current) =>
            current
              ? { ...current, captureId: createdCapture }
              : null,
          );
      } catch (error) {
        if (!cancelled) {
          setStream((current) =>
            current
              ? {
                  ...current,
                  status: 'error',
                  message: String(error),
                }
              : null,
          );
          toast.error(`Could not start stream: ${String(error)}`);
        }
      } finally {
        if (cancelled) {
          for (const unlisten of listeners.splice(0)) unlisten();
          await clean();
        }
      }
    })();
    return () => {
      cancelled = true;
      for (const unlisten of listeners.splice(0)) unlisten();
      void clean();
    };
  }, [
    mode,
    ready,
    key,
    indexKey,
    selectedLog,
    selectedLogUrl,
    streamVersion,
    sourceMode,
    proxy,
    capture.setDataset,
  ]);

  const stop = async () => {
    setStopping(true);
    try {
      await invoke('stop_traffic_stream', {
        streamId: streamId.current,
      });
    } catch (error) {
      toast.error(`Could not stop stream: ${String(error)}`);
    } finally {
      setStopping(false);
    }
  };
  const saveable =
    !!capture.dataset?.recordsProcessed &&
    !!captureId &&
    !capture.busy &&
    !active &&
    !stopping &&
    savedId !== captureId;
  const updateRange = useCallback(
    (next: CaptureRange) =>
      setRange((previous) =>
        previous.start === next.start && previous.end === next.end
          ? previous
          : next,
      ),
    [],
  );
  const applyRange = () => {
    const start = draftStart ? utcTrafficEpoch(draftStart) : null;
    const end = draftEnd ? utcTrafficEpoch(draftEnd) : null;
    if (
      (start != null && !Number.isFinite(start)) ||
      (end != null && !Number.isFinite(end)) ||
      (start != null && end != null && start > end)
    ) {
      toast.error('Enter a valid UTC range with start before end.');
      return;
    }
    updateRange({ start, end });
  };
  const filter = (name: keyof CaptureFilters, value: string) =>
    setFilters((previous) => ({ ...previous, [name]: value }));
  const summary = analysis?.summary;
  const fullTimeline = capture.dataset?.timeline ?? [];
  const fullEnd =
    (fullTimeline.length
      ? (fullTimeline.at(-1)?.epoch ?? 0) + 59999
      : null) ??
    summary?.last ??
    null;
  const bytesAvailable = capture.dataset?.fieldAvailability.some(
    (field) =>
      ['sc-bytes', 'cs-bytes'].includes(field.name) &&
      field.populated > 0,
  );
  const hasPopulatedField = (name: string) =>
    capture.dataset?.fieldAvailability.some(
      (field) => field.name === name && field.populated > 0,
    );
  const timeAvailable =
    summary?.first != null && summary?.last != null;
  const scope =
    range.start == null &&
    range.end == null &&
    !Object.values(filters).some(Boolean)
      ? 'Entire capture'
      : 'Selected range / filters';
  const options = analysis?.options ?? {};
  const rows = analysis?.records ?? [];
  const setPreset = (minutes: number | null) =>
    updateRange(
      minutes == null || fullEnd == null
        ? { start: null, end: null }
        : { start: fullEnd - minutes * 60000, end: fullEnd },
    );

  const exportPdf = async () => {
    const dataset = capture.dataset;
    if (
      !dataset ||
      !captureId ||
      exportingPdf ||
      capture.busy ||
      active ||
      stopping
    )
      return;
    const controller = new AbortController();
    exportController.current = controller;
    setExportingPdf(true);
    setExportMessage('Preparing PDF export…');
    try {
      // All selection, theme and source values are snapshotted before asynchronous work.
      const report = await collectTrafficReport(
        {
          proxy,
          source: dataset.source,
          captureId,
          generatedAt: new Date().toISOString(),
          timeZone: zone,
          theme: document.documentElement.classList.contains('dark')
            ? 'dark'
            : 'light',
          palette: trafficReportPalette(),
          filters: { ...filters },
          range: { ...range },
          metric,
          availability: dataset.fieldAvailability,
          receivedLines: dataset.receivedLines,
          processedRecords: dataset.recordsProcessed,
        },
        (query) =>
          invoke<CaptureResult>('query_traffic_capture', {
            captureId,
            query,
          }),
        controller.signal,
        setExportMessage,
      );
      setExportMessage('Rendering PDF pages…');
      const { trafficReportBlob } = await import(
        '@/components/pdf/trafficReportDocument'
      );
      if (controller.signal.aborted) return;
      const blob = await trafficReportBlob(report);
      if (controller.signal.aborted) return;
      const filename = `traffic-analysis-${report.generatedAt.replace(/[:.]/g, '-')}-${report.theme}.pdf`;
      if (isTauri()) {
        setExportMessage('Saving PDF…');
        const path = await invoke<string>('save_traffic_pdf', {
          filename,
          bytes: Array.from(new Uint8Array(await blob.arrayBuffer())),
        });
        toast.success('PDF saved.', {
          description: path,
          duration: 15000,
          action: {
            label: 'Open folder',
            onClick: () => {
              void invoke('open_traffic_pdf', {
                filename,
                folder: true,
              }).catch((error) =>
                toast.error(
                  `Could not open report folder: ${String(error)}`,
                ),
              );
            },
          },
        });
        await invoke('open_traffic_pdf', {
          filename,
          folder: false,
        }).catch((error) =>
          toast.error(
            `PDF saved, but could not open the viewer: ${String(error)}`,
          ),
        );
      } else {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        toast.success('Traffic analysis PDF downloaded.');
      }
    } catch (error) {
      if (!controller.signal.aborted)
        toast.error(`Could not export PDF: ${String(error)}`);
    } finally {
      if (
        exportController.current === controller &&
        !controller.signal.aborted
      ) {
        setExportingPdf(false);
        setExportMessage('');
      }
    }
  };
  return (
    <main
      className={refreshStyles({
        refreshing:
          (indexBusy || analysisLoading) && !!(sources || analysis),
        className:
          'mx-auto flex h-[calc(100dvh-90px)] max-w-[1600px] flex-col gap-4 overflow-hidden px-4 py-5 md:px-7',
      })}
    >
      <BackgroundRefresh
        active={indexBusy || analysisLoading}
        label={
          indexBusy
            ? 'Updating available access logs…'
            : selectionPending
              ? 'Updating analysis for the selected range and filters…'
              : 'Refreshing traffic analysis…'
        }
      />
      {exportingPdf && (
        <output
          className='text-xs text-muted-foreground'
          aria-live='polite'
        >
          {exportMessage}
        </output>
      )}
      <PageHeader
        icon={Activity}
        eyebrow='Proxy diagnostics'
        title='Traffic Analysis'
        description={
          <>
            {proxy || 'No proxy selected'} · Complete capture
            analytics
          </>
        }
        actions={
          <div className='flex flex-wrap items-center gap-2'>
            <Button
              size='sm'
              variant='outline'
              disabled={
                !captureId ||
                !capture.dataset ||
                capture.busy ||
                active ||
                stopping ||
                exportingPdf ||
                analysisLoading
              }
              onClick={() => void exportPdf()}
              title={
                active
                  ? 'Stop the live capture before exporting a consistent report.'
                  : 'Export full capture statistics, the selected scope and concentrated peaks.'
              }
            >
              {exportingPdf ? (
                <LoaderCircle className='size-4 animate-spin' />
              ) : (
                <Download className='size-4' />
              )}
              {exportingPdf ? 'Exporting PDF…' : 'Export PDF'}
            </Button>
            <Link href='/documentation/traffic-analysis'>
              <Button variant='ghost' size='sm'>
                <BookOpen className='size-4' />
                Guide
              </Button>
            </Link>
            <Button
              size='sm'
              variant={mode === 'static' ? 'default' : 'outline'}
              disabled={capture.busy}
              onClick={() => {
                if (mode !== 'static') {
                  capture.setDataset(null);
                  setMode('static');
                  setStream(null);
                }
              }}
            >
              <FileUp className='size-4' />
              Static Log
            </Button>
            <Button
              size='sm'
              variant={mode === 'live' ? 'default' : 'outline'}
              disabled={capture.busy}
              onClick={() => {
                void capture
                  .discard()
                  .catch((error) => toast.error(String(error)));
                setMode('live');
              }}
            >
              <Radio className='size-4' />
              Live Session
            </Button>
            <Button
              size='sm'
              variant='outline'
              disabled={!saveable}
              onClick={() =>
                void capture.save(captureId).then((success) => {
                  if (success) setSavedId(captureId);
                })
              }
            >
              <Save className='size-4' />
              Save capture
            </Button>
          </div>
        }
      />
      <div className='grid shrink-0 gap-3 lg:grid-cols-[minmax(0,1fr)_auto]'>
        <Card
          className='shrink-0 flex-row flex-wrap items-center gap-2 p-3'
          role='region'
          aria-label='Capture source'
        >
          {mode === 'static' ? (
            <>
              <input
                ref={fileInput}
                type='file'
                className='hidden'
                accept='.log,.txt,.accesslog'
                multiple
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  if (files.length)
                    void capture.loadFiles(files, workers);
                  event.target.value = '';
                }}
              />
              <Button
                size='sm'
                disabled={capture.busy}
                onClick={() => fileInput.current?.click()}
              >
                Upload logs
              </Button>
              <Button
                size='sm'
                variant='outline'
                disabled={capture.busy}
                onClick={() =>
                  void invoke<string>('get_mock_access_log')
                    .then((content) =>
                      capture.loadFile(
                        new File([content], 'sample-access-log.log'),
                        workers,
                      ),
                    )
                    .catch((error) => toast.error(String(error)))
                }
              >
                Explore demo data
              </Button>
              <SelectField
                className='max-w-80'
                value=''
                disabled={capture.busy || !capture.archives.length}
                aria-label='Load saved capture'
                onValueChange={(selectedValue) =>
                  void capture.loadSaved(selectedValue)
                }
              >
                <SelectOption value=''>
                  Load saved capture ({capture.archives.length})
                </SelectOption>
                {capture.archives.map((item) => (
                  <SelectOption key={item.id} value={item.id}>
                    {item.source} · {item.records.toLocaleString()}{' '}
                    rows · {new Date(item.savedAt).toLocaleString()}
                  </SelectOption>
                ))}
              </SelectField>
              <label
                htmlFor={workersId}
                className='ml-auto text-xs text-muted-foreground'
              >
                Processing workers
              </label>
              <SelectField
                id={workersId}
                value={workers}
                disabled={capture.busy}
                onValueChange={(selectedValue) => {
                  const value = Number(selectedValue);
                  setWorkers(value);
                  try {
                    localStorage.setItem(
                      'traffic-analysis-workers',
                      String(value),
                    );
                  } catch {}
                }}
              >
                <SelectOption value={0}>
                  Auto ({capture.config?.recommendedWorkers ?? '…'})
                </SelectOption>
                {Array.from(
                  { length: capture.config?.maxWorkers ?? 1 },
                  (_, index) => index + 1,
                ).map((count) => (
                  <SelectOption key={count} value={count}>
                    {count}
                  </SelectOption>
                ))}
              </SelectField>
            </>
          ) : (
            <>
              <Badge variant='outline'>
                {sourceMode === 'mock' ? 'Mock HTTP' : 'Live proxy'}
              </Badge>
              <label htmlFor={accessLogId} className='text-sm'>
                Access log
              </label>
              <SelectField
                id={accessLogId}
                value={selectedLog}
                disabled={indexKey !== key}
                onValueChange={(selectedValue) =>
                  setSelectedLog(selectedValue)
                }
              >
                {!logs.length && (
                  <SelectOption value=''>
                    {indexBusy ? 'Loading…' : 'No access logs'}
                  </SelectOption>
                )}
                {logs.map((log) => (
                  <SelectOption key={log.name} value={log.name}>
                    {log.name}
                  </SelectOption>
                ))}
              </SelectField>
              <Button
                size='sm'
                variant='outline'
                disabled={indexBusy || stopping}
                onClick={() => setIndexVersion((value) => value + 1)}
              >
                Refresh logs
              </Button>
              <Button
                size='sm'
                variant='outline'
                disabled={
                  !selectedLog ||
                  indexBusy ||
                  stopping ||
                  indexKey !== key
                }
                onClick={() => setStreamVersion((value) => value + 1)}
              >
                {active ? 'Restart' : 'Start'}
              </Button>
              <Button
                size='sm'
                disabled={!active || stopping || !stream?.captureId}
                onClick={() => void stop()}
              >
                {stopping ? 'Stopping…' : 'Stop'}
              </Button>
              <Badge
                variant={
                  stream?.status === 'error'
                    ? 'destructive'
                    : 'outline'
                }
              >
                {stream?.status ?? 'Idle'}
              </Badge>
              <span className='text-xs text-muted-foreground'>
                {stream?.message}
              </span>
              {stream?.url && (
                <p className='w-full break-all font-mono text-xs text-muted-foreground'>
                  {stream.url}
                </p>
              )}
            </>
          )}
        </Card>
        <Card className='gap-2 py-3'>
          <CardHeader className='px-3'>
            <CardTitle className='text-sm'>UTC Time Zone</CardTitle>
          </CardHeader>
          <CardContent className='px-3'>
            <label htmlFor={timeZoneId} className='sr-only'>
              Display time zone
            </label>
            <SelectField
              id={timeZoneId}
              className='w-full lg:w-64'
              value={zone}
              onValueChange={(selectedValue) => {
                setZone(selectedValue);
                try {
                  localStorage.setItem(
                    'traffic-analysis-timezone',
                    selectedValue,
                  );
                } catch {}
              }}
            >
              {zones.map((name) => (
                <SelectOption key={name} value={name}>
                  {name.replaceAll('_', ' ')}
                </SelectOption>
              ))}
            </SelectField>
          </CardContent>
        </Card>
      </div>
      {mode === 'static' && capture.progress && (
        <div className='shrink-0 space-y-1 text-xs'>
          <div className='flex justify-between gap-2'>
            <span>{capture.progress.name}</span>
            <span>
              {capture.progress.percent}% ·{' '}
              {capture.progress.records.toLocaleString()} records
              indexed
            </span>
          </div>
          <div className='h-1.5 rounded bg-muted'>
            <div
              className='h-full rounded bg-primary'
              style={{ width: `${capture.progress.percent}%` }}
            />
          </div>
          {capture.progress.error && (
            <p className='text-destructive'>
              {capture.progress.error}
            </p>
          )}
        </div>
      )}
      <nav
        className='flex shrink-0 gap-1 overflow-x-auto border-b'
        aria-label='Traffic analysis views'
      >
        {TABS.map((name) => (
          <button
            key={name}
            type='button'
            onClick={() => setTab(name)}
            className={workspaceTabStyles({ selected: tab === name })}
          >
            {name}
          </button>
        ))}
      </nav>
      <ScrollArea className='min-h-0 flex-1'>
        <div className='space-y-4 pb-6 pr-4'>
          {!captureId ? (
            <div className='grid min-h-64 place-items-center rounded-xl border border-dashed text-center text-sm text-muted-foreground'>
              <div>
                <Activity className='mx-auto mb-3 size-8 opacity-40' />
                {mode === 'live'
                  ? stream?.message
                  : 'Upload a log, explore demo data, or open a saved capture.'}
              </div>
            </div>
          ) : (
            <>
              <Card className='gap-2 py-3'>
                <CardHeader className='flex-row flex-wrap items-center justify-between gap-2 px-4'>
                  <div>
                    <CardTitle className='text-base'>
                      Capture timeline
                    </CardTitle>
                    <p className='mt-1 text-xs text-muted-foreground'>
                      Request density across the complete capture.
                      Select a cell or drag the range handles.
                    </p>
                  </div>
                  <div className='flex items-center gap-2'>
                    <Badge variant='outline'>{scope}</Badge>
                    {analysisLoading && (
                      <Badge
                        variant='secondary'
                        role='status'
                        className='gap-2'
                      >
                        <LoaderCircle
                          className='size-3 animate-spin'
                          aria-hidden='true'
                        />
                        {selectionPending
                          ? 'Calculating selected analysis…'
                          : 'Refreshing analysis…'}
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className='space-y-2 px-4'>
                  <TrafficTimeline
                    variant='density'
                    timeline={fullTimeline}
                    range={range}
                    onRange={updateRange}
                    timeZone={zone}
                    metric={metric}
                  />
                  {rangeOpen && (
                    <div
                      id={rangeControlsId}
                      className='flex flex-wrap items-end gap-2'
                    >
                      <label
                        htmlFor={`${rangeControlsId}-metric`}
                        className='space-y-1 text-xs text-muted-foreground'
                      >
                        Chart and ranking metric
                        <SelectField
                          value={metric}
                          id={`${rangeControlsId}-metric`}
                          aria-label='Chart and ranking metric'
                          onValueChange={(selectedValue) =>
                            setMetric(
                              selectedValue as 'requests' | 'bytes',
                            )
                          }
                        >
                          <SelectOption value='requests'>
                            Requests
                          </SelectOption>
                          <SelectOption
                            value='bytes'
                            disabled={!bytesAvailable}
                          >
                            Bytes
                          </SelectOption>
                        </SelectField>
                      </label>
                      <DateTimePicker
                        label='From (UTC)'
                        timeZone='UTC'
                        precision='second'
                        value={dateTimeToISO(draftStart, 'UTC')}
                        onChange={(value) =>
                          setDraftStart(
                            isoToDateTime(value, 'UTC', 'second'),
                          )
                        }
                      />
                      <DateTimePicker
                        label='Through (UTC, inclusive)'
                        timeZone='UTC'
                        precision='second'
                        value={dateTimeToISO(draftEnd, 'UTC')}
                        onChange={(value) =>
                          setDraftEnd(
                            isoToDateTime(value, 'UTC', 'second'),
                          )
                        }
                      />
                      <Button
                        size='sm'
                        variant='outline'
                        onClick={applyRange}
                      >
                        Apply range
                      </Button>
                      <Button
                        size='sm'
                        variant='ghost'
                        onClick={() => setPreset(null)}
                      >
                        All time
                      </Button>
                      {[15, 60, 1440].map((minutes) => (
                        <Button
                          key={minutes}
                          size='sm'
                          variant='ghost'
                          onClick={() => setPreset(minutes)}
                        >
                          {minutes === 15
                            ? 'Last 15m'
                            : minutes === 60
                              ? 'Last 1h'
                              : 'Last 24h'}
                        </Button>
                      ))}
                    </div>
                  )}
                  <p className='text-xs text-muted-foreground'>
                    {range.start == null
                      ? 'Capture start'
                      : formatTime(range.start)}{' '}
                    →{' '}
                    {range.end == null
                      ? 'Capture end'
                      : formatTime(range.end)}{' '}
                    · Adaptive density cells. Records without a valid
                    timestamp appear only in unbounded time ranges.
                  </p>
                  <div className='flex justify-end'>
                    <Button
                      size='sm'
                      variant='outline'
                      className='cursor-pointer'
                      onClick={() => setRangeOpen((value) => !value)}
                      aria-expanded={rangeOpen}
                      aria-controls={rangeControlsId}
                    >
                      Range
                      <ChevronDown
                        className={disclosureIconStyles({
                          expanded: rangeOpen,
                          className: 'size-4',
                        })}
                      />
                    </Button>
                  </div>
                </CardContent>
              </Card>
              <Card className='gap-0 py-0'>
                <CardHeader className='relative flex flex-row items-center justify-between rounded-xl px-4 py-3 cursor-pointer'>
                  <button
                    type='button'
                    className='absolute inset-0 cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                    onClick={() => setFiltersOpen((value) => !value)}
                    aria-label={
                      filtersOpen
                        ? 'Collapse filters'
                        : 'Expand filters'
                    }
                    aria-expanded={filtersOpen}
                    aria-controls={filterControlsId}
                  />
                  <CardTitle className='pointer-events-none relative flex items-center gap-2 text-sm'>
                    <SlidersHorizontal className='size-4' />
                    Filters{' '}
                    {Object.values(filters).filter(Boolean).length
                      ? `(${Object.values(filters).filter(Boolean).length})`
                      : ''}
                    <ChevronDown
                      className={disclosureIconStyles({
                        expanded: filtersOpen,
                        className: 'size-4',
                      })}
                    />
                  </CardTitle>
                  <Button
                    size='sm'
                    variant='ghost'
                    className='relative z-10 cursor-pointer'
                    onClick={() => setFilters(emptyCaptureFilters)}
                  >
                    Clear filters
                  </Button>
                </CardHeader>
                {filtersOpen && (
                  <CardContent
                    id={filterControlsId}
                    className='grid gap-2 px-4 pb-3 sm:grid-cols-3 lg:grid-cols-5'
                  >
                    {(
                      [
                        'search',
                        'client',
                        'user',
                        'host',
                        'threat',
                      ] as const
                    ).map((name) => (
                      <label
                        key={name}
                        htmlFor={`${filterControlsId}-${name}`}
                        className='space-y-1 text-xs capitalize text-muted-foreground'
                      >
                        {name === 'host'
                          ? 'Destination / host'
                          : name}
                        <input
                          className={`${INPUT} block w-full`}
                          id={`${filterControlsId}-${name}`}
                          value={filters[name]}
                          onChange={(event) =>
                            filter(name, event.target.value)
                          }
                          placeholder={`Find ${name}…`}
                        />
                      </label>
                    ))}
                    {(
                      [
                        ['category', 'cs-categories'],
                        ['action', 's-action'],
                        ['status', 'sc-status'],
                        ['method', 'cs-method'],
                      ] as const
                    ).map(([name, field]) => (
                      <label
                        key={name}
                        htmlFor={`${filterControlsId}-${name}`}
                        className='space-y-1 text-xs capitalize text-muted-foreground'
                      >
                        {name}
                        <SelectField
                          className='w-full'
                          id={`${filterControlsId}-${name}`}
                          value={filters[name]}
                          onValueChange={(selectedValue) =>
                            filter(name, selectedValue)
                          }
                        >
                          <SelectOption value=''>
                            All {name}
                          </SelectOption>
                          {(options[field] ?? []).map((value) => (
                            <SelectOption key={value} value={value}>
                              {value}
                            </SelectOption>
                          ))}
                        </SelectField>
                      </label>
                    ))}
                  </CardContent>
                )}
              </Card>
              <div className='flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground'>
                <span>
                  {capture.dataset?.source} ·{' '}
                  {capture.dataset?.recordsProcessed.toLocaleString()}{' '}
                  records captured · {scope}
                </span>
                <span>
                  {queryError
                    ? 'Analysis failed'
                    : analysisLoading
                      ? 'Updating analysis…'
                      : 'Complete indexed results'}
                </span>
              </div>
              {queryError && (
                <p className='rounded border border-destructive/30 p-3 text-sm text-destructive'>
                  {queryError}
                </p>
              )}
              {selectionPending &&
                !resolvedQuery.startsWith(`${captureId}:`) &&
                !queryError && (
                  <output
                    aria-live='polite'
                    className='flex min-h-48 items-center justify-center gap-3 rounded-xl border bg-card p-6 text-sm text-muted-foreground'
                  >
                    <LoaderCircle
                      className='size-5 animate-spin shrink-0'
                      aria-hidden='true'
                    />
                    <span>
                      <span className='block font-medium text-foreground'>
                        Calculating analysis for the selected range
                        and filters…
                      </span>
                      <span className='mt-1 block'>
                        Large selections can take longer. Statistics
                        and records will appear together when ready.
                      </span>
                    </span>
                  </output>
                )}
              {summary &&
                resolvedQuery.startsWith(`${captureId}:`) && (
                  <>
                    <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4'>
                      {[
                        [
                          'Requests',
                          summary.requests.toLocaleString(),
                        ],
                        [
                          'Traffic volume',
                          bytesAvailable
                            ? formatBytes(summary.bytes)
                            : 'Unavailable',
                        ],
                        [
                          'Average requests / s',
                          timeAvailable
                            ? summary.requestsPerSecond.toFixed(2)
                            : 'Unavailable',
                        ],
                        [
                          'Average throughput',
                          bytesAvailable && timeAvailable
                            ? `${formatBytes(summary.bytesPerSecond)}/s`
                            : 'Unavailable',
                        ],
                        [
                          'Requests with issues',
                          summary.issues.toLocaleString(),
                        ],
                        [
                          'Denied transactions',
                          summary.denied.toLocaleString(),
                        ],
                        [
                          'Unique users / clients',
                          `${hasPopulatedField('cs-username') ? summary.uniqueUsers : 'Unavailable'} / ${hasPopulatedField('c-ip') ? summary.uniqueClients : 'Unavailable'}`,
                        ],
                        [
                          'Unique destinations',
                          hasPopulatedField('cs-host')
                            ? summary.uniqueDestinations.toLocaleString()
                            : 'Unavailable',
                        ],
                      ].map(([label, value]) => (
                        <Card key={label} className='gap-2 py-3'>
                          <CardContent className='px-4'>
                            <p className='text-xs text-muted-foreground'>
                              {label}
                            </p>
                            <p className='mt-1 text-2xl font-semibold'>
                              {value}
                            </p>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                    {(tab === 'Overview' || tab === 'Rankings') && (
                      <>
                        <div className='flex justify-end gap-2'>
                          <label
                            htmlFor={`${rangeControlsId}-ranking`}
                            className='flex items-center gap-2 text-sm'
                          >
                            Ranking size
                            <SelectField
                              id={`${rangeControlsId}-ranking`}
                              value={limit}
                              onValueChange={(selectedValue) =>
                                setLimit(Number(selectedValue))
                              }
                            >
                              {[10, 20, 30, 50].map((value) => (
                                <SelectOption
                                  key={value}
                                  value={value}
                                >
                                  Top {value}
                                </SelectOption>
                              ))}
                            </SelectField>
                          </label>
                        </div>
                        {tab === 'Overview' && (
                          <Card className='gap-2 py-3'>
                            <CardHeader className='px-4'>
                              <CardTitle className='text-base'>
                                {metric === 'bytes'
                                  ? 'Bytes'
                                  : 'Requests'}{' '}
                                over time · selected analysis
                              </CardTitle>
                            </CardHeader>
                            <CardContent className='px-4'>
                              <TrafficTimeline
                                variant='columns'
                                timeline={analysis.timeline}
                                timeZone={zone}
                                metric={metric}
                              />
                            </CardContent>
                          </Card>
                        )}
                        <div className='grid gap-4 lg:grid-cols-2'>
                          {(tab === 'Overview'
                            ? [
                                ['Top sites', 'cs-host'],
                                ['Top clients', 'c-ip'],
                                ['HTTP status', 'sc-status'],
                                [
                                  'Filter results (informational)',
                                  'sc-filter-result',
                                ],
                              ]
                            : [
                                ['Sites / domains', 'cs-host'],
                                ['Users', 'cs-username'],
                                ['Clients / source IPs', 'c-ip'],
                                ['Categories', 'cs-categories'],
                                [
                                  'Applications',
                                  'x-bluecoat-application-name',
                                ],
                                ['Actions', 's-action'],
                                [
                                  'Filter results (informational)',
                                  'sc-filter-result',
                                ],
                                [
                                  'Threat risk (reported)',
                                  'cs-threat-risk',
                                ],
                              ]
                          ).map(([label, field]) => (
                            <RankingCard
                              key={field}
                              title={label}
                              entries={analysis.rankings[field] ?? []}
                              metric={metric}
                            />
                          ))}
                        </div>
                      </>
                    )}
                    {tab === 'Errors & Security' && (
                      <>
                        <div className='grid gap-4 lg:grid-cols-2'>
                          <RankingCard
                            title='Issue classes · a request may have several'
                            entries={
                              analysis.rankings['x-issue'] ?? []
                            }
                            metric='requests'
                          />
                          <RankingCard
                            title='Filter results · not an error count'
                            entries={
                              analysis.rankings['sc-filter-result'] ??
                              []
                            }
                            metric={metric}
                          />
                        </div>
                        <p className='text-xs text-muted-foreground'>
                          OBSERVED and PROXIED are informational.
                          DENIED means the request was not served; the
                          exception, HTTP status and security fields
                          identify the cause.{' '}
                          <Link
                            className='underline'
                            href='/documentation/traffic-analysis#filter-results'
                          >
                            Definitions
                          </Link>
                        </p>
                        <Card>
                          <CardHeader>
                            <CardTitle className='flex items-center gap-2 text-base'>
                              <CircleAlert className='size-4 text-amber-500' />
                              Requests with issues ·{' '}
                              {analysis.totalRecords.toLocaleString()}
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <RecordTable
                              records={rows}
                              formatTime={formatTime}
                              offset={
                                (analysis.page - 1) *
                                analysis.pageSize
                              }
                            />
                            <Pagination
                              result={analysis}
                              pageDraft={pageDraft}
                              setPageDraft={setPageDraft}
                              recordDraft={recordDraft}
                              setRecordDraft={setRecordDraft}
                              setPage={setPage}
                              pageSize={pageSize}
                              setPageSize={setPageSize}
                              busy={queryBusy}
                            />
                          </CardContent>
                        </Card>
                      </>
                    )}
                    {tab === 'Fields & Records' && (
                      <>
                        <Card>
                          <CardHeader>
                            <CardTitle className='text-base'>
                              All matching records ·{' '}
                              {analysis.totalRecords.toLocaleString()}
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <RecordTable
                              records={rows}
                              formatTime={formatTime}
                              offset={
                                (analysis.page - 1) *
                                analysis.pageSize
                              }
                            />
                            <Pagination
                              result={analysis}
                              pageDraft={pageDraft}
                              setPageDraft={setPageDraft}
                              recordDraft={recordDraft}
                              setRecordDraft={setRecordDraft}
                              setPage={setPage}
                              pageSize={pageSize}
                              setPageSize={setPageSize}
                              busy={queryBusy}
                            />
                          </CardContent>
                        </Card>
                        <Card>
                          <CardHeader>
                            <CardTitle className='text-base'>
                              Field availability · entire capture
                            </CardTitle>
                            <p className='text-xs text-muted-foreground'>
                              Populated / present records. Empty,
                              missing, None and unavailable remain
                              distinct in raw data.
                            </p>
                          </CardHeader>
                          <CardContent className='grid gap-x-4 text-xs md:grid-cols-2 xl:grid-cols-3'>
                            {capture.dataset?.fieldAvailability.map(
                              (field) => (
                                <div
                                  key={field.name}
                                  className='flex justify-between gap-2 border-b py-2'
                                >
                                  <code
                                    className='truncate'
                                    title={field.name}
                                  >
                                    {field.name}
                                  </code>
                                  <span className='whitespace-nowrap'>
                                    {field.status} · {field.populated}
                                    /{field.total}
                                  </span>
                                </div>
                              ),
                            )}
                          </CardContent>
                        </Card>
                        {!!analysis.diagnosticsTotal && (
                          <Card>
                            <CardHeader>
                              <CardTitle className='text-base'>
                                Parser diagnostics ·{' '}
                                {analysis.diagnosticsTotal.toLocaleString()}{' '}
                                total
                              </CardTitle>
                              <p className='text-xs text-muted-foreground'>
                                Latest 100 diagnostic details across
                                the capture. Malformed parsed rows
                                remain accessible through record
                                pagination; pre-schema lines have no
                                reliable timestamp.
                              </p>
                            </CardHeader>
                            <CardContent className='space-y-2'>
                              {analysis.diagnostics.map(
                                (diagnostic, index) => (
                                  <details
                                    key={`${index}:${diagnostic.errorType}`}
                                    className='rounded border p-2 text-xs'
                                  >
                                    <summary>
                                      {diagnostic.errorType}: expected{' '}
                                      {diagnostic.expectedFields},
                                      received{' '}
                                      {diagnostic.receivedValues}
                                    </summary>
                                    <pre className='mt-2 whitespace-pre-wrap break-all'>
                                      {diagnostic.rawLine}
                                    </pre>
                                  </details>
                                ),
                              )}
                            </CardContent>
                          </Card>
                        )}
                      </>
                    )}
                  </>
                )}
            </>
          )}
        </div>
      </ScrollArea>
    </main>
  );
}

function RankingCard({
  title,
  entries,
  metric,
}: {
  title: string;
  entries: CaptureRanking[];
  metric: 'requests' | 'bytes';
}) {
  const maximum = Math.max(1, ...entries.map((entry) => entry.value));
  return (
    <Card className='gap-3 py-4'>
      <CardHeader className='px-4'>
        <CardTitle className='text-base'>{title}</CardTitle>
      </CardHeader>
      <CardContent className='space-y-3 px-4'>
        {entries.length ? (
          entries.map((entry, index) => (
            <div key={entry.name} className='space-y-1'>
              <div className='flex items-center justify-between gap-2 text-sm'>
                <span className='min-w-0 truncate' title={entry.name}>
                  {index + 1}. {entry.name}
                </span>
                <span className='shrink-0 font-mono text-xs'>
                  {metric === 'bytes'
                    ? formatBytes(entry.value)
                    : `${entry.value.toLocaleString()} requests`}{' '}
                  <span className='text-muted-foreground'>
                    ({entry.percentage.toFixed(1)}%)
                  </span>
                </span>
              </div>
              <div className='h-1.5 rounded bg-muted'>
                <div
                  className='h-full rounded bg-primary/70'
                  style={{
                    width: `${(entry.value * 100) / maximum}%`,
                  }}
                />
              </div>
            </div>
          ))
        ) : (
          <p className='text-sm text-muted-foreground'>
            No usable values in this selection.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function RecordTable({
  records,
  formatTime,
  offset,
}: {
  records: TrafficRecord[];
  formatTime: (time: string | null | number) => string;
  offset: number;
}) {
  return (
    <div className='overflow-x-auto'>
      <table className='w-full min-w-[850px] text-left text-xs'>
        <thead>
          <tr className='border-b text-muted-foreground'>
            {[
              '#',
              'Time',
              'Client / user',
              'Destination',
              'Action / filter',
              'HTTP',
              'Bytes',
              'Issues / raw data',
            ].map((title) => (
              <th key={title} className='px-2 py-2 font-medium'>
                {title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {records.map((record, index) => (
            <tr key={record.id} className='border-b align-top'>
              <td className='px-2 py-3 text-muted-foreground'>
                {offset + index + 1}
              </td>
              <td className='whitespace-nowrap px-2 py-3'>
                {formatTime(record.timestamp)}
              </td>
              <td className='px-2 py-3'>
                <div>{fieldValue(record, 'c-ip') || '—'}</div>
                <span className='text-muted-foreground'>
                  {fieldValue(record, 'cs-username') || '—'}
                </span>
              </td>
              <td
                className='max-w-52 truncate px-2 py-3'
                title={destinationOf(record)}
              >
                {destinationOf(record)}
              </td>
              <td className='px-2 py-3'>
                <div>{fieldValue(record, 's-action') || '—'}</div>
                <span className='text-muted-foreground'>
                  {fieldValue(record, 'sc-filter-result') || '—'}
                </span>
              </td>
              <td className='px-2 py-3'>
                {fieldValue(record, 'sc-status') || '—'}
              </td>
              <td className='whitespace-nowrap px-2 py-3'>
                {formatBytes(bytesOf(record))}
              </td>
              <td className='max-w-lg px-2 py-3'>
                <p>
                  {record.issues?.join(' · ') || 'No detected issue'}
                </p>
                <details className='mt-1'>
                  <summary className='cursor-pointer text-primary'>
                    Raw &amp; normalized fields
                  </summary>
                  <ScrollArea className='mt-2 h-64 max-w-xl rounded border p-2'>
                    <p className='mb-2 font-mono'>{record.id}</p>
                    <pre className='whitespace-pre-wrap break-all'>
                      {record.rawLine}
                    </pre>
                    <pre className='mt-3 whitespace-pre-wrap break-all'>
                      {JSON.stringify(
                        {
                          raw: record.rawFields,
                          normalized: record.normalized,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </ScrollArea>
                </details>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!records.length && (
        <p className='py-8 text-center text-sm text-muted-foreground'>
          No records match this range and these filters.
        </p>
      )}
    </div>
  );
}

function Pagination({
  result,
  pageDraft,
  setPageDraft,
  recordDraft,
  setRecordDraft,
  setPage,
  pageSize,
  setPageSize,
  busy,
}: {
  result: CaptureResult;
  pageDraft: string;
  setPageDraft: (value: string) => void;
  recordDraft: string;
  setRecordDraft: (value: string) => void;
  setPage: (value: number) => void;
  pageSize: number;
  setPageSize: (value: number) => void;
  busy: boolean;
}) {
  const goPage = () => {
    const value = Number(pageDraft);
    if (
      Number.isInteger(value) &&
      value >= 1 &&
      value <= result.totalPages
    )
      setPage(value);
    else toast.error(`Choose a page from 1 to ${result.totalPages}.`);
  };
  const goRecord = () => {
    const value = Number(recordDraft);
    if (
      Number.isInteger(value) &&
      value >= 1 &&
      value <= result.totalRecords
    )
      setPage(Math.floor((value - 1) / pageSize) + 1);
    else
      toast.error(
        `Choose a record from 1 to ${result.totalRecords}.`,
      );
  };
  return (
    <div className='mt-4 flex flex-wrap items-center gap-2 border-t pt-3 text-xs'>
      <span>
        {result.totalRecords
          ? (result.page - 1) * result.pageSize + 1
          : 0}
        –
        {Math.min(result.page * result.pageSize, result.totalRecords)}{' '}
        of {result.totalRecords.toLocaleString()} records
      </span>
      <Button
        size='sm'
        variant='outline'
        disabled={busy || result.page <= 1}
        onClick={() => setPage(result.page - 1)}
      >
        Previous
      </Button>
      <Button
        size='sm'
        variant='outline'
        disabled={busy || result.page >= result.totalPages}
        onClick={() => setPage(result.page + 1)}
      >
        Next
      </Button>
      <label className='flex items-center gap-1'>
        Page
        <input
          type='number'
          min={1}
          max={result.totalPages}
          className={`${INPUT} w-20`}
          value={pageDraft}
          onChange={(event) => setPageDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') goPage();
          }}
        />
      </label>
      <span>/ {result.totalPages.toLocaleString()}</span>
      <Button
        size='sm'
        variant='ghost'
        disabled={busy}
        onClick={goPage}
      >
        Go
      </Button>
      <label className='ml-auto flex items-center gap-1'>
        Record #
        <input
          type='number'
          min={1}
          max={result.totalRecords}
          className={`${INPUT} w-24`}
          value={recordDraft}
          onChange={(event) => setRecordDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') goRecord();
          }}
        />
      </label>
      <Button
        size='sm'
        variant='ghost'
        disabled={busy || !result.totalRecords}
        onClick={goRecord}
      >
        Locate page
      </Button>
      <SelectField
        aria-label='Records per page'
        value={pageSize}
        onValueChange={(selectedValue) =>
          setPageSize(Number(selectedValue))
        }
      >
        {[50, 100, 250, 500].map((size) => (
          <SelectOption key={size} value={size}>
            {size} / page
          </SelectOption>
        ))}
      </SelectField>
    </div>
  );
}
