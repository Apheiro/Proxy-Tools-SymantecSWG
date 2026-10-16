'use client';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef } from 'react';
import { cva } from '@/lib/cva';
import type { DiffLine } from '@/lib/policyManager';
const lineStyle = cva({
  base: 'absolute left-0 top-0 flex h-5 min-w-full whitespace-pre font-mono text-xs',
  variants: {
    kind: {
      equal: '',
      insert:
        'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
      delete: 'bg-destructive/10 text-destructive',
    },
  },
});
export default function PolicyDiff({ lines }: { lines: DiffLine[] }) {
  const ref = useRef<HTMLElement>(null);
  const virtual = useVirtualizer({
    count: lines.length,
    getScrollElement: () => ref.current,
    estimateSize: () => 20,
    overscan: 15,
  });
  return (
    <section
      ref={ref}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to scroll the diff.
      tabIndex={0}
      aria-label='Policy comparison'
      className='h-full min-h-0 overflow-auto rounded-md border bg-muted/10'
    >
      <div
        className='relative w-max min-w-full'
        style={{ height: virtual.getTotalSize() }}
      >
        {virtual.getVirtualItems().map((item) => {
          const line = lines[item.index];
          return (
            <div
              key={item.key}
              className={lineStyle({ kind: line.kind })}
              style={{ transform: `translateY(${item.start}px)` }}
            >
              <span className='sticky left-0 flex w-24 shrink-0 justify-end gap-2 border-r bg-card px-2 text-muted-foreground'>
                <span className='w-8 text-right'>{line.oldLine}</span>
                <span className='w-8 text-right'>{line.newLine}</span>
              </span>
              <span className='px-3'>
                {line.kind === 'insert'
                  ? '+'
                  : line.kind === 'delete'
                    ? '−'
                    : ' '}{' '}
                {line.text.replace(/\r?\n$/, '')}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
