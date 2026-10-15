'use client';
import { useDebouncedValue, useDisclosure } from '@mantine/hooks';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import dayjs from 'dayjs';
import {
  Activity,
  CircleHelp,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { toast } from 'sonner';
import AdvanceTransactionView from '@/components/advanceTransactionView';
import FilterBar from '@/components/filterBar';
import PageHeader from '@/components/pageHeader';
import TraceTransactionList from '@/components/traceTransactionList';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { SelectField, SelectOption } from '@/components/ui/select';
import { useCredentialRevision } from '@/lib/credentialStore';
import { cva } from '@/lib/cva';
import getCredentials from '@/lib/getCredentials';
import {
  mergeTraceEntries,
  type TraceEntry,
  traceEntry,
  traceRelations,
} from '@/lib/policyTrace';
import {
  TRACE_GROUPING_KEY,
  type TraceGrouping,
} from '@/lib/traceFlows';
import useDataSourceMode from '@/lib/useDataSourceMode';

interface Logs {
  raw: string[];
  json: string[];
}

export default function Page() {
  return (
    <Suspense fallback={<div>Loading</div>}>
      <PageBase />
    </Suspense>
  );
}

function PageBase() {
  const [entries, setEntries] = useState<TraceEntry[]>([]);
  const [grouping, setGrouping] = useState<TraceGrouping>('none');
  useEffect(() => {
    if (localStorage.getItem(TRACE_GROUPING_KEY) === 'flow')
      setGrouping('flow');
  }, []);
  const changeGrouping = (value: string) => {
    const next = value === 'flow' ? 'flow' : 'none';
    setGrouping(next);
    localStorage.setItem(TRACE_GROUPING_KEY, next);
  };
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detailsOpen, modalFns] = useDisclosure(false);
  const [filter, setFilter] = useState<Filters | null>(null);
  const [searchFilter, setSearchFilter] = useState('');
  const [searchValue] = useDebouncedValue(searchFilter, 300);
  const [searchBy, setSearchBy] = useState<
    'url' | 'transaction' | 'user' | 'ip'
  >('url');
  const searchParams = useSearchParams();
  const traceUrl = searchParams.get('traceUrl');
  const proxy = searchParams.get('proxy') || '';
  const { mode, ready } = useDataSourceMode();
  const credentialRevision = useCredentialRevision();
  const traceName = traceUrl?.split(/[/?#]/).filter(Boolean).at(-1);

  useEffect(() => {
    if (!ready) return;
    setEntries([]);
    setSelectedKey(null);
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    let unlistenError: UnlistenFn | undefined;
    const credentials = getCredentials();
    if (!traceUrl) return;
    if (mode === 'live' && !credentials) {
      toast.error('Credentials not found.');
      return;
    }
    void (async () => {
      await invoke('stop_logs').catch(() => undefined);
      if (disposed) return;
      const off = await listen<Logs>('logs:update', ({ payload }) => {
        if (disposed) return;
        const batch: TraceEntry[] = [];
        payload.json.forEach((encoded, index) => {
          try {
            const log = JSON.parse(encoded) as TransactionInfo;
            batch.push(
              traceEntry(
                log,
                payload.raw[index] ?? 'Raw block not available.',
              ),
            );
          } catch {
            toast.error(
              'A malformed trace record could not be displayed.',
            );
          }
        });
        setEntries((previous) => mergeTraceEntries(previous, batch));
      });
      if (disposed) {
        off();
        return;
      }
      unlisten = off;
      const offError = await listen<string>(
        'logs:error',
        ({ payload }) => {
          if (!disposed)
            toast.error(`Trace request failed: ${payload}`);
        },
      );
      if (disposed) {
        offError();
        return;
      }
      unlistenError = offError;
      await invoke('start_logs', {
        ippr: traceUrl,
        proxyIp: proxy,
        userpr: mode === 'live' ? (credentials?.username ?? '') : '',
        passpr: mode === 'live' ? (credentials?.password ?? '') : '',
        useMockData: mode === 'mock',
      });
    })().catch((error) => {
      if (!disposed)
        toast.error(
          `Could not start trace collection: ${String(error)}`,
        );
    });
    return () => {
      disposed = true;
      unlisten?.();
      unlistenError?.();
      void invoke('stop_logs');
    };
  }, [mode, ready, traceUrl, proxy, credentialRevision]);

  const relations = useMemo(() => traceRelations(entries), [entries]);
  const selectedEntry = useMemo(
    () => entries.find((entry) => entry.key === selectedKey),
    [entries, selectedKey],
  );
  const selectedTransaction = useMemo(
    () =>
      selectedEntry
        ? { log: selectedEntry.log, raw: selectedEntry.raw }
        : null,
    [selectedEntry],
  );
  const selectEntry = useCallback(
    (key: string) => {
      setSelectedKey(key);
      modalFns.open();
    },
    [modalFns.open],
  );
  const filtered = useMemo(() => {
    const search = searchValue.trim().toLocaleLowerCase();
    const start = filter?.start
      ? dayjs(filter.start).valueOf()
      : null;
    const end = filter?.end ? dayjs(filter.end).valueOf() : null;
    return entries.filter((entry) => {
      if (
        filter?.status?.length &&
        !filter.status.includes(entry.outcome.verdict)
      )
        return false;
      if (start != null || end != null) {
        if (entry.timestamp.epoch == null) return false;
        if (start != null && entry.timestamp.epoch < start)
          return false;
        if (end != null && entry.timestamp.epoch > end) return false;
      }
      const log = entry.log;
      const value =
        searchBy === 'url'
          ? log.transaction.dest
          : searchBy === 'transaction'
            ? log.transaction.id
            : searchBy === 'user'
              ? `${log.user.name ?? ''} ${log.user.relativeName ?? ''}`
              : log.connection.client;
      return (
        !search || (value ?? '').toLocaleLowerCase().includes(search)
      );
    });
  }, [entries, filter, searchValue, searchBy]);
  const counts = useMemo(() => {
    const result = {
      allowed: 0,
      rejected: 0,
      exception: 0,
      unknown: 0,
    };
    for (const entry of entries) result[entry.outcome.verdict]++;
    return result;
  }, [entries]);

  return (
    <main className='mx-auto flex min-h-[calc(100dvh-90px)] w-full max-w-7xl flex-col gap-4 px-4 py-5 md:px-6'>
      <PageHeader
        icon={Activity}
        eyebrow='Trace analysis'
        title={traceName || 'Live transactions'}
        description={`${proxy ? `Proxy ${proxy}` : 'Proxy trace'} · Processing stages and policy evidence for each transaction.`}
        actions={
          <Badge variant='secondary'>
            {traceUrl ? 'Trace selected' : 'No trace selected'}
          </Badge>
        }
      />
      <section
        className='grid grid-cols-2 gap-2 sm:grid-cols-4'
        aria-label='Transaction summary'
      >
        <SummaryCard
          label='Transactions received'
          value={entries.length}
          icon={<Activity className='size-4' />}
        />
        <SummaryCard
          label='Policy allowed'
          value={counts.allowed}
          icon={<ShieldCheck className='size-4' />}
          tone='allowed'
        />
        <SummaryCard
          label='Denied or exception'
          value={counts.rejected + counts.exception}
          icon={<ShieldAlert className='size-4' />}
          tone='issue'
        />
        <SummaryCard
          label='No classified result'
          value={counts.unknown}
          icon={<CircleHelp className='size-4' />}
        />
      </section>
      <Card
        className='gap-0 py-0'
        role='search'
        aria-label='Filter transactions'
      >
        <CardContent className='p-3'>
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
        isOpen={detailsOpen}
        modalFns={modalFns}
        selectedTransaction={selectedTransaction}
        setSelectedTransactionId={setSelectedKey}
        outcome={selectedEntry?.outcome}
        parent={
          selectedEntry
            ? relations.parents.get(selectedEntry.key)
            : undefined
        }
        children={
          selectedEntry
            ? relations.children.get(selectedEntry.key)
            : undefined
        }
        onSelectRelated={selectEntry}
      />
      <section
        className='flex min-w-0 flex-col gap-4'
        aria-labelledby='transaction-list-title'
      >
        <div className='flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between'>
          <div>
            <h2
              id='transaction-list-title'
              className='text-xl font-semibold'
            >
              Transactions
            </h2>
            <p className='mt-1 text-sm text-muted-foreground'>
              {filtered.length} shown · {entries.length} received
            </p>
          </div>
          <div className='flex flex-wrap items-center gap-2'>
            <label
              htmlFor='trace-group-by'
              className='text-xs text-muted-foreground'
            >
              Group by
            </label>
            <SelectField
              id='trace-group-by'
              value={grouping}
              onValueChange={changeGrouping}
              size='sm'
              className='w-44'
            >
              <SelectOption value='none'>No grouping</SelectOption>
              <SelectOption value='flow'>Related flow</SelectOption>
            </SelectField>
            {!!searchFilter && (
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
        </div>
        <p className='text-xs text-muted-foreground'>
          Policy decisions do not confirm network delivery. Only
          recorded checkpoints and explicit handoff IDs are shown.
          Missing checkpoints do not indicate a failure.
          {grouping === 'flow' &&
            ' First and last record describe the captured span, not the lifetime of a connection.'}
        </p>
        {filtered.length ? (
          <TraceTransactionList
            entries={filtered}
            allEntries={entries}
            grouping={grouping}
            relations={relations}
            onSelect={selectEntry}
            filterKey={JSON.stringify([
              searchValue,
              searchBy,
              filter,
            ])}
          />
        ) : entries.length ? (
          <div className='rounded-xl border border-dashed p-10 text-center'>
            <h3 className='font-medium'>
              No transactions match these filters
            </h3>
            <p className='mt-1 text-sm text-muted-foreground'>
              Adjust or clear your search and filters to see more
              results.
            </p>
          </div>
        ) : (
          <div className='rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground'>
            {traceUrl
              ? 'Waiting for trace records…'
              : 'No trace was selected. Return to Diagnostics and choose a trace.'}
          </div>
        )}
      </section>
    </main>
  );
}

const summaryIconStyles = cva({
  base: 'flex size-8 shrink-0 items-center justify-center rounded-md',
  variants: {
    tone: {
      neutral: 'bg-muted/60 text-muted-foreground',
      allowed: 'bg-green-500/10 text-green-700 dark:text-green-400',
      issue: 'bg-destructive/10 text-destructive',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

function SummaryCard({
  label,
  value,
  icon,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone?: 'neutral' | 'allowed' | 'issue';
}) {
  return (
    <Card className='flex-row items-center gap-2.5 px-3 py-2.5'>
      <span
        aria-hidden='true'
        className={summaryIconStyles({ tone })}
      >
        {icon}
      </span>
      <div className='min-w-0'>
        <p className='text-xs leading-snug text-muted-foreground'>
          {label}
        </p>
        <p className='mt-0.5 text-lg font-semibold leading-none tabular-nums'>
          {value.toLocaleString()}
        </p>
      </div>
    </Card>
  );
}
