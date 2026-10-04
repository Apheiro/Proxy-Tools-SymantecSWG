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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

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
  unreached: 'Unreached',
  unknown: 'Unknown',
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
    <div ref={parent} className='flex w-full flex-col gap-4'>
      <div className='flex flex-col gap-3 lg:flex-row'>
        <div className='relative min-w-0 flex-1'>
          <Search className='pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground' />
          <Input
            type='search'
            aria-label='Search transactions'
            placeholder={`Search by ${searchBy === 'ip' ? 'client IP' : searchBy === 'url' ? 'URL' : searchBy === 'user' ? 'user' : 'transaction ID'}`}
            className='pl-9'
            onChange={(event) => setSearchFilter(event.target.value)}
            value={searchFilter}
          />
        </div>
        <Select
          value={searchBy}
          onValueChange={(value) => setSearchBy(value as SearchBy)}
        >
          <SelectTrigger
            className='w-full lg:w-48'
            aria-label='Search field'
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='url'>Destination URL</SelectItem>
            <SelectItem value='transaction'>
              Transaction ID
            </SelectItem>
            <SelectItem value='user'>User</SelectItem>
            <SelectItem value='ip'>Client IP</SelectItem>
          </SelectContent>
        </Select>
        <Button
          type='button'
          variant={showAdvanced ? 'secondary' : 'outline'}
          aria-expanded={showAdvanced}
          onClick={() => setShowAdvanced((open) => !open)}
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
        <div className='rounded-xl border bg-muted/20 p-4 md:p-5'>
          <div className='mb-4 flex flex-col gap-1'>
            <h3 className='flex items-center gap-2 text-sm font-semibold'>
              <CalendarClock className='size-4 text-muted-foreground' />
              Refine transactions
            </h3>
            <p className='text-xs text-muted-foreground'>
              Combine a verdict with a recent or custom time window.
            </p>
          </div>

          <div className='flex flex-col gap-5'>
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

            <div className='grid gap-4 md:grid-cols-[minmax(180px,0.7fr)_1fr] md:items-end'>
              <label className='flex flex-col gap-2 text-sm'>
                <span className='text-xs font-medium text-muted-foreground'>
                  Verdicts
                </span>
                <div className='flex flex-wrap gap-2'>
                  <Button
                    type='button'
                    size='sm'
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
                <Input
                  label='From'
                  type='datetime-local'
                  value={start}
                  onChange={(event) => {
                    setStart(event.target.value);
                    setSelectedQuickRange(null);
                  }}
                  className='w-full'
                />
                <Input
                  label='To'
                  type='datetime-local'
                  value={end}
                  onChange={(event) => {
                    setEnd(event.target.value);
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

            <div className='flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end'>
              <Button
                type='button'
                variant='ghost'
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
              <Button type='button' onClick={applyFilters}>
                Apply filters
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
