/** biome-ignore-all lint/style/useNamingConvention: <> */
import { cva } from 'class-variance-authority';
import dayjs from 'dayjs';
import Link from 'next/link';
import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

function Field({
  label,
  value,
  bold = false,
}: {
  label: string;
  value: React.ReactNode;
  bold?: boolean;
}) {
  return (
    <p className='grid grid-cols-3 gap-2 py-1 text-sm'>
      {bold ? (
        <>
          <span className='text-muted-foreground font-semibold'>
            {label}
          </span>
          <span className='font-semibold col-span-2 truncate'>
            {value}
          </span>
        </>
      ) : (
        <>
          <span className='text-muted-foreground'>{label}</span>
          <span className='col-span-2 truncate'>{value}</span>
        </>
      )}
    </p>
  );
}

function TransactionCard({
  log,
  setSelectedTransactionId,
}: {
  log: TransactionInfo;
  setSelectedTransactionId: Dispatch<SetStateAction<string | null>>;
}) {
  // return (
  //   <Card
  //     className='max-w-[800px] w-full py-3 gap-5'
  //     id={log.transaction.id}
  //   >
  //     <CardHeader className='px-3'>
  //       <div className='flex justify-between'>
  //         <p className='text-muted-foreground text-xs '>
  //           {dayjs(log.connection.time).format(
  //             'hh:mm:ss A - DD MMMM YYYY ',
  //           )}
  //         </p>
  //         {log.transaction.pid && (
  //           <Badge variant='outline'>
  //             <Link href={`#${log.transaction.pid}`}>
  //               Handed off from: {log.transaction.pid}
  //             </Link>
  //           </Badge>
  //         )}
  //       </div>

  //       <div className='flex justify-between'>
  //         <LabeledField
  //           label='Application'
  //           text={log.application.name}
  //         />
  //         <LabeledField
  //           label='ID'
  //           text={log.transaction.id.toString()}
  //           position='end'
  //         />
  //       </div>
  //     </CardHeader>
  //     <Separator className='mx-auto w-[calc(100%-1.5rem)]!' />
  //     <CardContent className='px-3 flex flex-col gap-4'>
  //       <div>
  //         <p>
  //           Type:{' '}
  //           <span className='text-muted-foreground'>
  //             {log.transaction.type}
  //           </span>
  //         </p>
  //         <p>
  //           Conection:{' '}
  //           <span className='text-muted-foreground'>
  //             {log.transaction.dest}
  //           </span>
  //         </p>
  //         <p>
  //           User:{' '}
  //           <span className='text-muted-foreground'>
  //             {log.user.relativeName}
  //           </span>
  //         </p>
  //       </div>

  //       <div className='flex justify-between'>
  //         <StatusTransaction
  //           verdict={log.decision.verdict}
  //           checkpoints={log.timing.checkpoints}
  //         />
  //         <div className='flex gap-2 items-center'>
  //           <Connection
  //             trs={log.transaction.id}
  //             checkpoints={log.timing.checkpoints}
  //           />
  //           <Button
  //             className='text-xs leading-3 p-[9px] h-fit'
  //             onClick={() => {
  //               setSelectedTransactionId(log.transaction.id);
  //             }}
  //           >
  //             More
  //           </Button>
  //         </div>
  //       </div>
  //     </CardContent>
  //   </Card>
  // );
  return (
    <Card
      className='shadow-sm p-2 gap-0 max-w-[1200px] w-full'
      id={log.transaction.id}
    >
      <CardHeader className='p-1'>
        <CardTitle className='flex items-center justify-between '>
          <span className='flex items-center gap-2'>
            <span className='text-xl font-semibold'>
              {log.application.name}
            </span>
            <Badge variant='secondary'>{log.transaction.type}</Badge>
            {log.transaction.pid && (
              <Badge variant='secondary'>
                <Link href={`#${log.transaction.pid}`}>
                  Handed off from: {log.transaction.pid}
                </Link>
              </Badge>
            )}
          </span>
          <div className='flex items-center gap-2'>
            <Button
              variant='outline'
              onClick={() => {
                setSelectedTransactionId(log.transaction.id);
              }}
            >
              More
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className='p-1'>
        <div className='grid md:grid-cols-2 gap-4'>
          <div>
            <Field label='ID' value={log.transaction.id} />
            <Field label='Aplication' value={log.application.name} />
            <Field
              label='Conection'
              bold
              value={`${log.transaction.dest}`}
            />
            <Field
              label='Date'
              value={dayjs(log.connection.time).format(
                'DD MMMM YYYY',
              )}
            />
            <Field
              label='Hour'
              value={dayjs(log.connection.time).format('hh:mm:ss A')}
            />
          </div>
          <div>
            <Field label='User' value={log.user.name} />
            <Field label='Realm' value={log.user.realm} />
            <Field
              label='Client'
              value={`${log.connection.client}:${log.connection.sourcePort}`}
            />
            <div className='py-1'>
              <div className='text-sm text-muted-foreground mb-1'>
                Categories
              </div>
              <div className='flex flex-wrap gap-2'>
                {log.decision.categories.map((c) => (
                  <Badge key={c}>{c}</Badge>
                ))}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// function Connection({
//   checkpoints,
// }: {
//   checkpoints: Checkpoints;
//   trs: string;
// }) {
//   const positionVal = useRef(0);
//   const [position, setPosition] = useState(0);

//   const connectionLine = [
//     {
//       name: 'Transaction start',
//       id: 1,
//       startMs: checkpoints['new-connection']?.startMs,
//       elapsedMs: checkpoints['new-connection']?.elapsedMs,
//       description: `Finished establishing client side TCP connection in ${checkpoints['new-connection']?.elapsedMs}ms`,
//       checkpointID: 'new-connection',
//       icon: Waypoints,
//     },
//     {
//       name: 'Client connection',
//       id: 2,
//       startMs: checkpoints['new-connection']?.startMs,
//       elapsedMs: checkpoints['client-in']?.elapsedMs,
//       description: `client started sending data ${checkpoints['client-in']?.startMs}ms in, finished in ${checkpoints['client-out']?.elapsedMs}ms`,
//       checkpointID: 'client-in',
//       icon: User,
//     },
//     {
//       name: 'Server connection',
//       id: 3,
//       startMs: checkpoints['new-connection']?.startMs,
//       elapsedMs: checkpoints['server-out']?.elapsedMs,
//       description: `Server side connection started at ${checkpoints['server-out']?.startMs}ms`,
//       checkpointID: 'server-out',
//       icon: HardDriveUpload,
//     },
//     {
//       name: 'Server response',
//       id: 4,
//       startMs: checkpoints['new-connection']?.startMs,
//       elapsedMs: checkpoints['server-in']?.elapsedMs,
//       description: `Server started sending response at ${checkpoints['server-in']?.startMs}ms and finished in ${checkpoints['server-in']?.elapsedMs}ms`,
//       checkpointID: 'server-in',
//       icon: HardDriveDownload,
//     },
//     {
//       name: 'Client response',
//       id: 5,
//       startMs: checkpoints['new-connection']?.startMs,
//       elapsedMs: checkpoints['client-out']?.elapsedMs,
//       description: `Proxy started sending data to client at ${checkpoints['client-out']?.startMs}ms, took ${checkpoints['client-out']?.elapsedMs}ms `,
//       checkpointID: 'client-out',
//       icon: User,
//     },
//   ];

//   useEffect(() => {
//     for (const point of connectionLine) {
//       if (
//         checkpoints[point.checkpointID] === null ||
//         point.id === 5
//       ) {
//         checkpoints[point.checkpointID] === null
//           ? setPosition(positionVal.current)
//           : setPosition(point.id);
//         break;
//       }
//       positionVal.current = point.id;
//     }
//   }, []);

//   return (
//     <Tooltip>
//       <TooltipTrigger asChild>
//         <Badge className='flex justify-center items-center leading-3 p-2 select-none'>
//           Connection
//         </Badge>
//       </TooltipTrigger>
//       <TooltipContent className='max-w-250 p-6 flex flex-col gap-5 items-center'>
//         <p className='font-semibold text-sm'>
//           Total transaction time:{' '}
//           {checkpoints['stop-transaction']?.startMs} ms
//         </p>
//         <Timeline value={position} orientation='horizontal'>
//           {connectionLine.map((point) => (
//             <TimelineItem key={point.id} step={point.id}>
//               <TimelineHeader className='w-fit'>
//                 <TimelineSeparator />

//                 {position >= point.id && (
//                   <TimelineDate className='w-fit'>
//                     {point.startMs} ms
//                   </TimelineDate>
//                 )}

//                 <TimelineTitle className='w-fit'>
//                   {point.name}
//                 </TimelineTitle>
//                 <TimelineIndicator className='bg-primary/10 group-data-completed/timeline-item:bg-primary group-data-completed/timeline-item:text-primary-foreground flex size-6 items-center justify-center border-none group-data-[orientation=vertical]/timeline:-left-7'>
//                   <point.icon size={14} />
//                 </TimelineIndicator>
//               </TimelineHeader>
//               {position >= point.id && (
//                 <TimelineContent>{point.description}</TimelineContent>
//               )}
//             </TimelineItem>
//           ))}
//         </Timeline>
//       </TooltipContent>
//     </Tooltip>
//   );
// }

function StatusTransaction({
  checkpoints,
  verdict,
}: {
  verdict: string;
  checkpoints: Checkpoints;
}) {
  const [status, setStatus] = useState<
    'Allowed' | 'Rejected' | 'Unreached' | 'Exception' | 'Unknown'
  >('Rejected');

  useEffect(() => {
    if (!verdict) {
      setStatus('Unknown');
    } else if (
      verdict.includes('REJECTED') ||
      verdict.includes('DENIED') ||
      verdict.includes('DENY')
    ) {
      setStatus('Rejected');
    } else if (verdict.includes('EXCEPTION')) {
      setStatus('Exception');
    } else if (checkpoints['client-out'] === null) {
      setStatus('Unreached');
    } else if (
      verdict.includes('ALLOWED') ||
      verdict.includes('ALLOW')
    ) {
      setStatus('Allowed');
    }
  }, []);

  return (
    <Badge
      className='flex justify-center items-center leading-0 p-2'
      variant='secondary'
    >
      <div className={statusBadgeStyle({ status })} />
      {status}
    </Badge>
  );
}

function LabeledField({
  label,
  text,
  position = 'start',
}: {
  label: string;
  text: string;
  position?: 'start' | 'end';
}) {
  return (
    <div className={lableledfieldStyle({ position })}>
      <p>{label}</p>
      <p className='text-muted-foreground'>{text}</p>
    </div>
  );
}

const statusBadgeStyle = cva(
  ['flex', 'flex-col', 'rounded', 'px-1', 'py-1'],
  {
    variants: {
      status: {
        Allowed: ['bg-green-300'],
        Rejected: ['bg-red-300'],
        Unreached: ['bg-orange-400'],
        Exception: ['bg-red-300'],
        Unknown: ['bg-gray-300'],
      },
    },
  },
);

const lableledfieldStyle = cva(['flex', 'flex-col'], {
  variants: {
    position: {
      start: ['items-start'],
      end: ['items-end'],
    },
  },
});

export default TransactionCard;
