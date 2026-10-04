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
import dayjs from 'dayjs';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { toast } from 'sonner';
import AdvanceTransactionView from '@/components/advanceTransactionView';
import FilterBar from '@/components/filterBar';
import TransactionCard from '@/components/transactionCard';
import evaluatePolicyMatchesFn from '@/lib/evaluatePolicyMatches';
import getCredentials from '@/lib/getCredentials';

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

  //logs collector
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    const credentials = getCredentials();
    const ipTraceProxy = searchParams.get('traceUrl') || null;
    console.log('ipTraceProxy', ipTraceProxy);
    if (!ipTraceProxy) {
      toast.error('Proxy not found.');
      return;
    }
    if (!credentials) {
      toast.error('Credentials not found.');
      return;
    }
    console.log('if passed, starting logs collector');
    (async () => {
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
      console.log('logs start with start_logs');
      const start = invoke('start_logs', {
        ippr: ipTraceProxy,
        userpr: credentials?.username,
        passpr: credentials?.password,
      });

      toast.promise(start, {
        loading: 'Starting logs...',
        success: (e) => {
          return 'Logs started successfully.';
        },
        error: (e) => {
          return `Error starting logs: ${e}`;
        },
      });
    })();

    return () => {
      console.log('leaving trace page');
      unlisten?.();
      void invoke('stop_logs');
    };
  }, [searchParams]);

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

        const time = dayjs(log.connection.time).set(
          'date',
          dayjs().date(),
        );
        if (filter?.start && filter?.end) {
          const baseRangeStart = dayjs(filter.start);
          const baseRangeEnd = dayjs(filter.end);
          const start = time
            .set('hour', baseRangeStart.hour())
            .set('minute', baseRangeStart.minute())
            .set('second', baseRangeStart.second());
          const end = time
            .set('hour', baseRangeEnd.hour())
            .set('minute', baseRangeEnd.minute())
            .set('second', baseRangeEnd.second());

          console.log(time.isBetween(start, end, null, '[]'));
          timeGap = time.isBetween(start, end, null, '[]');
        }
        if (filter?.status && filter?.status !== 'all') {
          veredictMatch =
            log.decision.verdict.toLowerCase() === filter.status;
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

  return (
    <main className='w-dvw min-h-dvh flex flex-col gap-3 px-3'>
      <FilterBar
        setFilter={setFilter}
        setSearchFilter={setSearchFilter}
        setSearchBy={setSearchBy}
        searchBy={searchBy}
        searchFilter={searchFilter}
      />
      <AdvanceTransactionView
        isOpen={openAdvanceTransactionDataModal}
        modalFns={openAdvanceModalFns}
        selectedTransaction={selectedTransaction}
        setSelectedTransactionId={setSelectedTransactionId}
      />
      <section
        ref={parent}
        className='flex flex-col items-center gap-2'
      >
        {filteredLogs.map((log) => (
          <TransactionCard
            key={log.transaction.id}
            log={log}
            setSelectedTransactionId={setSelectedTransactionId}
          />
        ))}
      </section>
    </main>
  );
}
