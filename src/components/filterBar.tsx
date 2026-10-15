import { useAutoAnimate } from '@formkit/auto-animate/react';
import dayjs from 'dayjs';
import {
  CalendarClock,
  Clock3,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DateTimePicker } from '@/components/ui/date-time-picker';
import { dateTimeToISO, isoToDateTime } from '@/lib/dateTime';
import { SelectField, SelectOption } from '@/components/ui/select';

type SearchBy = 'url' | 'transaction' | 'user' | 'ip';
type QuickRange = '15m' | '1h' | '4h' | '24h';

const quickRanges: {
  value: QuickRange;
  label: string;
  minutes: number;
}[] = [
  { value: '15m', label: '15 min', minutes: 15 },
  { value: '1h', label: '1 hour', minutes: 60 },
  { value: '4h', label: '4 hours', minutes: 240 },
  { value: '24h', label: '24 hours', minutes: 1440 },
];

const statusLabels: Record<string, string> = {
  allowed: 'Allowed',
  rejected: 'Rejected',
  exception: 'Exception',
  unknown: 'Not reported / unclassified',
};

function withoutRange(filter: Filters | null): Filters | null {
  if (!filter) return null;
  const next = { ...filter, start: undefined, end: undefined };
  return next.status?.length ? next : null;
}

function withoutStatus(filter: Filters | null): Filters | null {
  if (!filter) return null;
  const next = { ...filter, status: undefined };
  return next.start && next.end ? next : null;
}

