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
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Badge } from './ui/badge';
import { Separator } from './ui/separator';
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
      <DialogContent className='max-w-[1000px]! max-h-[800px] h-full position-relative px-1'>
        <DialogHeader className='px-4'>
          <DialogTitle>Transaction advance details</DialogTitle>
        </DialogHeader>
        <ScrollArea className='max-h-[730px] w-full px-4 absolute'>
          <section ref={animateRef} className='flex flex-col gap-10 '>
            <Connection
              trs={log?.transaction.id}
              checkpoints={log?.timing.checkpoints}
            />
            <Separator />
            <div className='flex flex-col gap-3'>
              <p>Assigned variables</p>
              <div className='flex flex-wrap flex-row gap-2'>
                {Object.entries(log?.assignedVariables || {}).map(
                  ([key, value]) => (
                    <Badge key={key} className='w-fit'>
                      {key}:{' '}
                      <span className='font-bold'>{value}</span>
                    </Badge>
                  ),
                )}
              </div>
            </div>
            <Separator />
            <div className='flex justify-between'>
              <Button
                variant='outline'
                className='w-fit'
                onClick={toggleLog}
              >
                Show transaction log <ChevronDown />
              </Button>
              <Button
                variant='outline'
                className='w-fit'
                onClick={() => {
                  toast.success('Copied to clipboard');
                  navigator.clipboard.writeText(raw);
                }}
              >
                <Copy /> Copy
              </Button>
            </div>
            {showLog && (
              <Card className='relative w-full h-100'>
                <div className='absolute left-3 bottom-3 right-3 top-3'>
                  <ScrollArea className='h-full w-full absolute'>
                    <pre className='text-xs'>{raw}</pre>
                    <ScrollBar orientation='horizontal' />
                  </ScrollArea>
                </div>
              </Card>
            )}
            {log?.policyMatches.length > 0 && (
              <>
                <Separator />
                <EvaluationMatchesPolicy log={log} />
              </>
            )}
            {log?.matchedConditions.length > 0 && (
              <div className='flex flex-col gap-3'>
                <p>Conditions matched</p>
                <Card className='relative w-full h-100'>
                  <div className='absolute left-3 right-1  bottom-3 top-3'>
                    <ScrollArea className='h-full w-full pr-3 absolute'>
                      {log?.matchedConditions.map(
                        ({ condition, matches }, i) => (
                          // biome-ignore lint/suspicious/noArrayIndexKey: <>
                          <div key={`${condition}-${i}`}>
                            <div className='bg-secondary border-accent rounded-sm p-2'>
                              <p>{condition}</p>
                            </div>
                            <div className=' rounded-sm p-2 pl-8'>
                              {matches.map((match) => (
                                <p key={match}>{match}</p>
                              ))}
                            </div>
                          </div>
                        ),
                      )}
                    </ScrollArea>
                  </div>
                </Card>
              </div>
            )}
          </section>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
