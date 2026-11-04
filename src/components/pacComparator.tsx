'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Check,
  CircleAlert,
  Combine,
  Copy,
  Download,
  FileCode2,
  FilePlus2,
  GitCompareArrows,
  LockKeyhole,
  RotateCcw,
  Undo2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import PacMergeDialog from '@/components/pacMergeDialog';
import PacRawText, { PacRawLine } from '@/components/pacRawText';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SelectField, SelectOption } from '@/components/ui/select';
import { TooltipOne } from '@/components/ui/tooltip';
import type { PacSource } from '@/lib/pac';
import {
  comparePacText,
  downloadedText,
  rawLines,
} from '@/lib/pacTextDiff';
import {
  downloadRawPac,
  editsOverlap,
  locatedBlocks,
  mergeResult,
  type MergeChoice,
  type MergeDraft,
  type RawEdit,
} from '@/lib/pacMerge';

type LocatedBlock = ReturnType<typeof locatedBlocks>[number];
const choiceLabel: Record<MergeChoice, string> = {
  accepted: 'Accepted',
  discarded: 'Discarded',
  merged: 'Merged',
};
const byteSize = (text: string) =>
  new TextEncoder().encode(text).length.toLocaleString('en');
const lineWidth = (text: string) =>
  rawLines(text).reduce(
    (width, line) =>
      Math.max(
        width,
        line.replace(/\t/g, '    ').replace(/[^\u0020-\u00ff]/g, 'xx')
          .length + 22,
      ),
    58,
  );

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success('Original text copied.');
  } catch {
    toast.error(
      'Clipboard access failed. Select the text and copy it manually.',
    );
  }
}

