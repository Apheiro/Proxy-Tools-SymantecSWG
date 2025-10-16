/** biome-ignore-all lint/correctness/useUniqueElementIds: <> */
/** biome-ignore-all lint/style/useNamingConvention: <> */
'use client';
import { useAutoAnimate } from '@formkit/auto-animate/react';
import { useDidUpdate, useDisclosure } from '@mantine/hooks';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import dayjs from 'dayjs';
import { Filter } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import {
  type Dispatch,
  type FormEvent,
  type SetStateAction,
  Suspense,
  useEffect,
  useRef,
  useState,
} from 'react';
import { toast } from 'sonner';
import AdvanceTransactionView from '@/components/advanceTransactionView';
import TransactionCard from '@/components/transactionCard';
import { Button } from '@/components/ui/button';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  deleteLocalStorage,
  getLocalStorage,
} from '@/lib/utilsClient';

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

// function filterBy() {}

function isEmpty(obj: object) {
  let isEmpty = true;
  for (const key in obj) {
    if (obj[key] !== '' && obj[key] !== null) {
      isEmpty = false;
      break;
    }
  }
  return isEmpty;
}

function createFilterObj(
  e: FormEvent<HTMLFormElement>,
): Filters | null {
  e.preventDefault();
  const formData = Object.fromEntries(new FormData(e.currentTarget));
  if (isEmpty(formData)) return null;
  console.log('is not empty');
  let filter: Filters = {};
  if (formData.timePickerStart && formData.timePickerEnd) {
    const [hourStart, minuteStart, secondStart] = (
      formData.timePickerStart as string
    )
      .split(':')
      .map(Number);
    const [hourEnd, minuteEnd, secondEnd] = (
      formData.timePickerEnd as string
    )
      .split(':')
      .map(Number);

    filter = {
      start: dayjs()
        .hour(hourStart)
        .minute(minuteStart)
        .second(secondStart)
        .format('YYYY-MM-DD HH:mm:ss'),
      end: dayjs()
        .hour(hourEnd)
        .minute(minuteEnd)
        .second(secondEnd)
        .format('YYYY-MM-DD HH:mm:ss'),
    };
  }
  console.log(formData.status);
  if (formData.status !== '') {
    filter.status = formData.status as string;
  }
  return filter;
}

function FilterBar({
  setFilter,
  setSearchFilter,
  searchFilter,
}: {
  setFilter: Dispatch<SetStateAction<Filters>>;
  setSearchFilter: Dispatch<SetStateAction<string>>;
  searchFilter: string;
}) {
  const [show, setShow] = useState(false);
  const selectInputRef = useRef<HTMLInputElement>(null);
  const [parent] = useAutoAnimate({
    duration: 200,
  });

  return (
    <div
      className='flex justify-center flex-col items-center gap-3 w-full'
      ref={parent}
    >
      <div className='flex justify-center items-center gap-3 w-full'>
        <Input
          type='search'
          placeholder='Search'
          className='max-w-70'
        />
        <Select>
          <SelectTrigger className='w-fit'>
            <SelectValue placeholder='By: URL ' />
          </SelectTrigger>
          <SelectContent defaultValue={'url'}>
            <SelectItem value='url'>Url</SelectItem>
            <SelectItem value='transaction'>
              Transaction ID
            </SelectItem>
            <SelectItem value='user'>User</SelectItem>
          </SelectContent>
        </Select>

        <Button
          onClick={() => setShow(!show)}
          variant={show ? 'default' : 'outline'}
        >
          <Filter />
        </Button>
      </div>
      {show && (
        <form
          onSubmit={(e) => {
            const filter = createFilterObj(e);
            console.log(filter);
            if (filter) setFilter(filter);
          }}
          className='flex justify-center items-center gap-3 w-full'
        >
          <input type='hidden' ref={selectInputRef} name='status' />
          <Select
            onValueChange={(v) => {
              if (selectInputRef.current)
                selectInputRef.current.value = v;
            }}
          >
            <SelectTrigger className='w-fit' name='status'>
              <SelectValue placeholder='Status' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>All</SelectItem>
              <SelectItem value='allow'>Allow</SelectItem>
              <SelectItem value='deny'>Denied</SelectItem>
              <SelectItem value='exception'>Exception</SelectItem>
              <SelectItem value='unreachable'>Unreachable</SelectItem>
              <SelectItem value='unknown'>Unknown</SelectItem>
            </SelectContent>
          </Select>
          <div className='flex items-center gap-2'>
            <Input
              type='time'
              name='timePickerStart'
              step='1'
              className='w-fit appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none'
            />
            -
            <Input
              type='time'
              name='timePickerEnd'
              step='1'
              className='w-fit appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none'
            />
          </div>
          <Button variant='outline' type='submit'>
            Apply filter
          </Button>
        </form>
      )}
    </div>
  );
}

