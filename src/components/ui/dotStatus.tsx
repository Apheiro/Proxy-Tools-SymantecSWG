import { cva } from '@/lib/cva';

const statusBadgeStyle = cva({
  base: [
    'flex',
    'flex-col',
    'rounded',
    'px-1',
    'py-1',
    'relative',
    'before:content-[""] before:animate-ping before:left-0 before:top-0 before:absolute before:w-2 before:h-2 before:rounded-full before:mr-1',
  ],
  variants: {
    status: {
      allowed: ['bg-green-300', 'before:bg-green-300'],
      rejected: ['bg-red-300', 'before:bg-red-300'],
      unreached: ['bg-orange-400', 'before:bg-orange-400'],
      exception: ['bg-red-300', 'before:bg-red-300'],
      unknown: ['bg-gray-300', 'before:bg-gray-300'],
    },
  },
});

export default function DotStatus({
  veredict,
}: {
  veredict:
    | 'allowed'
    | 'rejected'
    | 'unreached'
    | 'exception'
    | 'unknown';
}) {
  return (
    <div
      className={statusBadgeStyle({
        status: veredict,
      })}
    />
  );
}
