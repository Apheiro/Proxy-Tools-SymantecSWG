import { useAutoAnimate } from '@formkit/auto-animate/react';
import {
  type UseDisclosureHandlers,
  useDisclosure,
} from '@mantine/hooks';
import { cva } from '@/lib/cva';
import { disclosureIconStyles } from '@/lib/uiVariants';
import { ChevronDown, Copy, X } from 'lucide-react';
import { type Dispatch, type SetStateAction, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from './ui/badge';
import TraceHandoffs from '@/components/traceHandoffs';
import TraceOutcomeBadge from '@/components/traceOutcomeBadge';
import {
  policyLineVerdict,
  traceDuration,
  type TraceOutcome,
  type TraceRelation,
} from '@/lib/policyTrace';

function Connection({
  checkpoints,
  total,
}: {
  checkpoints?: Checkpoints;
  total: string;
}) {
  const recorded = Object.entries(checkpoints ?? {})
    .filter(([, point]) => point != null)
    .sort(([, a], [, b]) => a.startMs - b.startMs);
  return (
    <div className='space-y-3'>
      <p className='text-sm font-medium'>
        Transaction duration: {total}
      </p>
      <p className='text-xs text-muted-foreground'>
        Only checkpoints recorded for this processing type are listed.
        Missing stages are not errors. Start is relative to the
        beginning of this transaction.
      </p>
      {recorded.length ? (
        <table className='w-full text-left text-sm'>
          <thead className='text-xs text-muted-foreground'>
            <tr className='border-b'>
              <th className='py-2 font-medium'>Checkpoint</th>
              <th className='py-2 text-right font-medium'>
                Start (ms)
              </th>
              <th className='py-2 text-right font-medium'>
                Elapsed (ms)
              </th>
            </tr>
          </thead>
          <tbody>
            {recorded.map(([name, point]) => (
              <tr key={name} className='border-b last:border-0'>
                <th
                  scope='row'
                  className='break-words py-2 pr-3 font-mono text-xs font-normal'
                >
                  {name}
                </th>
                <td className='py-2 text-right tabular-nums'>
                  {point.startMs ?? '—'}
                </td>
                <td className='py-2 text-right tabular-nums'>
                  {point.elapsedMs ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className='text-sm text-muted-foreground'>
          No checkpoints were recorded.
        </p>
      )}
    </div>
  );
}

const MatchStyle = cva({
  base: ['rounded-sm', ' p-2', 'relative'],
  variants: {
    type: {
      allowed: 'bg-green-300/10',
      rejected: 'bg-red-400/10',
      exception: 'bg-red-400/10',
      base: 'bg-transparent',
    },
  },
});

const DotStyle = cva({
  base: [
    'before:content-[""]',
    'before:animate-ping',
    'before:left-0',
    'before:top-0',
    'before:absolute',
    'before:w-2',
    'before:h-2',
    'before:rounded-full',
    'before:mr-1',
    'rounded-full',
    'left-0',
    'p-1',
    'absolute',
    'top-[calc(50%-3px)]',
    'left-[-20px]',
  ],
  variants: {
    type: {
      allowed: 'bg-green-300 before:bg-green-300',
      rejected: 'bg-red-400 before:bg-red-400',
      exception: 'bg-red-400 before:bg-red-400',
      base: 'bg-gray-300/50',
    },
  },
});

function PolicyMatch({ match }: { match: string }) {
  const verdict = policyLineVerdict(match);
  const veredict = verdict === 'unknown' ? 'base' : verdict;

  return (
    <p className={MatchStyle({ type: veredict })}>
      <span className={DotStyle({ type: veredict })} />
      {match}
    </p>
  );
}

function EvaluationMatchesPolicy({ log }: { log: TransactionInfo }) {
  const [showMisses, setShowMisses] = useState(true);

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex items-center justify-between'>
        <p className='font-bold'>Matches</p>
        <Button
          type='button'
          size='sm'
          variant='outline'
          aria-pressed={!showMisses}
          onClick={() => setShowMisses((visible) => !visible)}
        >
          {showMisses ? 'Hide misses' : 'Show misses'}
        </Button>
      </div>
      <Card className='relative w-full h-100'>
        <div className='absolute left-3 right-1  bottom-3 top-3'>
          <ScrollArea className='h-full w-full pr-3 absolute'>
            {log?.policyMatches.map((m, i) => (
              <div key={`${m.header}-${i}`}>
                <div className='bg-secondary border-accent rounded-sm p-2'>
                  <p>{m.header}</p>
                </div>
                <div className='rounded-sm py-2 pl-8'>
                  {m.matches
                    .filter(
                      (match) =>
                        showMisses ||
                        !/^miss:/i.test(match.trimStart()),
                    )
                    .map((match, i) => (
                      <PolicyMatch
                        match={match}
                        key={`${i}-${match}`}
                      />
                    ))}
                </div>
              </div>
            ))}
          </ScrollArea>
        </div>
      </Card>
    </div>
  );
}

export default function AdvanceTransactionView({
  selectedTransaction,
  isOpen,
  setSelectedTransactionId,
  modalFns: { close },
  outcome,
  parent,
  children,
  onSelectRelated,
}: {
  selectedTransaction: { log: TransactionInfo; raw: string } | null;
  isOpen: boolean;
  setSelectedTransactionId: Dispatch<SetStateAction<string | null>>;
  modalFns: UseDisclosureHandlers;
  outcome?: TraceOutcome;
  parent?: TraceRelation;
  children?: TraceRelation[];
  onSelectRelated: (key: string) => void;
}) {
  const [animateRef] = useAutoAnimate({ duration: 200 });
  const [showLog, { toggle: toggleLog }] = useDisclosure(false);
  const { log, raw } = selectedTransaction ?? {};

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(e) => {
        if (!e) {
          close();
          setSelectedTransactionId(null);
        }
      }}
    >
      <DialogContent className='flex h-[calc(100dvh-2rem)] max-h-[900px] w-[calc(100vw-2rem)] max-w-6xl! flex-col gap-0 overflow-hidden p-0'>
        <DialogHeader className='grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border-b px-5 py-4 text-left sm:px-7'>
          <div className='flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
            <div className='min-w-0'>
              <DialogTitle className='text-lg'>
                Transaction details
              </DialogTitle>
              <DialogDescription className='mt-1 truncate'>
                {log?.application.name || 'Transaction'}
                {log?.transaction.id
                  ? ` · ID ${log.transaction.id}`
                  : ''}
              </DialogDescription>
            </div>
            <div className='flex flex-wrap items-center gap-2'>
              {log?.transaction.type && (
                <Badge variant='secondary'>
                  {log.transaction.type}
                </Badge>
              )}
              {outcome && <TraceOutcomeBadge outcome={outcome} />}
            </div>
          </div>
          <DialogClose asChild>
            <Button
              type='button'
              variant='ghost'
              size='icon'
              aria-label='Close transaction details'
              className='shrink-0 self-start'
            >
              <X className='size-4' />
            </Button>
          </DialogClose>
        </DialogHeader>

        <ScrollArea className='min-h-0 w-full flex-1'>
          <section
            ref={animateRef}
            className='mx-auto flex w-full max-w-5xl flex-col gap-5 p-4 sm:gap-6 sm:p-6'
          >
            {log && (
              <div className='space-y-3 rounded-lg border p-4'>
                <p className='break-all font-semibold'>
                  {log.transaction.dest || 'Destination not recorded'}
                </p>
                {outcome && (
                  <p className='break-words text-sm text-muted-foreground'>
                    {outcome.source === 'reported'
                      ? 'Reported verdict'
                      : 'Policy evidence'}
                    : {outcome.evidence}
                  </p>
                )}
                <TraceHandoffs
                  parent={parent}
                  children={children}
                  onSelect={onSelectRelated}
                />
              </div>
            )}
            <Card className='gap-0'>
              <CardHeader className='px-4 py-4 sm:px-5'>
                <CardTitle className='text-base'>
                  Recorded checkpoints
                </CardTitle>
                <CardDescription>
                  Processing type:{' '}
                  {log?.transaction.type || 'Not recorded'}.
                </CardDescription>
              </CardHeader>
              <CardContent className='px-4 pb-4 sm:px-5'>
                <Connection
                  checkpoints={log?.timing?.checkpoints}
                  total={log ? traceDuration(log) : 'Not recorded'}
                />
              </CardContent>
            </Card>

            <Card className='gap-0'>
              <CardHeader className='px-4 py-4 sm:px-5'>
                <CardTitle className='text-base'>
                  Assigned variables
                </CardTitle>
                <CardDescription>
                  Values assigned during policy processing.
                </CardDescription>
              </CardHeader>
              <CardContent className='grid gap-2 px-4 pb-4 sm:grid-cols-2 sm:px-5 lg:grid-cols-3'>
                {Object.entries(log?.assignedVariables || {}).length >
                0 ? (
                  Object.entries(log?.assignedVariables || {}).map(
                    ([key, value]) => (
                      <div
                        key={key}
                        className='min-w-0 rounded-md border bg-muted/20 px-3 py-2'
                      >
                        <p className='truncate text-xs text-muted-foreground'>
                          {key}
                        </p>
                        <p className='mt-1 break-all text-sm font-medium'>
                          {value}
                        </p>
                      </div>
                    ),
                  )
                ) : (
                  <p className='text-sm text-muted-foreground'>
                    No assigned variables were recorded.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card className='gap-0'>
              <CardHeader className='flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5'>
                <div>
                  <CardTitle className='text-base'>
                    Transaction log
                  </CardTitle>
                  <CardDescription>
                    Raw trace block associated with this transaction.
                  </CardDescription>
                </div>
                <div className='flex shrink-0 justify-end gap-2'>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={toggleLog}
                    aria-expanded={showLog}
                  >
                    {showLog ? 'Hide log' : 'Show log'}
                    <ChevronDown
                      className={disclosureIconStyles({
                        expanded: showLog,
                      })}
                    />
                  </Button>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={() => {
                      toast.success('Copied to clipboard');
                      navigator.clipboard.writeText(raw);
                    }}
                  >
                    <Copy /> Copy
                  </Button>
                </div>
              </CardHeader>
              {showLog && (
                <CardContent className='px-4 pb-4 sm:px-5'>
                  <ScrollArea
                    orientation='both'
                    className='h-72 rounded-md border bg-muted/20 p-3'
                  >
                    <pre className='w-max min-w-full font-mono text-xs leading-5'>
                      {raw}
                    </pre>
                  </ScrollArea>
                </CardContent>
              )}
            </Card>

            {log?.policyMatches.length > 0 && (
              <EvaluationMatchesPolicy log={log} />
            )}

            {log?.matchedConditions.length > 0 && (
              <Card className='gap-0'>
                <CardHeader className='px-4 py-4 sm:px-5'>
                  <CardTitle className='text-base'>
                    Conditions matched
                  </CardTitle>
                  <CardDescription>
                    Conditions and values reported for this
                    transaction.
                  </CardDescription>
                </CardHeader>
                <CardContent className='flex flex-col gap-3 px-4 pb-4 sm:px-5'>
                  {log.matchedConditions.map(
                    ({ condition, matches }, i) => (
                      <div
                        key={`${condition}-${i}`}
                        className='overflow-hidden rounded-md border'
                      >
                        <div className='bg-secondary px-3 py-2 text-sm font-medium'>
                          {condition}
                        </div>
                        <div className='flex flex-col gap-1 px-3 py-2'>
                          {matches.map((match, mI) => (
                            <p
                              key={`${match}-${mI}`}
                              className='break-words text-sm text-muted-foreground'
                            >
                              {match}
                            </p>
                          ))}
                        </div>
                      </div>
                    ),
                  )}
                </CardContent>
              </Card>
            )}
          </section>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
