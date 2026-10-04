import { useAutoAnimate } from '@formkit/auto-animate/react';
import {
  type UseDisclosureHandlers,
  useDisclosure,
} from '@mantine/hooks';
import { cva } from 'class-variance-authority';
import { find } from 'lodash-es';
import {
  ChevronDown,
  Copy,
  HardDriveDownload,
  HardDriveUpload,
  type LucideProps,
  User,
  Waypoints,
  X,
} from 'lucide-react';
import {
  type Dispatch,
  type ForwardRefExoticComponent,
  type RefAttributes,
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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
import {
  Timeline,
  TimelineContent,
  TimelineDate,
  TimelineHeader,
  TimelineIndicator,
  TimelineItem,
  TimelineSeparator,
  TimelineTitle,
} from './ui/timeline';

const checkpointValues = {
  'new-connection': {
    icon: Waypoints,
    name: 'Transaction Started',
    description: (vi: string, _vo: string) =>
      `Finished establishing client side TCP connection in ${vi}ms`,
  },
  'client-in': {
    icon: User,
    name: 'Client Connected',
    description: (vi: string, vo: string) =>
      `client started sending data ${vi}ms in, took ${vo}ms`,
  },
  'server-out': {
    icon: HardDriveUpload,
    name: 'Request Sent',
    description: (vi: string, _vo: string) =>
      `Server side connection started at ${vi}ms`,
  },
  'cache-hit': {
    icon: HardDriveDownload,
    name: 'Response from Cache',
    description: (vi: string, vo: string) =>
      `Response got from cache in ${vi}ms, took ${vo}ms`,
  },
  'server-in': {
    icon: HardDriveDownload,
    name: 'Server Response',
    description: (vi: string, vo: string) =>
      `Server started sending response at ${vi}ms and took ${vo}ms`,
  },
  'client-out': {
    icon: User,
    name: 'Client response',
    description: (vi: string, vo: string) =>
      `Proxy started sending data to client at ${vi}ms, took ${vo}ms`,
  },
};

interface Point {
  name: string;
  id: number;
  startMs: number;
  nameId: string;
  elapsedMs: number;
  description: string;
  icon: ForwardRefExoticComponent<
    Omit<LucideProps, 'ref'> & RefAttributes<SVGSVGElement>
  >;
}

function generatePoints(checkpoints?: Checkpoints) {
  const points: Point[] = [];
  let idx = 0;
  for (const point of Object.keys(checkpointValues)) {
    const v = checkpoints[point];
    if (!v) continue;
    const c = checkpointValues[point];
    points.push({
      name: c.name,
      nameId: point,
      id: idx++,
      startMs: v?.startMs,
      elapsedMs: v?.elapsedMs,
      description: c.description(v?.startMs, v?.elapsedMs),
      icon: c.icon,
    });
  }
  if (!find(points, { nameId: 'client-out' }))
    points.push({
      name: 'client-out',
      nameId: 'client-out',
      id: points.length,
      startMs: 0,
      elapsedMs: 0,
      description: '',
      icon: User,
    });
  return points;
}

function Connection({
  checkpoints,
}: {
  checkpoints?: Checkpoints;
  trs?: string;
}) {
  const position = useRef(0);
  const connectionLine = useMemo(
    () => generatePoints(checkpoints),
    [checkpoints],
  );

  useEffect(() => {
    for (const point of connectionLine) {
      if (checkpoints[point.nameId] === null) continue;
      position.current = point.id;
    }
  }, [checkpoints]);

  return (
    <div className='max-w-250 p-6 flex flex-col gap-5 items-center'>
      <p className='font-semibold text-sm'>
        Total transaction time:{' '}
        {checkpoints['stop-transaction']?.startMs} ms
      </p>
      <Timeline value={position.current} orientation='horizontal'>
        {connectionLine?.map((point) => (
          <TimelineItem key={point.id} step={point.id}>
            <TimelineHeader className='w-fit'>
              <TimelineSeparator />

              {position.current >= point.id && (
                <TimelineDate className='w-fit'>
                  {point.startMs} ms
                </TimelineDate>
              )}

              <TimelineTitle className='w-fit'>
                {point.name}
              </TimelineTitle>
              <TimelineIndicator className='bg-primary/10 group-data-completed/timeline-item:bg-primary group-data-completed/timeline-item:text-primary-foreground flex size-6 items-center justify-center border-none group-data-[orientation=vertical]/timeline:-left-7'>
                <point.icon size={14} />
              </TimelineIndicator>
            </TimelineHeader>
            {position.current >= point.id && (
              <TimelineContent>{point.description}</TimelineContent>
            )}
          </TimelineItem>
        ))}
      </Timeline>
    </div>
  );
}

const MatchStyle = cva(['rounded-sm', ' p-2', 'relative'], {
  variants: {
    type: {
      allowed: 'bg-green-300/10',
      rejected: 'bg-red-400/10',
      exception: 'bg-red-400/10',
      base: 'bg-transparent',
    },
  },
});

const DotStyle = cva(
  [
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
  {
    variants: {
      type: {
        allowed: 'bg-green-300 before:bg-green-300',
        rejected: 'bg-red-400 before:bg-red-400',
        exception: 'bg-red-400 before:bg-red-400',
        base: 'bg-gray-300/50',
      },
    },
  },
);

function PolicyMatch({ match }: { match: string }) {
  const [veredict, setVerdict] = useState<
    'allowed' | 'rejected' | 'exception' | 'base'
  >('base');

  useEffect(() => {
    if (match.includes('ALLOW') || match.includes('ALLOWED'))
      setVerdict('allowed');
    if (
      match.includes('DENY') ||
      match.includes('DENIED') ||
      match.includes('REJECTED')
    )
      setVerdict('rejected');
    if (match.includes('exception')) setVerdict('exception');
  }, []);

  return (
    <p className={MatchStyle({ type: veredict })}>
      <span className={DotStyle({ type: veredict })} />
      {match}
    </p>
  );
}

function EvaluationMatchesPolicy({ log }: { log: TransactionInfo }) {
  const [showMisses, setShowMisses] = useState(true);

  useEffect(() => {
    console.log('logs processed', log);
  }, []);

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
}: {
  selectedTransaction: { log: TransactionInfo; raw: string } | null;
  isOpen: boolean;
  setSelectedTransactionId: Dispatch<SetStateAction<string | null>>;
  modalFns: UseDisclosureHandlers;
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
        <DialogHeader className='shrink-0 border-b px-5 py-4 pr-14 text-left sm:px-7'>
          <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
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
              {log?.decision.verdict && (
                <Badge variant='outline'>
                  {log.decision.verdict.toUpperCase()}
                </Badge>
              )}
            </div>
          </div>
          <DialogClose asChild>
            <Button
              type='button'
              variant='ghost'
              size='icon'
              aria-label='Close transaction details'
              className='absolute right-4 top-3'
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
            <Card className='gap-0'>
              <CardHeader className='px-4 py-4 sm:px-5'>
                <CardTitle className='text-base'>
                  Connection timeline
                </CardTitle>
                <CardDescription>
                  Transaction checkpoints and elapsed time.
                </CardDescription>
              </CardHeader>
              <CardContent className='overflow-x-auto px-2 pb-4 sm:px-4'>
                <div className='min-w-[700px]'>
                  <Connection
                    trs={log?.transaction.id}
                    checkpoints={log?.timing.checkpoints}
                  />
                </div>
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
                      className={`transition-transform ${showLog ? 'rotate-180' : ''}`}
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
