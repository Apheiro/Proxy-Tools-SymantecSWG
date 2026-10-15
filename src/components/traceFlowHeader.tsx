import { ChevronDown, GitBranch } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { disclosureIconStyles } from '@/lib/uiVariants';
import type { TraceFlow } from '@/lib/traceFlows';
import type { TraceTime } from '@/lib/policyTrace';

const recordTime = (time?: TraceTime) =>
  time
    ? `${time.date} ${time.time}${time.zone === 'UTC' ? ' UTC' : ' · zone not reported'}`
    : 'Not recorded';

export default function TraceFlowHeader({
  flow,
  shown,
  expanded,
  onToggle,
}: {
  flow: TraceFlow;
  shown: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const id =
    flow.missingParent ||
    flow.anchor.log.transaction.id ||
    'without ID';
  return (
    <Button
      type='button'
      variant='ghost'
      aria-label={`${expanded ? 'Collapse' : 'Expand'} flow ${id}`}
      aria-expanded={expanded}
      onClick={onToggle}
      className='h-auto w-full cursor-pointer items-start justify-start gap-2 rounded-lg border bg-muted/40 p-3 text-left whitespace-normal hover:bg-muted/60'
    >
      <ChevronDown
        aria-hidden='true'
        className={disclosureIconStyles({
          expanded,
          className: 'mt-0.5 size-4 shrink-0',
        })}
      />
      <span className='flex min-w-0 flex-1 flex-col gap-1.5'>
        <span className='flex flex-wrap items-center gap-x-3 gap-y-1'>
          <span className='inline-flex items-center gap-1.5 text-sm font-semibold'>
            <GitBranch aria-hidden='true' className='size-3.5' />
            Flow #{id}
          </span>
          <span className='text-xs text-muted-foreground'>
            {flow.entries.length}{' '}
            {flow.entries.length === 1
              ? 'transaction'
              : 'transactions'}
            {shown < flow.entries.length ? ` · ${shown} shown` : ''}
          </span>
          <span className='flex flex-wrap gap-1'>
            {flow.counts.allowed > 0 && (
              <Badge
                variant='outline'
                className='border-green-600/25 text-green-700 dark:text-green-400'
              >
                {flow.counts.allowed} allowed
              </Badge>
            )}
            {flow.counts.rejected > 0 && (
              <Badge
                variant='outline'
                className='border-destructive/25 text-destructive'
              >
                {flow.counts.rejected} denied
              </Badge>
            )}
            {flow.counts.exception > 0 && (
              <Badge
                variant='outline'
                className='border-amber-600/25 text-amber-700 dark:text-amber-400'
              >
                {flow.counts.exception}{' '}
                {flow.counts.exception === 1
                  ? 'exception'
                  : 'exceptions'}
              </Badge>
            )}
            {flow.counts.unknown > 0 && (
              <Badge
                variant='outline'
                className='text-muted-foreground'
              >
                {flow.counts.unknown} unclassified
              </Badge>
            )}
          </span>
        </span>
        <span className='break-all text-xs text-muted-foreground'>
          {flow.anchor.log.transaction.dest ||
            'Destination not recorded'}
        </span>
        <span className='flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-normal text-muted-foreground'>
          <span>First record: {recordTime(flow.first)}</span>
          <span>Last record: {recordTime(flow.last)}</span>
        </span>
        {flow.missingParent && (
          <span className='text-xs font-normal text-muted-foreground'>
            Referenced parent #{flow.missingParent} is not in this
            capture.
          </span>
        )}
        {flow.issue && (
          <span className='text-xs font-normal text-muted-foreground'>
            {flow.issue}
          </span>
        )}
      </span>
    </Button>
  );
}