interface Filters {
  start?: string;
  end?: string;
  status?: string;
}

function checkStatus(status: string, log: TransactionInfo) {
  switch (status) {
    case 'all':
      return true;
    case 'allow':
      return (
        log.decision.verdict.includes('ALLOWED') &&
        log.timing.checkpoints['client-out'] !== null
      );
    case 'deny':
      return log.decision.verdict.includes('REJECTED');
    case 'unreachable':
      return log.timing.checkpoints['client-out'] === null;
    case 'unknown':
      return true;
    case 'exception': {
      let exception = false;
      for (const { matches } of log.policyMatches) {
        if (matches.includes('exception')) exception = true;
      }
      return exception;
    }
  }
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
  const [credentials, setCredentials] = useState<Credentials | null>(
    null,
  );
  const [ip, setIP] = useState('');
  const searchParams = useSearchParams();
  const [parent] = useAutoAnimate({
    duration: 600,
  });
  const [rawLogs, setRawLogs] = useState<string[]>([]);
  const [filter, setFilter] = useState<null | Filters>(null);
  const [searchFilter, setSearchFilter] = useState('');

  useEffect(() => {
    const cred = getLocalStorage<Credentials>('credentials');
    const oneTimeCred = getLocalStorage<Credentials>(
      'one-time-credentials',
    );
    if (cred) {
      setCredentials(cred);
    } else if (oneTimeCred) {
      setCredentials(oneTimeCred);
    }

    if (searchParams.get('proxy'))
      setIP(searchParams.get('proxy') || '');
  }, [searchParams]);

  useDidUpdate(() => {
    let unlisten: UnlistenFn | null = null;

    (async () => {
      unlisten = await listen<Logs>('logs:update', (e) => {
        const json = e.payload.json
          .map<TransactionInfo>((j) => JSON.parse(j))
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

      const start = invoke('start_logs', {
        ippr: ip,
        userpr: credentials?.username,
        passpr: credentials?.password,
      });

      toast.promise(start, {
        loading: 'Starting logs...',
        success: () => {
          deleteLocalStorage('one-time-credentials');
          return 'Logs started successfully.';
        },
        error: (e) => {
          deleteLocalStorage('one-time-credentials');
          return `Error starting logs: ${e}`;
        },
      });
    })();

    return () => {
      unlisten?.();
      void invoke('stop_logs');
    };
  }, [ip]);

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

  useEffect(() => {
    if (!filter) {
      setFilteredLogs(jsonLogs);
      return;
    }

    const filtered = jsonLogs.filter((log) => {
      const time = dayjs(log.connection.time).set(
        'date',
        dayjs().date(),
      );
      // const url = log.transaction.dest;
      let timeGap = true;
      if (filter.start) {
        console.log('got something?', filter.start, filter.end);
        timeGap = time.isBetween(
          dayjs(filter.start),
          dayjs(filter.end),
          'hours',
        );
      }
      const status = checkStatus(filter.status || '', log);
      return timeGap && status;
    });
    setFilteredLogs(filtered);
  }, [jsonLogs, searchFilter, filter]);

  return (
    <main className='w-dvw min-h-dvh flex flex-col gap-3 px-3'>
      <FilterBar
        setFilter={setFilter}
        setSearchFilter={setSearchFilter}
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
