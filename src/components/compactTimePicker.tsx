'use client';

import { useEffect, useRef } from 'react';
import { Clock3 } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

const text = (value: number) => String(value).padStart(2, '0');
const ROW = 28;
const HOURS = Array.from({ length: 24 }, (_, n) => n);
const MINUTES = Array.from({ length: 60 }, (_, n) => n);
function Wheel({
  label,
  value,
  values,
  onChange,
  disabled = false,
}: {
  label: string;
  value: number;
  values: number[];
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  const element = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const index = Math.max(0, values.indexOf(value));
  const selectedIndex = useRef(index);
  const wheelStep = useRef({ at: -Infinity, direction: 0 });
  const changeLatest = useRef(onChange);
  changeLatest.current = onChange;
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    selectedIndex.current = index;
    element.current?.scrollTo({
      top: index * ROW,
      behavior: 'instant',
    });
  }, [index]);
  const move = (next: number) => {
    if (disabled) return;
    if (timer.current) clearTimeout(timer.current);
    const bounded = Math.max(0, Math.min(values.length - 1, next));
    const changed = bounded !== selectedIndex.current;
    selectedIndex.current = bounded;
    element.current?.scrollTo({
      top: bounded * ROW,
      behavior: 'instant',
    });
    if (changed) changeLatest.current(values[bounded]);
  };
  const moveLatest = useRef(move);
  moveLatest.current = move;
  useEffect(() => {
    const node = element.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || !event.deltaY) return;
      event.preventDefault();
      if (disabled) return;
      const direction = Math.sign(event.deltaY);
      const now = performance.now();
      // Collapse high-frequency trackpad momentum; never translate a large delta
      // into multiple rows. A fresh step or reversal always changes one unit.
      if (
        direction === wheelStep.current.direction &&
        now - wheelStep.current.at < 90
      )
        return;
      wheelStep.current = { at: now, direction };
      moveLatest.current(selectedIndex.current + direction);
    };
    // React's delegated wheel listener is passive in Chromium. A local non-passive
    // listener prevents native delta jumps while preserving touch scroll/snap.
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [disabled]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <div className='relative w-16'>
      <div
        aria-hidden='true'
        className='pointer-events-none absolute inset-x-0 top-7 h-7 rounded-md bg-primary/10'
      />
      <div
        ref={element}
        role='spinbutton'
        aria-label={label}
        aria-valuemin={values[0]}
        aria-valuemax={values.at(-1)}
        aria-valuenow={value}
        aria-valuetext={text(value)}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        className={`relative h-[84px] snap-y snap-mandatory overscroll-contain rounded-md py-7 text-center tabular-nums outline-none [scrollbar-width:none] focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-scrollbar]:hidden ${disabled ? 'overflow-hidden opacity-50' : 'overflow-y-auto'}`}
        onKeyDown={(event) => {
          if (disabled) return;
          const delta =
            event.key === 'ArrowUp' || event.key === 'PageUp'
              ? -1
              : event.key === 'ArrowDown' || event.key === 'PageDown'
                ? 1
                : 0;
          if (delta || event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
            move(
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? values.length - 1
                  : selectedIndex.current + delta,
            );
          }
        }}
        onScroll={() => {
          if (disabled) return;
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => {
            const next = Math.round(
              (element.current?.scrollTop ?? 0) / ROW,
            );
            moveLatest.current(next);
          }, 150);
        }}
      >
        {values.map((item, position) => (
          <div
            key={item}
            aria-hidden='true'
            onClick={() => move(position)}
            className={`h-7 snap-center text-sm leading-7 ${disabled ? '' : 'cursor-pointer'} ${item === value ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}
          >
            {text(item)}
          </div>
        ))}
      </div>
    </div>
  );
}

export type CompactTimeWheelProps = {
  /** Exact 24-hour local clock value (HH:mm); no date or timezone conversion. */
  value: string;
  onChange: (value: string) => void;
  label?: string;
  disabled?: boolean;
};

/** Embeddable fields only: safe inside an existing calendar/popover. */
export function CompactTimeWheel({
  value,
  onChange,
  label = 'Time',
  disabled = false,
}: CompactTimeWheelProps) {
  const [hour, minute] = value.split(':').map(Number);
  return (
    <div
      role='group'
      aria-label={`${label}, 24-hour time`}
      className='flex items-center justify-center gap-1'
    >
      <Wheel
        label={`${label}: hours`}
        value={hour}
        values={HOURS}
        disabled={disabled}
        onChange={(next) => onChange(`${text(next)}:${text(minute)}`)}
      />
      <span aria-hidden='true' className='text-muted-foreground'>
        :
      </span>
      <Wheel
        label={`${label}: minutes`}
        value={minute}
        values={MINUTES}
        disabled={disabled}
        onChange={(next) => onChange(`${text(hour)}:${text(next)}`)}
      />
    </div>
  );
}

export default function CompactTimePicker({
  label,
  value,
  onChange,
  disabled = false,
}: CompactTimeWheelProps & { label: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type='button'
          disabled={disabled}
          className='inline-flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50'
          aria-label={`${label} ${value}, 24-hour time`}
        >
          <Clock3 className='size-3.5 text-muted-foreground' />
          <span className='text-muted-foreground'>{label}</span>
          <span className='font-medium tabular-nums'>{value}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className='w-auto p-2'
        aria-label={`${label}, 24-hour time`}
      >
        <CompactTimeWheel
          label={label}
          value={value}
          onChange={onChange}
          disabled={disabled}
        />
      </PopoverContent>
    </Popover>
  );
}
