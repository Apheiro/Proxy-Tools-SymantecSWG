'use client';

import { useVirtualizer } from '@tanstack/react-virtual';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import TraceFlowHeader from '@/components/traceFlowHeader';
import { cva } from '@/lib/cva';
import {
  groupTraceFlows,
  traceDisplayRows,
  type TraceGrouping,
} from '@/lib/traceFlows';
import TransactionCard from '@/components/transactionCard';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { TraceEntry, traceRelations } from '@/lib/policyTrace';

const rowStyles = cva({
  base: 'absolute left-0 top-0 w-full pb-3 pr-3',
  variants: {
    depth: {
      flat: '',
      root: 'border-l-2 border-border pl-2',
      child: 'border-l-2 border-border pl-4',
      deep: 'border-l-2 border-border pl-6',
    },
  },
});

export default function TraceTransactionList({
  entries,
  allEntries,
  grouping,
  relations,
  onSelect,
  filterKey,
}: {
  entries: TraceEntry[];
  allEntries: TraceEntry[];
  grouping: TraceGrouping;
  relations: ReturnType<typeof traceRelations>;
  onSelect: (key: string) => void;
  filterKey: string;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const flows = useMemo(
    () =>
      grouping === 'flow'
        ? groupTraceFlows(allEntries, relations)
        : [],
    [allEntries, relations, grouping],
  );
  const rows = useMemo(
    () => traceDisplayRows(entries, flows, collapsed, grouping),
    [entries, flows, collapsed, grouping],
  );
  const getItemKey = useCallback(
    (index: number) => rows[index].key,
    [rows],
  );
  const toggle = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => viewport.current,
    estimateSize: (index) =>
      rows[index].kind === 'flow' ? 120 : 330,
    getItemKey,
    overscan: 4,
  });
  useEffect(() => {
    viewport.current?.scrollTo({ top: 0 });
  }, [filterKey, grouping]);
  return (
    <ScrollArea
      viewportRef={viewport}
      viewportProps={{
        tabIndex: 0,
        'aria-label': 'Scroll transactions',
      }}
      role='region'
      aria-label='Policy trace transactions'
      className='h-[65dvh] min-h-80 w-full'
    >
      <div
        className='relative w-full'
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((row) => {
          const item = rows[row.index];
          return (
            <div
              key={item.key}
              data-index={row.index}
              ref={virtualizer.measureElement}
              className={rowStyles({
                depth:
                  item.kind === 'transaction' &&
                  item.depth !== undefined
                    ? item.depth === 0
                      ? 'root'
                      : item.depth === 1
                        ? 'child'
                        : 'deep'
                    : 'flat',
              })}
              style={{ transform: `translateY(${row.start}px)` }}
            >
              {item.kind === 'flow' ? (
                <TraceFlowHeader
                  flow={item.flow}
                  shown={item.shown}
                  expanded={item.expanded}
                  onToggle={() => toggle(item.flow.key)}
                />
              ) : (
                <TransactionCard
                  entry={item.entry}
                  parent={relations.parents.get(item.entry.key)}
                  children={relations.children.get(item.entry.key)}
                  onSelect={onSelect}
                />
              )}
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}
