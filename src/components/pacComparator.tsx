'use client';

import { useId, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { SelectField, SelectOption } from '@/components/ui/select';
import type { PacSource } from '@/lib/pac';
import { comparePacText, downloadedText } from '@/lib/pacTextDiff';

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success('Text copied.');
  } catch {
    toast.error(
      'Could not access the clipboard. Select the text and copy it manually.',
    );
  }
}

function TextLine({
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
        : 'No final newline';
  const content = text.replace(/(?:\r\n|\r|\n)$/, '');
  return (
    <div className='flex min-h-6'>
      <span
        aria-hidden='true'
        className='w-12 shrink-0 select-none pr-3 text-right text-muted-foreground'
      >
        {number}
      </span>
      <code className='whitespace-pre select-text [tab-size:4]'>
        {content}
      </code>
      <span
        className='ml-4 select-none text-xs text-muted-foreground'
        title={`Line ending: ${ending}`}
      >
        {content.startsWith('\uFEFF') ? 'BOM · ' : ''}
        {ending}
      </span>
    </div>
  );
}

export default function PacComparator({
  sources,
}: {
  sources: PacSource[];
}) {
  const referenceSelectId = useId();
  const comparedSelectId = useId();
  const [referenceId, setReferenceId] = useState('');
  const [comparedId, setComparedId] = useState('');
  const [difference, setDifference] = useState(0);
  const blockRefs = useRef<(HTMLDivElement | null)[]>([]);
  // Include legacy downloads even when their original text was not retained.
  const available = sources.filter(
    (source) =>
      source.downloadedContent !== undefined ||
      source.pendingContent !== undefined ||
      source.remoteContent !== undefined ||
      source.lastSyncedAt,
  );
  const reference = available.find(
    (source) => source.id === referenceId,
  );
  const compared = available.find(
    (source) => source.id === comparedId,
  );
  const result = useMemo(() => {
    if (!reference || !compared) return {};
    try {
      const left = downloadedText(reference);
      const right = downloadedText(compared);
      if (left === undefined || right === undefined)
        return {
          error:
            'Original downloaded text is unavailable for this older source. Synchronize it from PAC sources to compare it faithfully.',
        };
      return { left, right, blocks: comparePacText(left, right) };
    } catch (error) {
      return { error: String(error) };
    }
  }, [reference, compared]);
  const changed =
    result.blocks?.filter((block) => block.changed) ?? [];
  const navigate = (step: number) => {
    const next =
      (difference + step + changed.length) % changed.length;
    setDifference(next);
    blockRefs.current[next]?.scrollIntoView({
      block: 'center',
      behavior: 'smooth',
    });
    blockRefs.current[next]?.focus({ preventScroll: true });
  };
  let changedIndex = -1;
  return (
    <section
      aria-label='Comparador de WPAD'
      className='min-w-0 space-y-4'
    >
      <div>
        <h2 className='text-lg font-semibold'>Comparador de WPAD</h2>
        <p className='text-sm text-muted-foreground'>
          Compare complete downloaded text. Keep a reference and
          choose other files one at a time. Select text or copy each
          difference; files are never changed.
        </p>
      </div>
      {available.length < 2 && (
        <output>
          {available.length === 0
            ? 'No downloaded PAC/WPAD files available. Add and load a source first.'
            : 'Only one downloaded file is available. Download another source to compare files.'}
        </output>
      )}
      <div className='grid gap-4 md:grid-cols-2'>
        <div className='space-y-2'>
          <label
            htmlFor={referenceSelectId}
            className='text-sm font-medium'
          >
            Reference file
          </label>
          <SelectField
            id={referenceSelectId}
            value={reference?.id ?? ''}
            onValueChange={(id) => {
              setReferenceId(id);
              setDifference(0);
            }}
          >
            <SelectOption value=''>Choose reference</SelectOption>
            {available.map((source) => (
              <SelectOption key={source.id} value={source.id}>
                {source.name} · {source.url || source.id}
              </SelectOption>
            ))}
          </SelectField>
        </div>
        <div className='space-y-2'>
          <label
            htmlFor={comparedSelectId}
            className='text-sm font-medium'
          >
            Compared file
          </label>
          <SelectField
            id={comparedSelectId}
            value={compared?.id ?? ''}
            onValueChange={(id) => {
              setComparedId(id);
              setDifference(0);
            }}
          >
            <SelectOption value=''>
              Choose file to compare
            </SelectOption>
            {available.map((source) => (
              <SelectOption key={source.id} value={source.id}>
                {source.name} · {source.url || source.id}
              </SelectOption>
            ))}
          </SelectField>
        </div>
      </div>
      {reference && compared && reference.id === compared.id && (
        <output>
          The same file is selected on both sides. Choose another file
          to examine differences.
        </output>
      )}
      {result.error && (
        <p role='alert' className='text-destructive'>
          {result.error}
        </p>
      )}
      {result.blocks && (
        <>
          <div className='flex flex-wrap items-center gap-2'>
            <output className='mr-auto text-sm'>
              {changed.length
                ? `${changed.length} differences · ${difference + 1} / ${changed.length}`
                : 'Files are identical (including whitespace and line endings).'}
            </output>
            <Button
              variant='outline'
              disabled={!changed.length}
              onClick={() => navigate(-1)}
            >
              Previous difference
            </Button>
            <Button
              variant='outline'
              disabled={!changed.length}
              onClick={() => navigate(1)}
            >
              Next difference
            </Button>
          </div>
          <div className='grid grid-cols-2 gap-2 text-sm font-medium'>
            <div className='min-w-0 break-all'>
              Reference: {reference.name}{' '}
              <Button
                variant='ghost'
                size='sm'
                onClick={() => copy(result.left)}
              >
                Copy original reference
              </Button>
            </div>
            <div className='min-w-0 break-all'>
              Compared: {compared.name}{' '}
              <Button
                variant='ghost'
                size='sm'
                onClick={() => copy(result.right)}
              >
                Copy original compared
              </Button>
            </div>
          </div>
          <p className='text-xs text-muted-foreground'>
            Red: removed · Green: added · Paired red/green: modified.
            LF/CRLF/CR and missing final newlines are shown
            explicitly. Copy buttons preserve the original text and
            terminators.
          </p>
          <section
            className='max-h-[65vh] overflow-auto rounded-lg border'
            aria-label='Raw PAC text diff'
          >
            <div className='min-w-[800px] font-mono text-xs'>
              {result.blocks.map((block) => {
                const current = block.changed ? ++changedIndex : -1;
                const rows = Math.max(
                  block.left.length,
                  block.right.length,
                );
                return (
                  <div
                    key={`${block.leftStart}:${block.rightStart}`}
                    ref={(element) => {
                      if (block.changed)
                        blockRefs.current[current] = element;
                    }}
                    tabIndex={block.changed ? -1 : undefined}
                    data-difference={
                      block.changed ? current : undefined
                    }
                    className={
                      block.changed && difference === current
                        ? 'outline-2 -outline-offset-2 outline-primary'
                        : ''
                    }
                  >
                    {block.changed && (
                      <div className='grid grid-cols-2 border-y bg-muted/40'>
                        <div className='px-2'>
                          {block.left.length > 0 && (
                            <Button
                              size='sm'
                              variant='ghost'
                              onClick={() =>
                                copy(block.left.join(''))
                              }
                            >
                              Copy reference fragment
                            </Button>
                          )}
                        </div>
                        <div className='border-l px-2'>
                          {block.right.length > 0 && (
                            <Button
                              size='sm'
                              variant='ghost'
                              onClick={() =>
                                copy(block.right.join(''))
                              }
                            >
                              Copy compared fragment
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                    {Array.from({ length: rows }, (_, row) => (
                      <div
                        key={`${block.leftStart + row}:${block.rightStart + row}`}
                        className='grid grid-cols-2'
                      >
                        <div
                          className={`overflow-x-auto py-0.5 ${block.changed && block.left[row] !== undefined ? 'bg-red-500/15' : ''}`}
                        >
                          {block.left[row] !== undefined && (
                            <TextLine
                              text={block.left[row]}
                              number={block.leftStart + row}
                            />
                          )}
                        </div>
                        <div
                          className={`overflow-x-auto border-l py-0.5 ${block.changed && block.right[row] !== undefined ? 'bg-green-500/15' : ''}`}
                        >
                          {block.right[row] !== undefined && (
                            <TextLine
                              text={block.right[row]}
                              number={block.rightStart + row}
                            />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}
    </section>
  );
}
