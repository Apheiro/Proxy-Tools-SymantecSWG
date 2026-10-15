import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { TraceRelation } from '@/lib/policyTrace';

export default function TraceHandoffs({
  parent,
  children = [],
  onSelect,
}: {
  parent?: TraceRelation;
  children?: TraceRelation[];
  onSelect: (key: string) => void;
}) {
  if (!parent && !children.length) return null;
  return (
    <div className='flex flex-wrap items-center gap-2 border-t pt-3 text-xs'>
      <span className='text-muted-foreground'>Explicit handoff</span>
      {[
        ...(parent ? [{ ...parent, direction: 'From' }] : []),
        ...children.map((child) => ({ ...child, direction: 'To' })),
      ].map((relation) =>
        relation.entry ? (
          <Button
            key={`${relation.direction}:${relation.entry.key}`}
            type='button'
            size='sm'
            variant='secondary'
            className='h-auto max-w-full whitespace-normal break-all px-2 py-1 text-xs'
            onClick={() => onSelect(relation.entry.key)}
          >
            <ArrowRight aria-hidden='true' className='size-3' />
            {relation.direction} #{relation.id} ·{' '}
            {relation.entry.log.transaction.type}
          </Button>
        ) : (
          <span
            key={`${relation.direction}:${relation.id}`}
            className='break-all text-muted-foreground'
          >
            {relation.direction} #{relation.id} · {relation.note}
          </span>
        ),
      )}
    </div>
  );
}
