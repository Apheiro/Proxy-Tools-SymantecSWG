'use client';

import { ScrollArea } from '@/components/ui/scroll-area';
import { rawLines } from '@/lib/pacTextDiff';

export function PacRawLine({
  text,
  number,
}: {
  text: string;
  number: number;
}) {
  const ending = text.endsWith('\r\n')
    ? 'CRLF'
    : text.endsWith('\n')
      ? 'LF'
      : text.endsWith('\r')
        ? 'CR'
        : 'EOF';
  return (
    <div className='flex min-h-7 items-baseline py-0.5'>
      <span
        aria-hidden='true'
        className='w-12 shrink-0 select-none bg-inherit pr-3 text-right text-muted-foreground/70'
      >
        {number}
      </span>
      <code className='whitespace-pre select-text [tab-size:4]'>
        {text.replace(/(?:\r\n|\r|\n)$/, '')}
      </code>
      <span
        className='ml-5 shrink-0 select-none whitespace-nowrap text-[10px] text-muted-foreground/60'
        title={
          ending === 'EOF'
            ? 'No final newline'
            : `Original line ending: ${ending}`
        }
      >
        {text.startsWith('\uFEFF') ? 'BOM · ' : ''}
        {ending}
      </span>
    </div>
  );
}

export default function PacRawText({
  text,
  label,
  className = 'h-80',
}: {
  text: string;
  label: string;
  className?: string;
}) {
  return (
    <ScrollArea
      orientation='both'
      className={`min-w-0 rounded-lg border bg-muted/15 ${className}`}
      viewportProps={{ 'aria-label': label, tabIndex: 0 }}
    >
      <div className='w-max min-w-full py-3 pr-6 font-mono text-xs leading-6'>
        {rawLines(text).map((line, index) => (
          <PacRawLine
            key={`line-${index + 1}`}
            text={line}
            number={index + 1}
          />
        ))}
        {text === '' && (
          <p className='px-4 font-sans text-muted-foreground'>
            Empty file · 0 bytes
          </p>
        )}
      </div>
    </ScrollArea>
  );
}
