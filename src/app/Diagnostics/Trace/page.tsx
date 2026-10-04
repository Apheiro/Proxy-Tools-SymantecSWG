/** biome-ignore-all lint/correctness/useUniqueElementIds: <> */
/** biome-ignore-all lint/style/useNamingConvention: <> */
'use client';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import {
  useDebouncedValue,
  useDidUpdate,
  useDisclosure,
} from '@mantine/hooks';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  Activity,
  ShieldAlert,
  ShieldCheck,
  Timer,
} from 'lucide-react';
import dayjs from 'dayjs';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { toast } from 'sonner';
import AdvanceTransactionView from '@/components/advanceTransactionView';
import FilterBar from '@/components/filterBar';
import TransactionCard from '@/components/transactionCard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import evaluatePolicyMatchesFn from '@/lib/evaluatePolicyMatches';
import getCredentials from '@/lib/getCredentials';
import useDataSourceMode from '@/lib/useDataSourceMode';

interface Logs {
  raw: string[];
  json: string[];
}

function errorMessage(error: unknown) {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export default function Page() {
  return (
    <Suspense fallback={<div>Loading</div>}>
      <PageBase />
    </Suspense>
  );
}

function PageBase() {
  const [jsonLogs, setJsonLogs] = useState<TransactionInfo[]>([]);
  const [selectedTransactionId, setSelectedTransactionId] = useState<
    string | null
  >(null);
  const [selectedTransaction, setSelectedTransaction] = useState<{
    log: TransactionInfo;
    raw: string;
  } | null>(null);
  const [openAdvanceTransactionDataModal, openAdvanceModalFns] =
    useDisclosure(false);
  const [filteredLogs, setFilteredLogs] = useState<TransactionInfo[]>(
    [],
  );
  const searchParams = useSearchParams();
  const [parent] = useAutoAnimate({
    duration: 600,
  });
  const [rawLogs, setRawLogs] = useState<string[]>([]);
  const [filter, setFilter] = useState<null | Filters>(null);
  const [searchFilter, setSearchFilter] = useState('');
  const [searchFilterValue] = useDebouncedValue(searchFilter, 500);
  const [searchBy, setSearchBy] = useState<
    'url' | 'transaction' | 'user' | 'ip'
  >('url');
  const { mode, ready: modeReady } = useDataSourceMode();

  //logs collector
  useEffect(() => {
    if (!modeReady) return;
    let unlisten: UnlistenFn | null = null;
    let unlistenError: UnlistenFn | null = null;
    const credentials = getCredentials();
    const ipTraceProxy = searchParams.get('traceUrl') || null;
    const proxyIp = searchParams.get('proxy') || '';
    console.log('ipTraceProxy', ipTraceProxy);
    if (!ipTraceProxy) {
      toast.error('Proxy not found.');
      return;
    }
    if (!credentials) {
      toast.error('Credentials not found.');
      return;
    }
    setJsonLogs([]);
    setRawLogs([]);
    console.log('if passed, starting logs collector');
    (async () => {
      await invoke('stop_logs').catch(() => undefined);
      console.log('creating listener for logs:update');
      unlisten = await listen<Logs>('logs:update', (e) => {
        console.log('logs:update event received', e);
        const json = e.payload.json
          .map<TransactionInfo>((j) => {
            const jso = JSON.parse(j) as TransactionInfo;
            jso.decision.verdict = evaluatePolicyMatchesFn(
              jso.policyMatches,
              jso.timing.checkpoints,
            );
            return jso;
          })
          .sort((a, b) => {
            const aNum = dayjs(b.connection.time).unix();
            const bNum = dayjs(a.connection.time).unix();
            const exta = a.transaction.pid ? aNum - 0.1 : aNum;
            const extb = b.transaction.pid ? bNum - 0.1 : bNum;
            return exta - extb;
          });
        const raw = e.payload.raw;
        setJsonLogs((j) => [...json, ...j]);
        setRawLogs((r) => [...raw, ...r]);
      });
      unlistenError = await listen<string>('logs:error', (event) => {
        toast.error(`Trace request failed: ${event.payload}`);
      });
      console.log('logs start with start_logs');
      const start = invoke('start_logs', {
        ippr: ipTraceProxy,
        proxyIp,
        userpr: credentials?.username,
        passpr: credentials?.password,
        useMockData: mode === 'mock',
      });

      toast.promise(start, {
        loading: 'Starting logs...',
        success: (e) => {
          return 'Logs started successfully.';
        },
        error: (e) => {
          return `Could not start trace collection: ${errorMessage(e)}`;
        },
      });
    })().catch((error: unknown) => {
      toast.error(`Could not start trace collection: ${errorMessage(error)}`);
    });

    return () => {
      console.log('leaving trace page');
      unlisten?.();
      unlistenError?.();
      void invoke('stop_logs');
    };
  }, [mode, modeReady, searchParams]);

  //open advance modal
  useDidUpdate(() => {
    if (selectedTransactionId) {
      setSelectedTransaction({
        log: jsonLogs.find(
          (log) => log.transaction.id === selectedTransactionId,
        ),
        raw: rawLogs.find((raw) =>
          raw.includes(selectedTransactionId),
        ),
      });
      openAdvanceModalFns.open();
    }
  }, [selectedTransactionId]);

  //filter logs
  useEffect(() => {
    if (filter || searchFilter) {
      console.log(filter);
      console.log(searchFilter);
      console.log(jsonLogs[1]);

      const filtered = jsonLogs.filter((log) => {
        let timeGap = true;
        let searchMatch = true;
        let veredictMatch = true;

        const time = dayjs(log.connection.time);
        if (filter?.start && filter?.end) {
          const baseRangeStart = dayjs(filter.start);
          const baseRangeEnd = dayjs(filter.end);
          timeGap = time.isBetween(
            baseRangeStart,
            baseRangeEnd,
            null,
            '[]',
          );
        }
        if (filter?.status?.length) {
          veredictMatch = filter.status.includes(
            log.decision.verdict.toLowerCase(),
          );
        }
        if (searchFilterValue) {
          if (searchBy === 'url')
            searchMatch =
              log.transaction.dest.includes(searchFilterValue);
          else if (searchBy === 'transaction')
            searchMatch =
              log.transaction.id.includes(searchFilterValue);
          else if (searchBy === 'user')
            searchMatch =
              log.user.relativeName.includes(searchFilterValue);
          else if (searchBy === 'ip')
            searchMatch =
              log.connection.client.includes(searchFilterValue);
        }

        return timeGap && searchMatch && veredictMatch;
      });
      setFilteredLogs(filtered);
      return;
    }

    setFilteredLogs(jsonLogs);
  }, [jsonLogs, searchFilterValue, filter, searchBy]);

  const traceUrl = searchParams.get('traceUrl');
  const proxy = searchParams.get('proxy');
  const traceName = traceUrl?.split(/[/?#]/).filter(Boolean).at(-1);
  const allowedCount = jsonLogs.filter(
    (log) => log.decision.verdict.toLowerCase() === 'allowed',
  ).length;
  const rejectedCount = jsonLogs.filter((log) =>
    ['rejected', 'exception'].includes(
      log.decision.verdict.toLowerCase(),
    ),
  ).length;

  return (
    <main className='mx-auto flex min-h-dvh w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-6'>
      <header className='flex flex-col gap-5 border-b pb-6 lg:flex-row lg:items-end lg:justify-between'>
        <div className='flex flex-col gap-2'>
          <div className='flex items-center gap-2 text-sm text-muted-foreground'>
            <Activity className='size-4' />
            Trace analysis
          </div>
          <h1 className='text-2xl font-bold tracking-tight md:text-3xl'>
            {traceName || 'Live transactions'}
          </h1>
          <p className='text-sm text-muted-foreground'>
            {proxy ? `Proxy ${proxy}` : 'Proxy trace'}
            {' · '}Incoming transactions from this trace appear below.
          </p>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          <Badge variant='secondary'>
            {traceUrl ? 'Trace selected' : 'No trace selected'}
          </Badge>
        </div>
      </header>

      <section
        className='grid grid-cols-1 gap-3 sm:grid-cols-3'
        aria-label='Transaction summary'
      >
        <SummaryCard
          label='Transactions received'
          value={jsonLogs.length}
          icon={<Activity className='size-4' />}
        />
        <SummaryCard
          label='Allowed'
          value={allowedCount}
          icon={<ShieldCheck className='size-4' />}
          color='text-green-600 dark:text-green-400'
        />
        <SummaryCard
          label='Rejected or exception'
          value={rejectedCount}
          icon={<ShieldAlert className='size-4' />}
          color='text-red-500'
        />
      </section>

      <Card>
        <CardContent className='p-4 md:p-5'>
          <div className='mb-3 flex items-center gap-2 text-sm font-semibold'>
            <Timer className='size-4 text-muted-foreground' />
            Search and filters
          </div>
          <FilterBar
            filter={filter}
            setFilter={setFilter}
            setSearchFilter={setSearchFilter}
            setSearchBy={setSearchBy}
            searchBy={searchBy}
            searchFilter={searchFilter}
          />
        </CardContent>
      </Card>

      <AdvanceTransactionView
        isOpen={openAdvanceTransactionDataModal}
        modalFns={openAdvanceModalFns}
        selectedTransaction={selectedTransaction}
        setSelectedTransactionId={setSelectedTransactionId}
      />

      <section
        className='flex flex-col gap-4'
        aria-labelledby='transaction-list-title'
      >
        <div className='flex items-end justify-between gap-3'>
          <div>
            <h2
              id='transaction-list-title'
              className='text-xl font-semibold'
            >
              Transactions
            </h2>
            <p className='mt-1 text-sm text-muted-foreground'>
              {filteredLogs.length} shown · {jsonLogs.length} received
            </p>
          </div>
          {searchFilter && (
            <Button
              type='button'
              variant='ghost'
              size='sm'
              onClick={() => setSearchFilter('')}
            >
              Clear search
            </Button>
          )}
        </div>

        {filteredLogs.length > 0 ? (
          <section
            ref={parent}
            className='flex flex-col items-center gap-3'
          >
            {filteredLogs.map((log) => (
              <TransactionCard
                key={log.transaction.id}
                log={log}
                setSelectedTransactionId={setSelectedTransactionId}
              />
            ))}
          </section>
        ) : jsonLogs.length > 0 ? (
          <div className='rounded-xl border border-dashed p-10 text-center'>
            <h3 className='font-medium'>
              No transactions match these filters
            </h3>
            <p className='mt-1 text-sm text-muted-foreground'>
              Adjust or clear your search and filters to see more
              results.
            </p>
          </div>
        ) : traceUrl ? (
          <div className='flex min-h-52 flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center'>
            <span className='size-2 animate-pulse rounded-full bg-primary' />
            <div>
              <h3 className='font-medium'>
                Waiting for trace records
              </h3>
              <p className='mt-1 text-sm text-muted-foreground'>
                New transactions will appear here as they arrive.
              </p>
            </div>
          </div>
        ) : (
          <div className='rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground'>
            No trace was selected. Return to Diagnostics and choose a
            trace.
          </div>
        )}
      </section>
    </main>
  );
}

function SummaryCard({
  label,
  value,
  icon,
  color = 'text-muted-foreground',
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color?: string;
}) {
  return (
    <Card className='gap-2 p-4'>
      <p className='text-sm text-muted-foreground'>{label}</p>
      <p
        className={`flex items-center gap-2 text-2xl font-semibold ${color}`}
      >
        {icon}
        {value}
      </p>
    </Card>
  );
}
