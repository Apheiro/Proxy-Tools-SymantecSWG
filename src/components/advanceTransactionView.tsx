import { useAutoAnimate } from '@formkit/auto-animate/react';
import {
  type UseDisclosureHandlers,
  useDisclosure,
} from '@mantine/hooks';
import {
  ChevronDown,
  Copy,
  HardDriveDownload,
  HardDriveUpload,
  User,
  Waypoints,
} from 'lucide-react';
import {
  type Dispatch,
  type SetStateAction,
  useEffect,
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

function Connection({
  checkpoints,
}: {
  checkpoints?: Checkpoints;
  trs?: string;
}) {
  const positionVal = useRef(0);
  const [position, setPosition] = useState(0);

  useEffect(() => {
    for (const point of connectionLine) {
      if (
        checkpoints[point.checkpointId] === null ||
        point.id === 5
      ) {
        checkpoints[point.checkpointId] === null
          ? setPosition(positionVal.current)
          : setPosition(point.id);
        break;
      }
      positionVal.current = point.id;
    }
  }, [checkpoints]);

  if (!checkpoints) return null;
  const connectionLine = [
    {
      name: 'Transaction start',
      id: 1,
      startMs: checkpoints['new-connection']?.startMs,
      elapsedMs: checkpoints['new-connection']?.elapsedMs,
      description: `Finished establishing client side TCP connection in ${checkpoints['new-connection']?.elapsedMs}ms`,
      checkpointId: 'new-connection',
      icon: Waypoints,
    },
    {
      name: 'Client connection',
      id: 2,
      startMs: checkpoints['new-connection']?.startMs,
      elapsedMs: checkpoints['client-in']?.elapsedMs,
      description: `client started sending data ${checkpoints['client-in']?.startMs}ms in, finished in ${checkpoints['client-out']?.elapsedMs}ms`,
      checkpointId: 'client-in',
      icon: User,
    },
    {
      name: 'Server connection',
      id: 3,
      startMs: checkpoints['new-connection']?.startMs,
      elapsedMs: checkpoints['server-out']?.elapsedMs,
      description: `Server side connection started at ${checkpoints['server-out']?.startMs}ms`,
      checkpointId: 'server-out',
      icon: HardDriveUpload,
    },
    {
      name: 'Server response',
      id: 4,
      startMs: checkpoints['new-connection']?.startMs,
      elapsedMs: checkpoints['server-in']?.elapsedMs,
      description: `Server started sending response at ${checkpoints['server-in']?.startMs}ms and finished in ${checkpoints['server-in']?.elapsedMs}ms`,
      checkpointId: 'server-in',
      icon: HardDriveDownload,
    },
    {
      name: 'Client response',
      id: 5,
      startMs: checkpoints['new-connection']?.startMs,
      elapsedMs: checkpoints['client-out']?.elapsedMs,
      description: `Proxy started sending data to client at ${checkpoints['client-out']?.startMs}ms, took ${checkpoints['client-out']?.elapsedMs}ms `,
      checkpointId: 'client-out',
      icon: User,
    },
  ];

  return (
    <div className='max-w-250 p-6 flex flex-col gap-5 items-center'>
      <p className='font-semibold text-sm'>
        Total transaction time:{' '}
        {checkpoints['stop-transaction']?.startMs} ms
      </p>
      <Timeline value={position} orientation='horizontal'>
        {connectionLine.map((point) => (
          <TimelineItem key={point.id} step={point.id}>
            <TimelineHeader className='w-fit'>
              <TimelineSeparator />

              {position >= point.id && (
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
            {position >= point.id && (
              <TimelineContent>{point.description}</TimelineContent>
            )}
          </TimelineItem>
        ))}
      </Timeline>
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
      <DialogContent className='max-w-[1000px]! position-relative px-1'>
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
                  // navigator.clipboard.writeText(JSON.stringify(log));
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

            <div className='flex flex-col gap-3'>
              <p className='font-bold'>Matches</p>
              <Card className='relative w-full h-100'>
                <div className='absolute left-3 right-1  bottom-3 top-3'>
                  <ScrollArea className='h-full w-full pr-3 absolute'>
                    {log?.policyMatches.map((m, i) => (
                      <div key={`${m.header}-${i}`}>
                        <div className='bg-secondary border-accent rounded-sm p-2'>
                          <p>{m.header}</p>
                        </div>
                        <div className=' rounded-sm p-2 pl-8'>
                          {m.matches.map((match) => (
                            <p key={match}>{match}</p>
                          ))}
                        </div>
                      </div>
                    ))}
                  </ScrollArea>
                </div>
              </Card>
            </div>

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
          </section>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
