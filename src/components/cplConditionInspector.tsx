'use client';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  describeAtom,
  type PolicyIndex,
  referenceName,
} from '@/lib/cplSemantics';
/** Explore one object's alternatives at a time: no exponential expansion of shared graphs. */
export default function CplConditionInspector({
  name,
  index,
}: {
  name: string;
  index: PolicyIndex;
}) {
  const [path, setPath] = useState([name]);
  const active = path.at(-1)!;
  const symbol = index.symbols.get(active);
  const ref = useRef<HTMLElement>(null);
  const virtual = useVirtualizer({
    count: symbol?.rows.length || 0,
    getScrollElement: () => ref.current,
    estimateSize: () => 70,
    overscan: 5,
  });
  return (
    <div className='space-y-2 rounded-lg border p-3 text-xs'>
      <div className='flex flex-wrap gap-1'>
        {path.map((part, position) => (
          <Button
            key={`${position}-${part}`}
            size='sm'
            variant='ghost'
            onClick={() => setPath(path.slice(0, position + 1))}
          >
            {part}
          </Button>
        ))}
      </div>
      <p className='text-muted-foreground'>
        {symbol?.rows.length || 0} alternatives · ANY row matches ·
        ALL conditions within each row. Negation is retained at the
        referencing rule.
      </p>
      {!!symbol?.issues.length && <p>{symbol.issues.join(' ')}</p>}
      <section
        ref={ref}
        aria-label={`Condition logic for ${active}`}
        className='h-56 overflow-auto'
      >
        <ol
          className='relative m-0 list-none p-0'
          style={{ height: virtual.getTotalSize() }}
        >
          {virtual.getVirtualItems().map((item) => {
            const row = symbol!.rows[item.index];
            return (
              <li
                key={item.key}
                data-index={item.index}
                ref={virtual.measureElement}
                className='absolute left-0 top-0 w-full border-b p-2'
                style={{ transform: `translateY(${item.start}px)` }}
              >
                <p className='mb-1 text-[10px] text-muted-foreground'>
                  Alternative {item.index + 1} · line {row.line} · ALL
                </p>
                <div className='flex flex-wrap gap-1'>
                  {row.atoms.map((atom) => {
                    const target = referenceName(atom);
                    return target && index.symbols.has(target) ? (
                      <button
                        type='button'
                        key={atom.start}
                        disabled={path.includes(target)}
                        className='cursor-pointer rounded border px-2 py-1 disabled:cursor-default'
                        onClick={() => {
                          setPath([...path, target]);
                          ref.current?.scrollTo({ top: 0 });
                        }}
                      >
                        {describeAtom(atom)}
                        {path.includes(target)
                          ? ' · already in path'
                          : ' →'}
                      </button>
                    ) : (
                      <span
                        key={atom.start}
                        className='rounded border px-2 py-1'
                      >
                        {describeAtom(atom)}
                      </span>
                    );
                  })}
                </div>
                {!row.editable && <code>{row.raw}</code>}
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
