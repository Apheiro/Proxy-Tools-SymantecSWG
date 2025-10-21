/** biome-ignore-all lint/style/useNamingConvention: <> */
import dayjs from 'dayjs';
import Link from 'next/link';
import type { Dispatch, SetStateAction } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import DotStatus from './ui/dotStatus';

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

        <Badge
          className='flex justify-center items-center leading-0 p-2 gap-2 mt-2'
          variant='secondary'
        >
          <DotStatus
            veredict={
              log.decision.verdict as
                | 'allowed'
                | 'rejected'
                | 'unreached'
                | 'exception'
                | 'unknown'
            }
          />
          {log.decision.verdict.toUpperCase()}
        </Badge>
      </CardContent>
    </Card>
  );
}

export default TransactionCard;
