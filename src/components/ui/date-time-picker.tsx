'use client';

import {
  DateTimePicker as KalyxDateTimePicker,
  TimePicker,
} from '@kalyx/react';
import { CalendarClock, X } from 'lucide-react';
import {
  useEffect,
  useId,
  useState,
  type ComponentProps,
} from 'react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  dateTimeToISO,
  isoToDateTime,
  type DateTimePrecision,
} from '@/lib/dateTime';
import { cn } from '@/lib/utils';

const fieldClass =
  'border-input bg-background flex h-9 w-full min-w-0 items-center rounded-md border px-3 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';
const dayClass =
  'mx-auto flex size-8 cursor-pointer items-center justify-center rounded-md text-sm outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40';
const timeClasses = {
  root: 'max-h-32 overflow-y-auto rounded-md border p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring',
  option:
    'cursor-pointer rounded px-3 py-1 text-center text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring aria-disabled:pointer-events-none aria-disabled:opacity-40',
  optionSelected:
    'bg-primary text-primary-foreground hover:bg-primary',
};
const calendarClasses = {
  root: 'space-y-2',
  header: 'flex items-center justify-between gap-2',
  title: 'rounded-md px-2 py-1 text-sm font-medium',
  navButton:
    'mx-auto flex size-8 cursor-pointer items-center justify-center rounded-md border hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40',
  grid: 'w-full border-collapse',
  gridRow: '',
  gridCell: 'p-0 text-center',
  weekdayHeader:
    'h-8 text-center text-xs font-normal text-muted-foreground',
  day: dayClass,
  daySelected:
    'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground',
  dayToday: 'ring-1 ring-ring',
  dayDisabled: 'opacity-40',
  dayOutsideMonth: 'text-muted-foreground',
};

type RootProps = ComponentProps<typeof KalyxDateTimePicker>;
type CalendarProps = ComponentProps<
  typeof KalyxDateTimePicker.Calendar
>;
type PopoverProps = ComponentProps<typeof PopoverContent>;

export type DateTimePickerProps = Omit<
  RootProps,
  | 'value'
  | 'defaultValue'
  | 'onChange'
  | 'children'
  | 'withSeconds'
  | 'displayTimezone'
> & {
  /** ISO UTC instant; null represents an unbounded/empty field. */
  value: string | null;
  onChange: (value: string | null) => void;
  label: string;
  id?: string;
  name?: string;
  timeZone?: string;
  precision?: DateTimePrecision;
  placeholder?: string;
  error?: string;
  className?: string;
  triggerClassName?: string;
  inputClassName?: string;
  labelClassName?: string;
  calendarProps?: CalendarProps;
  popoverProps?: PopoverProps;
  timeClassNames?: Partial<typeof timeClasses>;
  clearable?: boolean;
};

