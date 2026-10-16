'use client';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Trash2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  type CplDefinition,
  type CplRule,
  definitionRows,
} from '@/lib/cplDocument';
import type { PolicyIndex } from '@/lib/cplSemantics';

type Item = { definition: CplDefinition; row?: CplRule };
export default function CplObjectLibrary({
  source,
  definitions,
  disabled,
  onEdit,
  onDelete,
  index,
  onBulk,
  onReveal,
}: {
  source: string;
  definitions: CplDefinition[];
  disabled: boolean;
  onEdit: (definition: CplDefinition, row?: CplRule) => void;
  onDelete: (definition: CplDefinition) => void;
  index: PolicyIndex;
  onBulk: (definition: CplDefinition) => void;
  onReveal: (line: number) => void;
}) {
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLElement>(null);
  const items = useMemo<Item[]>(
    () =>
      definitions
        .filter(
          (d) =>
            !query ||
            d.name.toLowerCase().includes(query.toLowerCase()) ||
            source
              .slice(d.bodyStart, d.bodyEnd)
              .toLowerCase()
              .includes(query.toLowerCase()),
        )
        .flatMap((definition) => [
          { definition },
          ...definitionRows(source, definition)
            .filter(
              (row) =>
                !query ||
                definition.name
                  .toLowerCase()
                  .includes(query.toLowerCase()) ||
                row.raw.toLowerCase().includes(query.toLowerCase()),
            )
            .map((row) => ({
              definition,
              row,
            })),
        ]),
    [source, definitions, query],
  );
  const virtual = useVirtualizer({
    count: items.length,
    getScrollElement: () => ref.current,
    estimateSize: (i) => (items[i].row ? 36 : 88),
    overscan: 10,
  });
  return (
    <div className='min-w-0'>
      <div className='border-b p-3'>
        <Input
          aria-label='Search policy objects'
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            ref.current?.scrollTo({ top: 0 });
          }}
          placeholder='Search names and entries…'
        />
      </div>
      <section
        ref={ref}
        aria-label='Reusable policy objects'
        className='h-[38rem] overflow-auto'
      >
        <ol
          className='relative m-0 list-none p-0'
          style={{ height: virtual.getTotalSize() }}
        >
          {virtual.getVirtualItems().map((item) => {
            const { definition, row } = items[item.index];
            const editable = ['condition', 'action'].includes(
              definition.kind.toLowerCase(),
            );
            return (
              <li
                key={item.key}
                data-index={item.index}
                ref={virtual.measureElement}
                className='absolute left-0 top-0 w-full px-3'
                style={{ transform: `translateY(${item.start}px)` }}
              >
                {row ? (
                  <button
                    type='button'
                    disabled={disabled || !editable || !row.editable}
                    className='block w-full cursor-pointer truncate rounded border-x px-3 py-2 text-left font-mono text-xs hover:bg-muted disabled:cursor-default disabled:text-muted-foreground'
                    title={row.raw}
                    onClick={() => onEdit(definition, row)}
                  >
                    {row.raw.trim()}
                  </button>
                ) : (
                  <div className='mt-3 rounded-t-lg border p-3'>
                    <div className='flex items-center justify-between gap-2'>
                      <div className='min-w-0'>
                        <h4 className='truncate text-xs font-semibold'>
                          {definition.name}
                        </h4>
                        <p className='text-[10px] text-muted-foreground'>
                          define {definition.kind} · line{' '}
                          {definition.line}
                        </p>
                      </div>
                      <div className='flex gap-1'>
                        <Button
                          size='sm'
                          variant='outline'
                          disabled={
                            disabled ||
                            !editable ||
                            !definition.complete
                          }
                          onClick={() => onBulk(definition)}
                        >
                          Edit list
                        </Button>
                        <Button
                          size='sm'
                          variant='ghost'
                          disabled={
                            disabled ||
                            !editable ||
                            !definition.complete
                          }
                          onClick={() => onEdit(definition)}
                        >
                          Add row
                        </Button>
                        <Button
                          size='icon'
                          variant='ghost'
                          aria-label={`Delete object ${definition.name}`}
                          disabled={disabled || !definition.complete}
                          onClick={() => onDelete(definition)}
                        >
                          <Trash2 className='size-3.5' />
                        </Button>
                      </div>
                    </div>
                    <div className='flex flex-wrap gap-1 py-1'>
                      {[
                        ...new Set(
                          index.symbols.get(
                            definition.name.replace(/^"|"$/g, ''),
                          )?.uses || [],
                        ),
                      ]
                        .slice(0, 12)
                        .map((line) => (
                          <button
                            type='button'
                            key={line}
                            className='cursor-pointer rounded border px-1 text-[10px] hover:bg-muted'
                            onClick={() => onReveal(line)}
                          >
                            Used at L{line}
                          </button>
                        ))}
                    </div>
                    <p className='text-[10px] text-muted-foreground'>
                      {definition.kind.toLowerCase() === 'condition'
                        ? 'Rows are alternatives (OR); expressions within a row are AND.'
                        : 'Ordered object body. Unsupported statements are preserved.'}
                    </p>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        {!definitions.length && (
          <p className='p-6 text-sm text-muted-foreground'>
            Create reusable condition or action objects, then
            reference them in rules.
          </p>
        )}
      </section>
    </div>
  );
}
