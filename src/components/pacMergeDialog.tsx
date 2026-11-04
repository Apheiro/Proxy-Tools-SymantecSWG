'use client';

import { useId, useState } from 'react';
import { ArrowDown, Combine } from 'lucide-react';
import PacRawText, { PacRawLine } from '@/components/pacRawText';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SelectField, SelectOption } from '@/components/ui/select';
import type { TextBlock } from '@/lib/pacTextDiff';

export default function PacMergeDialog({
  block,
  onClose,
  onApply,
}: {
  block: TextBlock;
  onClose: () => void;
  onApply: (text: string) => void;
}) {
  const orderId = useId();
  const [left, setLeft] = useState(() => block.left.map(() => true));
  const [right, setRight] = useState(() =>
    block.right.map(() => true),
  );
  const [order, setOrder] = useState('reference-first');
  const referenceText = block.left
    .filter((_, index) => left[index])
    .join('');
  const comparedText = block.right
    .filter((_, index) => right[index])
    .join('');
  const content =
    order === 'reference-first'
      ? referenceText + comparedText
      : comparedText + referenceText;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className='flex max-h-[90dvh] flex-col sm:max-w-5xl'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <Combine className='size-5' />
            Merge selected fragments
          </DialogTitle>
          <DialogDescription>
            Select the original lines to include, then choose their
            order. Every selected line keeps its exact content and
            terminator. No separators or newlines are inserted.
          </DialogDescription>
        </DialogHeader>
        <div className='grid min-h-0 gap-4 md:grid-cols-2'>
          {(['left', 'right'] as const).map((side) => {
            const lines = side === 'left' ? block.left : block.right;
            const selected = side === 'left' ? left : right;
            const setSelected = side === 'left' ? setLeft : setRight;
            return (
              <section key={side} className='min-w-0 space-y-2'>
                <div className='flex items-center justify-between gap-2'>
                  <h3 className='text-sm font-semibold'>
                    {side === 'left'
                      ? 'Reference fragment'
                      : 'Compared fragment'}
                  </h3>
                  <div className='flex gap-2'>
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={() =>
                        setSelected(lines.map(() => true))
                      }
                    >
                      All
                    </Button>
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={() =>
                        setSelected(lines.map(() => false))
                      }
                    >
                      None
                    </Button>
                  </div>
                </div>
                <ScrollArea
                  orientation='both'
                  className='h-44 rounded-lg border bg-muted/20'
                >
                  <div className='w-max min-w-full py-2 pr-4 font-mono text-xs'>
                    {lines.map((line, index) => (
                      <label
                        key={`fragment-${index + 1}`}
                        className='flex cursor-pointer items-start gap-1 px-2 hover:bg-muted/60'
                      >
                        <input
                          type='checkbox'
                          className='mt-2 accent-primary'
                          aria-label={`Include ${side === 'left' ? 'reference' : 'compared'} line ${index + 1}`}
                          checked={selected[index]}
                          onChange={(event) =>
                            setSelected((current) =>
                              current.map((value, position) =>
                                position === index
                                  ? event.target.checked
                                  : value,
                              ),
                            )
                          }
                        />
                        <PacRawLine
                          text={line}
                          number={
                            (side === 'left'
                              ? block.leftStart
                              : block.rightStart) + index
                          }
                        />
                      </label>
                    ))}
                    {!lines.length && (
                      <p className='p-4 font-sans text-muted-foreground'>
                        No lines on this side.
                      </p>
                    )}
                  </div>
                </ScrollArea>
              </section>
            );
          })}
        </div>
        <div className='flex flex-wrap items-center gap-3'>
          <ArrowDown className='size-4 text-muted-foreground' />
          <label htmlFor={orderId} className='text-sm font-medium'>
            Fragment order
          </label>
          <SelectField
            id={orderId}
            value={order}
            onValueChange={setOrder}
          >
            <SelectOption value='reference-first'>
              Reference, then compared
            </SelectOption>
            <SelectOption value='compared-first'>
              Compared, then reference
            </SelectOption>
          </SelectField>
        </div>
        <PacRawText
          text={content}
          label='Merged fragment preview'
          className='h-40 shrink-0'
        />
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onApply(content)}>
            <Combine className='size-4' />
            Use merged fragment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