/** Shared Kalyx composition: semantic theme tokens, explicit timezone, optional seconds. */
export function DateTimePicker({
  value,
  onChange,
  label,
  id,
  name,
  timeZone = 'local',
  precision = 'minute',
  placeholder = 'Select date and time',
  error,
  className,
  triggerClassName,
  inputClassName,
  labelClassName,
  calendarProps,
  popoverProps,
  timeClassNames,
  clearable = true,
  disabled,
  readOnly,
  onOpenChange,
  ...rootProps
}: DateTimePickerProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [draft, setDraft] = useState('');
  const [draftError, setDraftError] = useState('');
  const display = isoToDateTime(value, timeZone, precision);
  // Kalyx defaults to UTC, so local controls need an explicit browser timezone.
  const displayTimezone =
    timeZone === 'local'
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : timeZone;
  useEffect(() => {
    setDraft(display.replace('T', ' '));
    setDraftError('');
  }, [display]);
  const blocked = disabled === true || readOnly;
  // Constrained dates/times must be committed through Kalyx's validated controls.
  const editableZone =
    (timeZone === 'local' || timeZone === 'UTC') &&
    !(Array.isArray(disabled) && disabled.length) &&
    !rootProps.filterTime;
  const commitDraft = () => {
    if (blocked) return;
    if (!draft.trim()) {
      onChange(null);
      setDraftError('');
      return;
    }
    const next = dateTimeToISO(
      draft.trim().replace(' ', 'T'),
      timeZone as 'local' | 'UTC',
    );
    if (!next) {
      setDraftError('Enter a valid date and time.');
      return;
    }
    setDraftError('');
    onChange(next);
  };
  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)}>
      <label
        htmlFor={inputId}
        className={cn(
          'text-xs text-muted-foreground',
          labelClassName,
        )}
      >
        {label}
      </label>
      <Popover
        onOpenChange={(open) => {
          if (open) {
            setDraft(display.replace('T', ' '));
            setDraftError('');
          }
          onOpenChange?.(open);
        }}
      >
        <div className='relative'>
          <PopoverTrigger
            id={inputId}
            disabled={!!blocked}
            aria-label={label}
            aria-invalid={!!error}
            aria-describedby={error ? `${inputId}-error` : undefined}
            className={cn(
              fieldClass,
              'cursor-pointer justify-between gap-2 pr-10 text-left',
              triggerClassName,
            )}
          >
            <span
              className={cn(
                'truncate',
                !value && 'text-muted-foreground',
              )}
            >
              {display ? display.replace('T', ' ') : placeholder}
            </span>
            <CalendarClock className='size-4 shrink-0 text-muted-foreground' />
          </PopoverTrigger>
          {clearable && value && !blocked && (
            <button
              type='button'
              aria-label={`Clear ${label}`}
              className='absolute right-1 top-1 flex size-7 cursor-pointer items-center justify-center rounded hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
              onClick={() => onChange(null)}
            >
              <X className='size-3.5' />
            </button>
          )}
          {name && (
            <input type='hidden' name={name} value={value ?? ''} />
          )}
        </div>
        <PopoverContent
          {...popoverProps}
          aria-label={`${label}: date and time`}
          className={cn('space-y-3', popoverProps?.className)}
        >
          <KalyxDateTimePicker
            {...rootProps}
            value={value}
            onChange={onChange}
            disabled={disabled}
            readOnly={readOnly}
            displayTimezone={displayTimezone}
            withSeconds={precision === 'second'}
          >
            {editableZone && (
              <label className='block space-y-1 text-xs text-muted-foreground'>
                Date and time{' '}
                {timeZone === 'UTC' ? '(UTC)' : '(local)'}
                <input
                  className={cn(fieldClass, 'block', inputClassName)}
                  value={draft}
                  disabled={blocked}
                  placeholder={
                    precision === 'second'
                      ? 'YYYY-MM-DD HH:mm:ss'
                      : 'YYYY-MM-DD HH:mm'
                  }
                  aria-invalid={!!draftError}
                  aria-describedby={
                    draftError ? `${inputId}-draft-error` : undefined
                  }
                  onChange={(event) => setDraft(event.target.value)}
                  onBlur={commitDraft}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      commitDraft();
                    }
                  }}
                />
              </label>
            )}
            {draftError && (
              <p
                id={`${inputId}-draft-error`}
                role='alert'
                className='text-xs text-destructive'
              >
                {draftError}
              </p>
            )}
            <KalyxDateTimePicker.Calendar
              {...calendarProps}
              classNames={Object.fromEntries(
                Object.entries(calendarClasses).map(
                  ([slot, classes]) => [
                    slot,
                    cn(classes, calendarProps?.classNames?.[slot]),
                  ],
                ),
              )}
            />
            <div className='grid grid-cols-2 gap-2'>
              <div className='space-y-1'>
                <p className='text-xs text-muted-foreground'>Hour</p>
                <KalyxDateTimePicker.HourList
                  classNames={{ ...timeClasses, ...timeClassNames }}
                />
              </div>
              <div className='space-y-1'>
                <p className='text-xs text-muted-foreground'>
                  Minute
                </p>
                <KalyxDateTimePicker.MinuteList
                  classNames={{ ...timeClasses, ...timeClassNames }}
                />
              </div>
            </div>
            <label className='block space-y-1 text-xs text-muted-foreground'>
              {precision === 'second'
                ? 'Time (HH:mm:ss)'
                : 'Time (HH:mm)'}
              <TimePicker.Input
                className={cn(fieldClass, 'block', inputClassName)}
              />
            </label>
            <KalyxDateTimePicker.AmPmToggle />
            <div className='flex items-center justify-between border-t pt-2'>
              <span className='text-xs text-muted-foreground'>
                {timeZone === 'local' ? 'Local time' : timeZone}
              </span>
              {clearable && (
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  disabled={blocked}
                  onClick={() => onChange(null)}
                >
                  Clear
                </Button>
              )}
            </div>
          </KalyxDateTimePicker>
        </PopoverContent>
      </Popover>
      {error && (
        <p
          id={`${inputId}-error`}
          role='alert'
          className='text-xs text-destructive'
        >
          {error}
        </p>
      )}
    </div>
  );
}
