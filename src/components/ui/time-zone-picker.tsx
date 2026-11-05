'use client';

import { useMemo, useState } from 'react';
import { Globe2, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

export function TimeZonePicker({
  value,
  onChange,
  title = 'Time zone',
  description,
}: {
  value: string;
  onChange: (value: string) => void;
  title?: string;
  description?: string;
}) {
  const [zoneSearch, setZoneSearch] = useState('');
  const [zoneOpen, setZoneOpen] = useState(false);
  const zones = useMemo(
    () =>
      Array.from(
        new Set([
          'UTC',
          Intl.DateTimeFormat().resolvedOptions().timeZone,
          ...Intl.supportedValuesOf('timeZone'),
        ]),
      ).sort(),
    [],
  );
  return (
    <Popover open={zoneOpen} onOpenChange={setZoneOpen}>
      <PopoverTrigger asChild>
        <Button
          variant='outline'
          className='max-w-full'
          aria-label={`Time zone: ${value}`}
        >
          <Globe2 />
          <span className='max-w-48 truncate'>{value}</span>
          <ChevronDown className='size-3' />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className='w-80 space-y-3'
        aria-label='Time zone preference'
      >
        <div>
          <h2 className='text-sm font-medium'>{title}</h2>
          {description && (
            <p className='mt-1 text-xs text-muted-foreground'>
              {description}
            </p>
          )}
        </div>
        <input
          aria-label='Search time zones'
          placeholder='Search IANA time zone…'
          className='h-9 w-full rounded-md border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
          value={zoneSearch}
          onChange={(e) => setZoneSearch(e.target.value)}
        />
        <div
          className='max-h-56 space-y-1 overflow-y-auto'
          role='group'
          aria-label='Time zones'
        >
          {zones
            .filter((z) =>
              z.toLowerCase().includes(zoneSearch.toLowerCase()),
            )
            .map((z) => (
              <button
                key={z}
                type='button'
                aria-pressed={value === z}
                className={`block w-full rounded-md px-2 py-2 text-left text-xs focus-visible:ring-2 focus-visible:ring-ring ${value === z ? 'bg-accent font-medium' : 'hover:bg-accent/50'}`}
                onClick={() => {
                  onChange(z);
                  setZoneOpen(false);
                  setZoneSearch('');
                }}
              >
                {z}
              </button>
            ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
