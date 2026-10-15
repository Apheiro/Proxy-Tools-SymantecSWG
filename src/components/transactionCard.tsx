import { memo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import TraceHandoffs from '@/components/traceHandoffs';
import TraceOutcomeBadge from '@/components/traceOutcomeBadge';
import {
  traceDuration,
  type TraceEntry,
  type TraceRelation,
} from '@/lib/policyTrace';

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className='min-w-0'>
      <dt className='text-xs text-muted-foreground'>{label}</dt>
      <dd className='mt-1 break-all text-sm'>
        {children || 'Not recorded'}
      </dd>
    </div>
  );
}

function TransactionCard({
  entry,
  parent,
  children,
  onSelect,
}: {
  entry: TraceEntry;
  parent?: TraceRelation;
  children?: TraceRelation[];
  onSelect: (key: string) => void;
}) {
  const { log, outcome, timestamp } = entry;
  const requestMethod = log.transaction.method;
  const client = log.connection.client;
  const endpoint = client?.includes(':') ? `[${client}]` : client;
  return (
    <article
      aria-label={`Transaction ${log.transaction.id || 'without ID'}`}
    >
      <Card className='min-w-0 gap-0 py-0'>
        <CardContent className='space-y-3 p-4 sm:p-5'>
          <div className='flex flex-wrap items-center justify-between gap-3'>
            <div className='flex min-w-0 flex-wrap items-center gap-2'>
              <Badge variant='secondary'>
                {log.transaction.type || 'Type not recorded'}
              </Badge>
              {requestMethod && requestMethod !== 'unknown' && (
                <Badge variant='outline'>{requestMethod}</Badge>
              )}
              <span className='break-all font-mono text-xs text-muted-foreground'>
                #{log.transaction.id || 'Not recorded'}
              </span>
            </div>
            <div className='flex items-center gap-2'>
              <TraceOutcomeBadge outcome={outcome} />
              <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={() => onSelect(entry.key)}
              >
                Details
              </Button>
            </div>
          </div>
          <div>
            <h3 className='break-all text-base font-semibold leading-snug'>
              {log.transaction.dest || 'Destination not recorded'}
            </h3>
            {log.application.name && (
              <p className='mt-1 break-words text-sm text-muted-foreground'>
                {log.application.name}
                {log.application.group
                  ? ` · ${log.application.group}`
                  : ''}
              </p>
            )}
          </div>
          <dl className='grid grid-cols-2 gap-x-5 gap-y-3 rounded-lg bg-muted/40 p-3 lg:grid-cols-4'>
            <Field label='Client'>
              {endpoint
                ? `${endpoint}${log.connection.sourcePort ? `:${log.connection.sourcePort}` : ''}`
                : null}
            </Field>
            <Field label='User'>
              {log.user.name ||
                log.user.relativeName ||
                'Not recorded'}
              {log.user.realm && (
                <span className='block text-xs text-muted-foreground'>
                  {log.user.realm}
                </span>
              )}
            </Field>
            <Field
              label={`Timestamp${timestamp.zone ? ` · ${timestamp.zone}` : ''}`}
            >
              {timestamp.date}
              {timestamp.epoch != null && (
                <span className='block tabular-nums text-muted-foreground'>
                  {timestamp.time}
                </span>
              )}
            </Field>
            <Field label='Transaction duration'>
              {traceDuration(log)}
            </Field>
          </dl>
          <p className='break-words text-xs text-muted-foreground'>
            <span className='font-medium'>
              {outcome.source === 'reported'
                ? 'Reported verdict'
                : outcome.source === 'matched'
                  ? 'Matched action · final verdict absent'
                  : 'Policy result'}
              :
            </span>{' '}
            {outcome.evidence}
          </p>
          {!!log.decision.categories?.length && (
            <div className='flex flex-wrap gap-1.5'>
              {log.decision.categories.map((category) => (
                <Badge
                  key={category}
                  variant='secondary'
                  className='max-w-full whitespace-normal break-words text-xs'
                >
                  {category}
                </Badge>
              ))}
            </div>
          )}
          <TraceHandoffs
            parent={parent}
            children={children}
            onSelect={onSelect}
          />
        </CardContent>
      </Card>
    </article>
  );
}

export default memo(TransactionCard);