export default function FilterBar({
  filter,
  setFilter,
  searchBy,
  setSearchBy,
  setSearchFilter,
  searchFilter,
}: {
  filter: Filters | null;
  setFilter: Dispatch<SetStateAction<Filters | null>>;
  searchBy: SearchBy;
  setSearchBy: Dispatch<SetStateAction<SearchBy>>;
  setSearchFilter: Dispatch<SetStateAction<string>>;
  searchFilter: string;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [status, setStatus] = useState<string[]>([]);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [rangeError, setRangeError] = useState('');
  const [selectedQuickRange, setSelectedQuickRange] =
    useState<QuickRange | null>(null);
  const [parent] = useAutoAnimate({ duration: 200 });

  useEffect(() => {
    setStatus(filter?.status || []);
    setStart(
      filter?.start
        ? dayjs(filter.start).format('YYYY-MM-DDTHH:mm')
        : '',
    );
    setEnd(
      filter?.end ? dayjs(filter.end).format('YYYY-MM-DDTHH:mm') : '',
    );
  }, [filter]);

  const hasStatus = Boolean(filter?.status?.length);
  const hasRange = Boolean(filter?.start && filter?.end);
  const activeFilterCount = Number(hasStatus) + Number(hasRange);

  const applyFilters = () => {
    setRangeError('');
    if (Boolean(start) !== Boolean(end)) {
      setRangeError('Choose both a start and end time.');
      return;
    }

    const next: Filters = {};
    if (status.length) next.status = status;
    if (start && end) {
      if (dayjs(start).isAfter(dayjs(end))) {
        setRangeError('The start time must be before the end time.');
        return;
      }
      next.start = dayjs(start).format('YYYY-MM-DDTHH:mm:ss');
      next.end = dayjs(end).format('YYYY-MM-DDTHH:mm:ss');
    }

    setFilter(Object.keys(next).length ? next : null);
    setSelectedQuickRange(null);
  };

  const applyQuickRange = (range: (typeof quickRanges)[number]) => {
    const now = dayjs().second(0).millisecond(0);
    const startTime = now.subtract(range.minutes, 'minute');
    setRangeError('');
    setSelectedQuickRange(range.value);
    setStart(startTime.format('YYYY-MM-DDTHH:mm'));
    setEnd(now.format('YYYY-MM-DDTHH:mm'));
    setFilter((current) => {
      const next: Filters = {
        ...current,
        start: startTime.format('YYYY-MM-DDTHH:mm:ss'),
        end: now.format('YYYY-MM-DDTHH:mm:ss'),
      };
      if (status.length) next.status = status;
      else delete next.status;
      return next;
    });
  };

  const clearAll = () => {
    setFilter(null);
    setSearchFilter('');
    setStatus([]);
    setStart('');
    setEnd('');
    setRangeError('');
    setSelectedQuickRange(null);
  };

  return (
    <div ref={parent} className='flex w-full flex-col gap-3'>
      <div className='grid grid-cols-[minmax(0,1fr)_auto] gap-2 lg:flex'>
        <div className='relative col-span-2 min-w-0 lg:flex-1'>
          <Search className='pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground' />
          <Input
            type='search'
            aria-label='Search transactions'
            placeholder={`Search by ${searchBy === 'ip' ? 'client IP' : searchBy === 'url' ? 'URL' : searchBy === 'user' ? 'user' : 'transaction ID'}`}
            className='h-8 pl-9 text-sm'
            onChange={(event) => setSearchFilter(event.target.value)}
            value={searchFilter}
          />
        </div>
        <SelectField
          size='sm'
          className='w-full lg:w-48'
          aria-label='Search field'
          value={searchBy}
          onValueChange={(value) => setSearchBy(value as SearchBy)}
        >
          <SelectOption value='url'>Destination URL</SelectOption>
          <SelectOption value='transaction'>
            Transaction ID
          </SelectOption>
          <SelectOption value='user'>User</SelectOption>
          <SelectOption value='ip'>Client IP</SelectOption>
        </SelectField>
        <Button
          type='button'
          variant={showAdvanced ? 'secondary' : 'outline'}
          aria-expanded={showAdvanced}
          onClick={() => setShowAdvanced((open) => !open)}
          size='sm'
          className='shrink-0'
        >
          <SlidersHorizontal className='size-4' />
          Filters
          {activeFilterCount > 0 && (
            <span className='ml-1 flex size-5 items-center justify-center rounded-full bg-primary text-[11px] text-primary-foreground'>
              {activeFilterCount}
            </span>
          )}
        </Button>
      </div>

      {activeFilterCount > 0 && (
        <div className='flex flex-wrap items-center gap-2'>
          <span className='text-xs font-medium text-muted-foreground'>
            Active filters
          </span>
          {hasStatus && (
            <Badge variant='secondary' className='gap-1'>
              {filter.status
                .map((item) => statusLabels[item] || item)
                .join(', ')}
              <button
                type='button'
                aria-label='Remove status filter'
                onClick={() =>
                  setFilter((current) => withoutStatus(current))
                }
                className='rounded-full hover:text-foreground'
              >
                <X className='size-3' />
              </button>
            </Badge>
          )}
          {hasRange && (
            <Badge variant='secondary' className='gap-1'>
              <Clock3 className='size-3' />
              {dayjs(filter.start).format('MMM D, HH:mm')} –{' '}
              {dayjs(filter.end).format('MMM D, HH:mm')}
              <button
                type='button'
                aria-label='Remove time range filter'
                onClick={() => {
                  setFilter((current) => withoutRange(current));
                  setSelectedQuickRange(null);
                  setStart('');
                  setEnd('');
                }}
                className='rounded-full hover:text-foreground'
              >
                <X className='size-3' />
              </button>
            </Badge>
          )}
          <Button
            type='button'
            variant='ghost'
            size='sm'
            className='h-7 px-2 text-xs text-muted-foreground'
            onClick={clearAll}
          >
            Clear all
          </Button>
        </div>
      )}

      {showAdvanced && (
        <div className='border-t pt-3'>
          <div className='mb-3 flex flex-col gap-1'>
            <h3 className='flex items-center gap-2 text-xs font-semibold'>
              <CalendarClock className='size-4 text-muted-foreground' />
              Refine transactions
            </h3>
          </div>

          <div className='flex flex-col gap-3'>
            <div className='flex flex-col gap-2'>
              <span className='text-xs font-medium text-muted-foreground'>
                Quick time ranges
              </span>
              <div className='flex flex-wrap gap-2'>
                {quickRanges.map((range) => (
                  <Button
                    key={range.value}
                    type='button'
                    size='sm'
                    className='h-7 px-2 text-xs'
                    variant={
                      selectedQuickRange === range.value
                        ? 'secondary'
                        : 'outline'
                    }
                    onClick={() => applyQuickRange(range)}
                  >
                    {range.label}
                  </Button>
                ))}
              </div>
            </div>

            <div className='grid gap-3 md:grid-cols-[minmax(180px,0.7fr)_1fr] md:items-end'>
              <label className='flex flex-col gap-2 text-sm'>
                <span className='text-xs font-medium text-muted-foreground'>
                  Verdicts
                </span>
                <div className='flex flex-wrap gap-2'>
                  <Button
                    type='button'
                    size='sm'
                    className='h-7 px-2 text-xs'
                    variant={
                      status.length === 0 ? 'secondary' : 'outline'
                    }
                    aria-pressed={status.length === 0}
                    onClick={() => setStatus([])}
                  >
                    All
                  </Button>
                  {Object.entries(statusLabels).map(
                    ([value, label]) => {
                      const selected = status.includes(value);
                      return (
                        <Button
                          key={value}
                          type='button'
                          size='sm'
                          className='h-7 px-2 text-xs'
                          variant={selected ? 'secondary' : 'outline'}
                          aria-pressed={selected}
                          onClick={() =>
                            setStatus((current) =>
                              selected
                                ? current.filter(
                                    (item) => item !== value,
                                  )
                                : [...current, value],
                            )
                          }
                        >
                          {label}
                        </Button>
                      );
                    },
                  )}
                </div>
              </label>

              <div className='grid gap-3 sm:grid-cols-2'>
                <DateTimePicker
                  label='From'
                  value={dateTimeToISO(start)}
                  onChange={(value) => {
                    setStart(isoToDateTime(value));
                    setSelectedQuickRange(null);
                  }}
                  className='w-full'
                />
                <DateTimePicker
                  label='To'
                  value={dateTimeToISO(end)}
                  onChange={(value) => {
                    setEnd(isoToDateTime(value));
                    setSelectedQuickRange(null);
                  }}
                  className='w-full'
                />
              </div>
            </div>

            {rangeError && (
              <p role='alert' className='text-sm text-destructive'>
                {rangeError}
              </p>
            )}

            <div className='flex flex-col-reverse gap-2 border-t pt-3 sm:flex-row sm:justify-end'>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                onClick={() => {
                  setFilter(null);
                  setStatus([]);
                  setStart('');
                  setEnd('');
                  setSelectedQuickRange(null);
                  setRangeError('');
                }}
              >
                Reset filters
              </Button>
              <Button type='button' size='sm' onClick={applyFilters}>
                Apply filters
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