export default function PacComparator({
  sources,
  onSaveResult,
  initialReferenceId,
  referenceRequest,
}: {
  sources: PacSource[];
  onSaveResult: (name: string, content: string) => boolean;
  initialReferenceId?: string;
  referenceRequest?: number;
}) {
  const referenceSelectId = useId();
  const comparedSelectId = useId();
  const resultNameId = useId();
  const [referenceId, setReferenceId] = useState('');
  const [comparedId, setComparedId] = useState('');
  const [difference, setDifference] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, MergeDraft>>(
    {},
  );
  const [mergeTarget, setMergeTarget] = useState<LocatedBlock | null>(
    null,
  );
  const [pendingEdit, setPendingEdit] = useState<{
    edit: RawEdit;
    choice: MergeChoice;
    conflicts: number;
  } | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const blockRefs = useRef<(HTMLDivElement | null)[]>([]);
  const available = sources.filter(
    (source) =>
      source.localContent !== undefined ||
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
  const draft = drafts[referenceId];

  const chooseReference = (id: string) => {
    setReferenceId(id);
    setDifference(0);
    const source = sources.find((item) => item.id === id);
    if (!source) return;
    try {
      const base = downloadedText(source);
      if (base === undefined) return;
      setDrafts((current) =>
        current[id]
          ? current
          : {
              ...current,
              [id]: {
                base,
                edits: [],
                decisions: {},
                history: [],
                filename: `${source.name.replace(/\.(pac|dat)$/i, '')}-merged.pac`,
              },
            },
      );
    } catch {
      /* The read error is shown by the comparison panel. */
    }
  };
  useEffect(() => {
    if (initialReferenceId) chooseReference(initialReferenceId);
  }, [initialReferenceId, referenceRequest]);

  const comparison = useMemo(() => {
    if (!reference || !compared) return null;
    try {
      const left = downloadedText(reference);
      const right = downloadedText(compared);
      if (left === undefined || right === undefined)
        return {
          error:
            'Original text is unavailable for an older source. Synchronize it from PAC sources to compare it faithfully.',
        };
      return {
        left,
        right,
        blocks: locatedBlocks(comparePacText(left, right)),
      };
    } catch (error) {
      return { error: String(error) };
    }
  }, [reference, compared]);
  useEffect(() => {
    setDifference(0);
  }, [comparison?.left, comparison?.right]);
  const changes =
    comparison?.blocks?.filter((block) => block.changed) ?? [];
  const active = changes[difference];
  const stale =
    comparison?.left !== undefined &&
    draft &&
    comparison.left !== draft.base;
  const result = draft
    ? mergeResult(draft.base, draft.edits)
    : undefined;
  const reviewed = Object.keys(draft?.decisions ?? {}).length;
  const blockKey = (block: LocatedBlock) =>
    JSON.stringify([
      comparedId,
      block.start,
      block.end,
      block.left.join(''),
      block.right.join(''),
    ]);
  const completed = changes.filter(
    (block) => draft?.decisions[blockKey(block)],
  ).length;
  const activeChoice = active && draft?.decisions[blockKey(active)];
  const leftWidth =
    comparison?.left !== undefined ? lineWidth(comparison.left) : 58;
  const rightWidth =
    comparison?.right !== undefined
      ? lineWidth(comparison.right)
      : 58;
  const columns = {
    gridTemplateColumns: `minmax(${leftWidth}ch,1fr) minmax(${rightWidth}ch,1fr)`,
  };

  const updateDraft = (update: (current: MergeDraft) => MergeDraft) =>
    setDrafts((current) =>
      current[referenceId]
        ? { ...current, [referenceId]: update(current[referenceId]) }
        : current,
    );
  const navigate = (index: number) => {
    if (!changes.length) return;
    const next = (index + changes.length) % changes.length;
    setDifference(next);
    const target = blockRefs.current[next];
    if (target && viewport.current) {
      viewport.current.scrollTo({
        top:
          viewport.current.scrollTop +
          target.getBoundingClientRect().top -
          viewport.current.getBoundingClientRect().top -
          8,
        behavior: 'smooth',
      });
      target.focus({ preventScroll: true });
    }
  };
  const commitEdit = (edit: RawEdit, choice: MergeChoice) => {
    if (!draft || stale) {
      toast.error(
        'The reference changed. Save your draft and reset it before applying changes.',
      );
      setPendingEdit(null);
      return;
    }
    updateDraft((current) => {
      const removed = current.edits.filter(
        (item) => item.id === edit.id || editsOverlap(item, edit),
      );
      const decisions = { ...current.decisions };
      for (const item of removed) delete decisions[item.id];
      decisions[edit.id] = choice;
      return {
        ...current,
        edits: [
          ...current.edits.filter((item) => !removed.includes(item)),
          edit,
        ],
        decisions,
        history: [
          ...current.history.slice(-49),
          { edits: current.edits, decisions: current.decisions },
        ],
      };
    });
    setPendingEdit(null);
  };
  const decide = (
    block: LocatedBlock,
    choice: MergeChoice,
    text?: string,
  ) => {
    if (!draft || stale) return;
    const id = blockKey(block);
    if (choice === 'discarded') {
      updateDraft((current) => ({
        ...current,
        edits: current.edits.filter((item) => item.id !== id),
        decisions: { ...current.decisions, [id]: choice },
        history: [
          ...current.history.slice(-49),
          { edits: current.edits, decisions: current.decisions },
        ],
      }));
      return;
    }
    const edit: RawEdit = {
      id,
      start: block.start,
      end: block.end,
      text: text ?? block.right.join(''),
      origin: compared?.name ?? 'Compared file',
    };
    const conflicts = draft.edits.filter(
      (item) => item.id !== id && editsOverlap(item, edit),
    ).length;
    if (conflicts) setPendingEdit({ edit, choice, conflicts });
    else commitEdit(edit, choice);
  };
  const undo = () =>
    updateDraft((current) => {
      const previous = current.history[current.history.length - 1];
      if (!previous) return current;
      return {
        ...current,
        ...previous,
        history: current.history.slice(0, -1),
      };
    });
  const reset = () => {
    if (!reference) return;
    try {
      const base = downloadedText(reference);
      if (base === undefined)
        throw new Error('Reference text is unavailable.');
      updateDraft((current) => ({
        ...current,
        base,
        edits: [],
        decisions: {},
        history: [],
      }));
      setResetOpen(false);
    } catch (error) {
      toast.error(String(error));
    }
  };
  let changeIndex = -1;

  return (
    <section
      aria-label='WPAD Comparator'
      className='min-w-0 space-y-5'
    >
      <div className='flex flex-wrap items-start justify-between gap-4'>
        <div className='flex items-start gap-3'>
          <span className='flex size-11 items-center justify-center rounded-xl border bg-primary/5 text-primary'>
            <GitCompareArrows className='size-5' />
          </span>
          <div>
            <h2 className='text-xl font-semibold tracking-tight'>
              WPAD Comparator
            </h2>
            <p className='mt-1 max-w-2xl text-sm text-muted-foreground'>
              Review the original text. Make deliberate choices. Build
              a separate file.
            </p>
          </div>
        </div>
        <Badge variant='outline' className='gap-1.5 py-1.5'>
          <LockKeyhole className='size-3' />
          Originals stay intact
        </Badge>
      </div>

      <Card className='gap-0 overflow-hidden py-0'>
        <div className='flex items-center justify-between border-b bg-muted/30 px-5 py-3'>
          <p className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>
            01 · Choose your files
          </p>
          <Badge variant='secondary'>
            {available.length} available
          </Badge>
        </div>
        <CardContent className='grid gap-5 p-5 md:grid-cols-2'>
          {(['reference', 'compared'] as const).map((side) => {
            const source =
              side === 'reference' ? reference : compared;
            const id =
              side === 'reference'
                ? referenceSelectId
                : comparedSelectId;
            return (
              <div key={side} className='min-w-0 space-y-3'>
                <label
                  htmlFor={id}
                  className='flex items-center gap-2 text-sm font-semibold'
                >
                  <span
                    className={`flex size-6 items-center justify-center rounded-md text-xs ${side === 'reference' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}
                  >
                    {side === 'reference' ? 'A' : 'B'}
                  </span>
                  {side === 'reference'
                    ? 'Reference file'
                    : 'Compared file'}
                  {side === 'reference' && (
                    <LockKeyhole className='ml-auto size-3.5 text-muted-foreground' />
                  )}
                </label>
                <SelectField
                  id={id}
                  className='w-full'
                  value={source?.id ?? ''}
                  onValueChange={(value) => {
                    if (side === 'reference') chooseReference(value);
                    else {
                      setComparedId(value);
                      setDifference(0);
                    }
                  }}
                >
                  <SelectOption value=''>
                    {side === 'reference'
                      ? 'Choose reference'
                      : 'Choose file to compare'}
                  </SelectOption>
                  {available.map((file) => (
                    <SelectOption key={file.id} value={file.id}>
                      {file.name} · {file.url || 'Local file'}
                    </SelectOption>
                  ))}
                </SelectField>
                <p
                  className='truncate text-xs text-muted-foreground'
                  title={source?.url}
                >
                  {source
                    ? source.url || 'Independent local file'
                    : side === 'reference'
                      ? 'The starting point for your result. Stays fixed as you compare other files.'
                      : 'Switch files freely. Your accumulated result stays in place.'}
                </p>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {available.length < 2 && (
        <div className='flex items-center gap-3 rounded-xl border border-dashed p-5 text-sm text-muted-foreground'>
          <FileCode2 className='size-5 shrink-0' />
          <output>
            {available.length
              ? 'Only one file is available. Download another source to compare files.'
              : 'No original text is available yet. Add and load a PAC/WPAD source first.'}
          </output>
        </div>
      )}
      {reference && compared && reference.id === compared.id && (
        <output className='block rounded-lg border bg-muted/30 p-4 text-sm'>
          The same file is selected on both sides. Choose another file
          to review differences.
        </output>
      )}
      {comparison?.error && (
        <p
          role='alert'
          className='flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive'
        >
          <CircleAlert className='size-4 shrink-0' />
          {comparison.error}
        </p>
      )}
      {stale && (
        <p
          role='alert'
          className='rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm'
        >
          The reference was updated after this draft started. Save or
          download your current result, then reset it to use the
          latest reference. Review actions are paused.
        </p>
      )}

      <div className='grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_380px]'>
        <Card className='min-w-0 gap-0 overflow-hidden py-0'>
          <div className='flex flex-wrap items-center justify-between gap-3 border-b bg-muted/30 px-5 py-3'>
            <div className='space-y-1'>
              <p className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>
                02 · Review differences
              </p>
              <output className='text-sm font-medium'>
                {comparison?.blocks
                  ? changes.length
                    ? `${completed} of ${changes.length} reviewed`
                    : 'Files are identical, including whitespace and line endings.'
                  : 'Choose two files to start reviewing'}
              </output>
            </div>
            <div className='flex items-center gap-1'>
              <TooltipOne content='Previous difference'>
                <Button
                  variant='outline'
                  size='icon'
                  aria-label='Previous difference'
                  disabled={!changes.length}
                  onClick={() => navigate(difference - 1)}
                >
                  <ArrowUp className='size-4' />
                </Button>
              </TooltipOne>
              <span className='min-w-16 text-center font-mono text-xs text-muted-foreground'>
                {changes.length
                  ? `${difference + 1} / ${changes.length}`
                  : '0 / 0'}
              </span>
              <TooltipOne content='Next difference'>
                <Button
                  variant='outline'
                  size='icon'
                  aria-label='Next difference'
                  disabled={!changes.length}
                  onClick={() => navigate(difference + 1)}
                >
                  <ArrowDown className='size-4' />
                </Button>
              </TooltipOne>
            </div>
          </div>
          {changes.length > 0 && (
            <ScrollArea
              orientation='horizontal'
              className='h-12 border-b'
            >
              <div className='flex w-max min-w-full items-center gap-2 px-4 py-2'>
                {changes.map((block, index) => (
                  <button
                    type='button'
                    key={`${block.start}:${block.end}:${block.rightStart}`}
                    onClick={() => navigate(index)}
                    aria-label={`Go to difference ${index + 1}`}
                    aria-current={
                      index === difference ? 'step' : undefined
                    }
                    className={`flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors ${index === difference ? 'border-primary bg-primary text-primary-foreground' : 'border-transparent bg-muted/50 hover:bg-muted'}`}
                  >
                    {draft?.decisions[blockKey(block)] ? (
                      <Check className='size-3' />
                    ) : (
                      <span className='size-1.5 rounded-full bg-current opacity-40' />
                    )}
                    {index + 1}
                    <span className='opacity-70'>
                      L{block.leftStart}
                    </span>
                  </button>
                ))}
              </div>
            </ScrollArea>
          )}
          <div className='grid grid-cols-2 border-b text-xs'>
            {[
              {
                source: reference,
                text: comparison?.left,
                label: 'Reference',
                tone: 'bg-red-500/5',
              },
              {
                source: compared,
                text: comparison?.right,
                label: 'Compared',
                tone: 'bg-emerald-500/5',
              },
            ].map((side) => (
              <div
                key={side.label}
                className={`flex min-w-0 items-center gap-2 px-4 py-3 first:border-r ${side.tone}`}
              >
                <FileCode2 className='size-4 shrink-0 text-muted-foreground' />
                <div className='min-w-0 flex-1'>
                  <p className='truncate font-medium'>
                    {side.source?.name ?? side.label}
                  </p>
                  <p className='mt-0.5 text-[10px] text-muted-foreground'>
                    {side.text !== undefined
                      ? `${rawLines(side.text).length} lines · ${byteSize(side.text)} bytes · read-only`
                      : 'No file selected'}
                  </p>
                </div>
                <TooltipOne
                  content={`Copy original ${side.label.toLowerCase()}`}
                >
                  <Button
                    size='icon'
                    variant='ghost'
                    className='size-7 shrink-0'
                    aria-label={`Copy original ${side.label.toLowerCase()}`}
                    disabled={side.text === undefined}
                    onClick={() => copy(side.text)}
                  >
                    <Copy className='size-3.5' />
                  </Button>
                </TooltipOne>
              </div>
            ))}
          </div>
          {comparison?.blocks ? (
            <ScrollArea
              orientation='both'
              viewportRef={viewport}
              className='h-[460px]'
              viewportProps={{
                'aria-label': 'Raw PAC text diff',
                tabIndex: 0,
              }}
            >
              <div
                className='min-w-full py-2 font-mono text-xs'
                style={{ minWidth: `${leftWidth + rightWidth}ch` }}
              >
                {comparison.blocks.map((block) => {
                  const index = block.changed ? ++changeIndex : -1;
                  const choice = block.changed
                    ? draft?.decisions[blockKey(block)]
                    : undefined;
                  return (
                    <div
                      key={`${block.start}:${block.end}:${block.rightStart}`}
                      ref={(element) => {
                        if (block.changed)
                          blockRefs.current[index] = element;
                      }}
                      tabIndex={block.changed ? -1 : undefined}
                      data-difference={
                        block.changed ? index : undefined
                      }
                      className={
                        block.changed
                          ? `my-2 border-y ${index === difference ? 'border-primary/50 ring-1 ring-inset ring-primary/40' : 'border-border'}`
                          : ''
                      }
                    >
                      {block.changed && (
                        <div className='flex items-center gap-3 bg-muted/70 px-4 py-2 font-sans text-[11px]'>
                          <button
                            type='button'
                            onClick={() => setDifference(index)}
                            className='font-semibold hover:underline'
                          >
                            Difference {index + 1}
                          </button>
                          <span className='text-muted-foreground'>
                            {block.left.length && block.right.length
                              ? 'Modified'
                              : block.right.length
                                ? 'Added'
                                : 'Removed'}{' '}
                            · −{block.left.length} / +
                            {block.right.length}
                          </span>
                          {choice && (
                            <Badge
                              variant='outline'
                              className='text-[10px]'
                            >
                              {choiceLabel[choice]}
                            </Badge>
                          )}
                        </div>
                      )}
                      {Array.from(
                        {
                          length: Math.max(
                            block.left.length,
                            block.right.length,
                          ),
                        },
                        (_, row) => (
                          <div
                            key={`row-${block.leftStart + row}:${block.rightStart + row}`}
                            className='grid'
                            style={columns}
                          >
                            <div
                              className={`min-w-0 border-r pr-5 ${block.changed && block.left[row] !== undefined ? 'bg-red-500/10' : 'bg-muted/5'}`}
                            >
                              {block.left[row] !== undefined ? (
                                <PacRawLine
                                  text={block.left[row]}
                                  number={block.leftStart + row}
                                />
                              ) : (
                                <div className='min-h-7 bg-muted/20' />
                              )}
                            </div>
                            <div
                              className={`min-w-0 pr-5 ${block.changed && block.right[row] !== undefined ? 'bg-emerald-500/10' : 'bg-muted/5'}`}
                            >
                              {block.right[row] !== undefined ? (
                                <PacRawLine
                                  text={block.right[row]}
                                  number={block.rightStart + row}
                                />
                              ) : (
                                <div className='min-h-7 bg-muted/20' />
                              )}
                            </div>
                          </div>
                        ),
                      )}
                    </div>
                  );
                })}
                {comparison.left === '' &&
                  comparison.right === '' && (
                    <p className='p-6 font-sans text-muted-foreground'>
                      Both files are empty.
                    </p>
                  )}
              </div>
            </ScrollArea>
          ) : (
            <div className='flex h-72 flex-col items-center justify-center gap-3 bg-muted/10 px-6 text-center'>
              <GitCompareArrows className='size-9 text-muted-foreground/40' />
              <p className='text-sm font-medium'>
                A clear view of every change
              </p>
              <p className='max-w-sm text-xs text-muted-foreground'>
                Your reference is on the left; the compared file is on
                the right. All lines, whitespace and original line
                endings remain visible.
              </p>
            </div>
          )}
          <div className='space-y-3 border-t bg-muted/20 p-4'>
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <p className='text-sm font-semibold'>
                {active
                  ? `Difference ${difference + 1}`
                  : 'Review actions'}
                {activeChoice && (
                  <span className='ml-2 text-xs font-normal text-muted-foreground'>
                    {choiceLabel[activeChoice]}
                  </span>
                )}
              </p>
              <div className='flex gap-1'>
                <Button
                  size='sm'
                  variant='ghost'
                  aria-label='Copy reference fragment'
                  disabled={!active}
                  onClick={() => copy(active.left.join(''))}
                >
                  <Copy className='size-3' />
                  Reference fragment
                </Button>
                <Button
                  size='sm'
                  variant='ghost'
                  aria-label='Copy compared fragment'
                  disabled={!active}
                  onClick={() => copy(active.right.join(''))}
                >
                  <Copy className='size-3' />
                  Compared fragment
                </Button>
              </div>
            </div>
            <div className='flex flex-wrap gap-2'>
              <Button
                size='sm'
                disabled={!active || !draft || Boolean(stale)}
                onClick={() => decide(active, 'accepted')}
              >
                <Check className='size-4' />
                Accept compared
              </Button>
              <Button
                size='sm'
                variant='outline'
                disabled={!active || !draft || Boolean(stale)}
                onClick={() => decide(active, 'discarded')}
              >
                <X className='size-4' />
                Discard change
              </Button>
              <Button
                size='sm'
                variant='outline'
                disabled={!active || !draft || Boolean(stale)}
                onClick={() => setMergeTarget(active)}
              >
                <Combine className='size-4' />
                Merge fragments
              </Button>
              <Button
                size='sm'
                variant='ghost'
                className='sm:ml-auto'
                disabled={!changes.length}
                onClick={() => navigate(difference + 1)}
              >
                Next
                <ArrowRight className='size-4' />
              </Button>
            </div>
            <p className='text-[11px] leading-relaxed text-muted-foreground'>
              Accept uses the compared fragment. Discard removes this
              fragment’s decision; other applied changes stay in
              place. Merge lets you select lines from both sides.
              Unreviewed differences retain the reference text. LF,
              CRLF, CR and EOF are shown explicitly.
            </p>
          </div>
        </Card>

        <Card className='min-w-0 gap-0 overflow-hidden py-0 xl:sticky xl:top-5'>
          <div className='flex items-center gap-3 border-b bg-primary/5 px-5 py-4'>
            <span className='flex size-9 items-center justify-center rounded-lg border bg-background text-primary'>
              <FilePlus2 className='size-4' />
            </span>
            <div className='min-w-0 flex-1'>
              <p className='text-xs font-semibold uppercase tracking-wider text-muted-foreground'>
                03 · Your result
              </p>
              <p className='mt-0.5 text-sm font-semibold'>
                A separate PAC/WPAD file
              </p>
            </div>
            {draft && (
              <Badge variant='secondary'>
                {draft.edits.length} changes
              </Badge>
            )}
          </div>
          <CardContent className='space-y-4 p-4'>
            <div className='space-y-2'>
              <label
                htmlFor={resultNameId}
                className='text-xs font-medium'
              >
                New filename
              </label>
              <Input
                id={resultNameId}
                placeholder='merged-wpad.pac'
                disabled={!draft}
                value={draft?.filename ?? ''}
                onChange={(event) => {
                  const filename = event.target.value;
                  updateDraft((current) => ({
                    ...current,
                    filename,
                  }));
                }}
              />
            </div>
            <div className='flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground'>
              <span>
                {result !== undefined
                  ? `${rawLines(result).length} lines · ${byteSize(result)} bytes`
                  : 'Starts with your reference'}
              </span>
              <div className='flex gap-1'>
                <TooltipOne content='Undo last decision'>
                  <Button
                    size='icon'
                    variant='ghost'
                    className='size-7'
                    aria-label='Undo last decision'
                    disabled={!draft?.history.length}
                    onClick={undo}
                  >
                    <Undo2 className='size-3.5' />
                  </Button>
                </TooltipOne>
                <TooltipOne content='Reset result to reference'>
                  <Button
                    size='icon'
                    variant='ghost'
                    className='size-7'
                    aria-label='Reset result to reference'
                    disabled={!draft}
                    onClick={() => setResetOpen(true)}
                  >
                    <RotateCcw className='size-3.5' />
                  </Button>
                </TooltipOne>
                <TooltipOne content='Copy result'>
                  <Button
                    size='icon'
                    variant='ghost'
                    className='size-7'
                    aria-label='Copy result'
                    disabled={result === undefined}
                    onClick={() => copy(result)}
                  >
                    <Copy className='size-3.5' />
                  </Button>
                </TooltipOne>
              </div>
            </div>
            {result !== undefined ? (
              <PacRawText
                text={result}
                label='Merged result preview'
                className='h-[320px]'
              />
            ) : (
              <div className='flex h-52 items-center justify-center rounded-lg border border-dashed bg-muted/10 px-6 text-center text-sm text-muted-foreground'>
                Choose a reference to begin. Your result will update
                here as you review differences.
              </div>
            )}
            <div className='space-y-2'>
              <Button
                className='w-full'
                disabled={
                  result === undefined || !draft?.filename.trim()
                }
                onClick={() => {
                  if (onSaveResult(draft.filename.trim(), result))
                    toast.success(
                      'New independent file saved to PAC File Manager.',
                    );
                }}
              >
                <FilePlus2 className='size-4' />
                Save as new file
              </Button>
              <Button
                variant='outline'
                className='w-full'
                disabled={
                  result === undefined || !draft?.filename.trim()
                }
                onClick={() =>
                  downloadRawPac(draft.filename.trim(), result)
                }
              >
                <Download className='size-4' />
                Download result
              </Button>
            </div>
            <p className='text-[11px] leading-relaxed text-muted-foreground'>
              {reviewed
                ? `${reviewed} decisions in this reference draft. `
                : ''}
              Switch compared files to continue building this result.
              Drafts remain in this session; save a new file to keep
              one after leaving. Saving always creates a new file.
            </p>
          </CardContent>
        </Card>
      </div>
      {mergeTarget && (
        <PacMergeDialog
          key={blockKey(mergeTarget)}
          block={mergeTarget}
          onClose={() => setMergeTarget(null)}
          onApply={(text) => {
            decide(mergeTarget, 'merged', text);
            setMergeTarget(null);
          }}
        />
      )}
      <Dialog
        open={Boolean(pendingEdit)}
        onOpenChange={(open) => {
          if (!open) setPendingEdit(null);
        }}
      >
        <DialogContent className='sm:max-w-5xl'>
          <DialogHeader>
            <DialogTitle>Resolve overlapping changes</DialogTitle>
            <DialogDescription>
              This fragment overlaps {pendingEdit?.conflicts}{' '}
              previously applied change(s), possibly from another
              compared file. Replacing them removes those earlier
              choices from the result. Your original files stay
              intact.
            </DialogDescription>
          </DialogHeader>
          {pendingEdit && draft && (
            <div className='grid min-w-0 gap-4 md:grid-cols-2'>
              <section className='min-w-0 space-y-2'>
                <h3 className='text-sm font-semibold'>
                  Current result
                </h3>
                <PacRawText
                  text={result ?? ''}
                  label='Current result before replacement'
                  className='h-64'
                />
              </section>
              <section className='min-w-0 space-y-2'>
                <h3 className='text-sm font-semibold'>
                  After replacement
                </h3>
                <PacRawText
                  text={mergeResult(draft.base, [
                    ...draft.edits.filter(
                      (item) =>
                        item.id !== pendingEdit.edit.id &&
                        !editsOverlap(item, pendingEdit.edit),
                    ),
                    pendingEdit.edit,
                  ])}
                  label='Result after replacement'
                  className='h-64'
                />
              </section>
            </div>
          )}
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => setPendingEdit(null)}
            >
              Keep existing result
            </Button>
            <Button
              onClick={() =>
                pendingEdit &&
                commitEdit(pendingEdit.edit, pendingEdit.choice)
              }
            >
              Replace overlapping changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset this result?</DialogTitle>
            <DialogDescription>
              All decisions for this reference draft will be cleared.
              The result will start again from the latest reference
              text. Saved files and other reference drafts stay
              intact.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => setResetOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={reset}>Reset result</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
