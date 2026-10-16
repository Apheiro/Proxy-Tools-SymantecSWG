'use client';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Layers3,
  Library,
  Plus,
  Power,
  Redo2,
  Search,
  Settings2,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import CplObjectEditor from '@/components/cplObjectEditor';
import CplObjectLibrary from '@/components/cplObjectLibrary';
import CplRuleBuilder from '@/components/cplRuleBuilder';
import CplRuleComposer from '@/components/cplRuleComposer';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SelectField, SelectOption } from '@/components/ui/select';
import {
  capabilityFor,
  makeExpression,
  POLICY_CAPABILITIES,
  POLICY_COLUMNS,
  type PolicyColumn,
} from '@/lib/cplCapabilities';
import {
  CPL_LAYERS,
  CPL_REFERENCE,
  type CplGesture,
} from '@/lib/cplCatalog';
import {
  addDefinition,
  addLayer,
  addRule,
  type CplDefinition,
  type CplLayer,
  type CplRule,
  definitionRows,
  moveLayer,
  moveRule,
  parseAtoms,
  parseCpl,
  patchCpl,
  toggleRule,
  updateLayer,
  updateRule,
} from '@/lib/cplDocument';
import {
  columnFor,
  describeAtom,
  indexPolicy,
} from '@/lib/cplSemantics';
import { cva } from '@/lib/cva';

const layerStyle = cva({
  base: 'flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-left',
  variants: {
    active: {
      true: 'border-primary/40 bg-primary/5',
      false: 'border-transparent hover:bg-muted',
    },
  },
});
type Edit = {
  kind: 'layer' | 'rule' | 'object' | 'objectRow' | 'delete';
  base: string;
  layer?: CplLayer;
  rule?: CplRule;
  definition?: CplDefinition;
  deleteRange?: { start: number; end: number };
  title?: string;
  column?: PolicyColumn;
};
export default function CplVisualEditor({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const id = useId();
  const document = useMemo(() => parseCpl(value), [value]);
  const policyIndex = useMemo(
    () => indexPolicy(value, document),
    [value, document],
  );
  const [bulkObject, setBulkObject] = useState<CplDefinition | null>(
    null,
  );
  const [selected, setSelected] = useState(0);
  const [tab, setTab] = useState<'rules' | 'objects' | 'preserved'>(
    'rules',
  );
  const [query, setQuery] = useState('');
  const [edit, setEdit] = useState<Edit | null>(null);
  const [expressions, setExpressions] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState('Proxy');
  const [guard, setGuard] = useState('');
  const [objectKind, setObjectKind] = useState('condition');
  const [objectRows, setObjectRows] = useState<string[]>([]);
  const [pasteList, setPasteList] = useState(false);
  const [listType, setListType] = useState('url.domain');
  const [listValues, setListValues] = useState('');
  const [undo, setUndo] = useState<string[]>([]);
  const [redo, setRedo] = useState<string[]>([]);
  const last = useRef(value);
  const viewport = useRef<HTMLElement>(null);
  const layer =
    document.layers[Math.min(selected, document.layers.length - 1)];
  const rules = useMemo(
    () =>
      layer?.rules.filter(
        (r) =>
          !query ||
          (query.startsWith('line:')
            ? r.line === Number(query.slice(5))
            : r.raw.toLowerCase().includes(query.toLowerCase())),
      ) || [],
    [layer, query],
  );
  const virtual = useVirtualizer({
    count: rules.length,
    getScrollElement: () => viewport.current,
    estimateSize: () => 90,
    overscan: 8,
  });
  useEffect(() => {
    if (last.current !== value) {
      setUndo([]);
      setRedo([]);
      last.current = value;
    }
  }, [value]);
  const imported = useMemo<CplGesture[]>(() => {
    const atoms = document.layers.flatMap((l) =>
      l.rules.flatMap((r) => r.atoms),
    );
    return [
      ...atoms.map((a) => ({
        name: a.name,
        kind: a.kind,
        form: a.form,
        hint: 'Imported CPL gesture: original values are retained.',
        family: 'From this policy',
      })),
      ...document.definitions
        .filter((d) => d.kind.toLowerCase() === 'action')
        .map((d) => ({
          name: `action.${d.name}`,
          kind: 'action' as const,
          form: 'call' as const,
          hint: 'yes / no',
          family: 'Policy objects',
        })),
    ];
  }, [document]);
  function change(next: string) {
    if (disabled) return;
    if (next === value) return;
    setUndo((old) => {
      const history = [...old, value];
      while (
        history.length > 1 &&
        (history.length > 10 ||
          history.reduce((n, s) => n + s.length, 0) > 8 * 1024 * 1024)
      )
        history.shift();
      return history;
    });
    setRedo([]);
    last.current = next;
    onChange(next);
  }
  function perform(fn: () => string) {
    try {
      change(fn());
    } catch (error) {
      toast.error(String(error));
    }
  }
  function open(next: Omit<Edit, 'base'>) {
    setEdit({ ...next, base: value });
    setExpressions(
      next.kind === 'layer'
        ? parseAtoms(next.layer?.guard || '').atoms.map((a) => a.raw)
        : next.rule?.atoms.map((a) => a.raw) || [],
    );
    setComment(next.rule?.comment.replace(/^;\s?/, '') || '');
    setType(next.layer?.type || 'Proxy');
    setName(next.kind === 'layer' ? next.layer?.label || '' : '');
    setGuard(next.layer?.guard || '');
    setObjectKind(next.definition?.kind.toLowerCase() || 'condition');
    setObjectRows([]);
    setPasteList(false);
    setListType('url.domain');
    setListValues('');
  }
  function save() {
    if (!edit) return;
    try {
      if (value !== edit.base)
        throw new Error('The draft changed. Reopen this item.');
      let next = value;
      if (edit.kind === 'layer') {
        next = edit.layer
          ? updateLayer(value, edit.layer, type, name, guard)
          : addLayer(value, type, name);
        if (!edit.layer) setSelected(document.layers.length);
      } else if (edit.kind === 'rule') {
        if (!edit.layer) throw new Error('Choose a layer.');
        next = edit.rule
          ? updateRule(value, edit.rule, expressions, comment)
          : addRule(
              value,
              edit.layer,
              expressions.join(' ') +
                (comment ? ` ; ${comment}` : ''),
            );
      } else if (edit.kind === 'object') {
        next = pasteList
          ? addDefinition(
              value,
              'condition',
              name,
              listValues
                .split(/\r?\n/)
                .filter((v) => v.trim())
                .map((v) =>
                  makeExpression(capabilityFor(listType)!, v),
                ),
            )
          : addDefinition(value, objectKind, name, [
              ...objectRows,
              ...(expressions.length ? [expressions.join(' ')] : []),
            ]);
      } else if (edit.kind === 'objectRow' && edit.definition) {
        if (edit.rule)
          next = updateRule(value, edit.rule, expressions, comment);
        else {
          const text = expressions.join(' ');
          const p = parseAtoms(text);
          if (!p.complete || !p.atoms.length || p.comment)
            throw new Error('Add a valid object row.');
          if (
            edit.definition.kind.toLowerCase() === 'condition' &&
            p.atoms.some((a) => a.kind !== 'condition')
          )
            throw new Error(
              'Condition objects require condition expressions.',
            );
          next = patchCpl(
            value,
            edit.definition.bodyEnd,
            edit.definition.bodyEnd,
            `    ${text}\n`,
          );
        }
      } else if (edit.kind === 'delete' && edit.deleteRange)
        next = patchCpl(
          value,
          edit.deleteRange.start,
          edit.deleteRange.end,
          '',
        );
      change(next);
      setEdit(null);
    } catch (error) {
      toast.error(String(error));
    }
  }
  function deleteObject(definition: CplDefinition) {
    const rest =
      value.slice(0, definition.start) + value.slice(definition.end);
    if (rest.includes(definition.name.replace(/^"|"$/g, ''))) {
      toast.error(
        'This object name still occurs elsewhere in the policy. Review and remove its references before deleting it.',
      );
      return;
    }
    open({
      kind: 'delete',
      definition,
      title: `Delete object ${definition.name}`,
      deleteRange: definition,
    });
  }
  const protectedRules = useMemo(
    () =>
      document.layers.flatMap((l) =>
        l.rules.filter((r) => !r.editable && !r.disabled),
      ),
    [document],
  );
  const preservedBlocks = useMemo(
    () =>
      Array.from(
        new Map(
          [
            ...document.protected,
            ...document.layers
              .filter((l) => !parseAtoms(l.guard).complete)
              .map((l) => ({
                start: l.headerStart,
                end: l.headerEnd,
                line: l.line,
                reason: 'Compound or unsupported layer guard',
              })),
            ...document.definitions
              .filter(
                (d) =>
                  !['condition', 'action'].includes(
                    d.kind.toLowerCase(),
                  ) ||
                  definitionRows(value, d).some((r) => !r.editable),
              )
              .map((d) => ({
                start: d.start,
                end: d.end,
                line: d.line,
                reason: 'Definition with preserved body statements',
              })),
          ].map((range) => [range.start, range]),
        ).values(),
      ),
    [document, value],
  );
  return (
    <div className='min-w-0'>
      {(policyIndex.issues.length > 0 ||
        [...policyIndex.symbols.values()].some(
          (s) => s.issues.length,
        )) && (
        <div
          aria-live='polite'
          className='border-b bg-muted/30 p-3 text-xs'
        >
          {[
            ...policyIndex.issues,
            ...[...policyIndex.symbols.values()].flatMap(
              (s) => s.issues,
            ),
          ]
            .slice(0, 8)
            .map((message) => (
              <p key={message}>{message}</p>
            ))}
          Review object dependencies before applying. Unknown or
          external expressions are preserved.
        </div>
      )}
      <div className='flex flex-wrap items-center justify-between gap-3 border-b p-3'>
        <div className='flex items-center gap-2 text-xs text-muted-foreground'>
          <Layers3 className='size-4' />
          {document.layers.length} layers ·{' '}
          {document.layers.reduce((n, l) => n + l.rules.length, 0)}{' '}
          rules · {document.definitions.length} objects
        </div>
        <div className='flex flex-wrap gap-1'>
          <Button
            size='sm'
            variant='ghost'
            disabled={disabled || !undo.length}
            onClick={() => {
              const previous = undo.at(-1)!;
              setUndo(undo.slice(0, -1));
              setRedo([...redo, value]);
              last.current = previous;
              onChange(previous);
            }}
          >
            <Undo2 className='size-3.5' />
            Undo
          </Button>
          <Button
            size='sm'
            variant='ghost'
            disabled={disabled || !redo.length}
            onClick={() => {
              const next = redo.at(-1)!;
              setRedo(redo.slice(0, -1));
              setUndo([...undo, value]);
              last.current = next;
              onChange(next);
            }}
          >
            <Redo2 className='size-3.5' />
            Redo
          </Button>
          <Button
            size='sm'
            variant='outline'
            disabled={disabled}
            onClick={() => open({ kind: 'layer' })}
          >
            <Plus className='size-3.5' />
            Add layer
          </Button>
          <Button
            size='sm'
            variant='outline'
            disabled={disabled}
            onClick={() => open({ kind: 'object' })}
          >
            <Plus className='size-3.5' />
            Add object
          </Button>
        </div>
      </div>
      <div className='grid min-w-0 md:grid-cols-[14rem_minmax(0,1fr)]'>
        <aside className='min-w-0 border-b p-3 md:border-b-0 md:border-r'>
          <p className='mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground'>
            Evaluation order
          </p>
          <ScrollArea className='h-44 md:h-[32rem]'>
            <div className='space-y-1 pr-2'>
              {document.layers.map((item, index) => (
                <button
                  type='button'
                  key={`${item.start}-${index}`}
                  className={layerStyle({ active: item === layer })}
                  onClick={() => {
                    setSelected(index);
                    setQuery('');
                    setTab('rules');
                    viewport.current?.scrollTo({ top: 0 });
                  }}
                >
                  <span className='w-5 shrink-0 text-xs text-muted-foreground'>
                    {index + 1}
                  </span>
                  <span className='min-w-0 flex-1'>
                    <span className='block truncate text-xs font-medium'>
                      {item.label || item.type}
                    </span>
                    <span className='block truncate text-[10px] text-muted-foreground'>
                      {item.type} · {item.rules.length} rules
                    </span>
                  </span>
                </button>
              ))}
              {!document.layers.length && (
                <p className='py-4 text-xs text-muted-foreground'>
                  {disabled
                    ? 'Load a policy to inspect its structure.'
                    : 'No layers yet. Add a layer to start building policy.'}
                </p>
              )}
            </div>
          </ScrollArea>
        </aside>
        <div className='min-w-0'>
          <div className='flex flex-wrap items-center gap-1 border-b p-2'>
            <Button
              size='sm'
              variant={tab === 'rules' ? 'secondary' : 'ghost'}
              onClick={() => setTab('rules')}
            >
              Rules
            </Button>
            <Button
              size='sm'
              variant={tab === 'objects' ? 'secondary' : 'ghost'}
              onClick={() => setTab('objects')}
            >
              <Library className='size-3.5' />
              Objects ({document.definitions.length})
            </Button>
            <Button
              size='sm'
              variant={tab === 'preserved' ? 'secondary' : 'ghost'}
              onClick={() => setTab('preserved')}
            >
              Preserved source (
              {preservedBlocks.length + protectedRules.length})
            </Button>
          </div>
          {tab === 'rules' ? (
            <>
              <div className='flex flex-wrap items-center justify-between gap-2 border-b p-3'>
                <div className='min-w-0'>
                  <h4 className='truncate text-sm font-semibold'>
                    {layer?.label || layer?.type || 'Select a layer'}
                  </h4>
                  {layer?.guard && (
                    <p
                      className='max-w-lg truncate font-mono text-[11px] text-muted-foreground'
                      title={layer.guard}
                    >
                      Guard: {layer.guard}
                    </p>
                  )}
                </div>
                <div className='flex gap-1'>
                  <Button
                    size='icon'
                    variant='ghost'
                    aria-label='Move layer up'
                    disabled={
                      disabled ||
                      !layer ||
                      document.layers[0] === layer
                    }
                    onClick={() =>
                      perform(() =>
                        moveLayer(value, document, layer!, -1),
                      )
                    }
                  >
                    <ArrowUp className='size-3.5' />
                  </Button>
                  <Button
                    size='icon'
                    variant='ghost'
                    aria-label='Move layer down'
                    disabled={
                      disabled ||
                      !layer ||
                      document.layers.at(-1) === layer
                    }
                    onClick={() =>
                      perform(() =>
                        moveLayer(value, document, layer!, 1),
                      )
                    }
                  >
                    <ArrowDown className='size-3.5' />
                  </Button>
                  <Button
                    size='icon'
                    variant='ghost'
                    aria-label='Delete selected layer'
                    disabled={disabled || !layer}
                    onClick={() => {
                      if (!layer) return;
                      if (
                        document.definitions.some(
                          (d) =>
                            d.start >= layer.start &&
                            d.start < layer.end,
                        ) ||
                        document.protected.some(
                          (d) =>
                            d.start >= layer.start &&
                            d.start < layer.end,
                        )
                      ) {
                        toast.error(
                          'This layer contains definitions or preserved source. Review it in source mode before removing it.',
                        );
                        return;
                      }
                      open({
                        kind: 'delete',
                        layer,
                        title: `Delete layer ${layer.label || layer.type}`,
                        deleteRange: layer,
                      });
                    }}
                  >
                    <Trash2 className='size-3.5' />
                  </Button>
                  <Button
                    size='sm'
                    variant='ghost'
                    disabled={disabled || !layer}
                    onClick={() => open({ kind: 'layer', layer })}
                  >
                    <Settings2 className='size-3.5' />
                    Layer settings
                  </Button>
                  <Button
                    size='sm'
                    variant='outline'
                    disabled={disabled || !layer}
                    onClick={() => open({ kind: 'rule', layer })}
                  >
                    <Plus className='size-3.5' />
                    Add rule
                  </Button>
                </div>
              </div>
              <div className='border-b px-3 py-2'>
                <Input
                  id={`${id}-search`}
                  aria-label='Search policy rules'
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    viewport.current?.scrollTo({ top: 0 });
                  }}
                  placeholder='Search conditions, properties, objects or comments…'
                />
              </div>
              <section
                ref={viewport}
                className='h-[32rem] overflow-auto'
                aria-label='Policy rules'
              >
                <ol
                  className='relative w-full list-none m-0 p-0'
                  style={{ height: virtual.getTotalSize() }}
                >
                  {virtual.getVirtualItems().map((row) => {
                    const rule = rules[row.index];
                    return (
                      <li
                        key={row.key}
                        data-index={row.index}
                        ref={virtual.measureElement}
                        className='absolute left-0 top-0 w-full border-b p-3'
                        style={{
                          transform: `translateY(${row.start}px)`,
                        }}
                      >
                        <div className='flex min-w-0 items-start gap-3'>
                          <span className='w-10 shrink-0 pt-1 text-[10px] text-muted-foreground'>
                            L{rule.line}
                          </span>
                          <div className='min-w-0 flex-1 space-y-1'>
                            {rule.editable ? (
                              <div className='grid grid-cols-3 gap-2 xl:grid-cols-6'>
                                {POLICY_COLUMNS.map((column) => {
                                  const parts = rule.atoms.filter(
                                    (atom) =>
                                      columnFor(atom, policyIndex) ===
                                      column.id,
                                  );
                                  return (
                                    <button
                                      type='button'
                                      key={column.id}
                                      className='min-w-0 cursor-pointer rounded px-1 py-1 text-left text-xs hover:bg-muted'
                                      disabled={disabled}
                                      aria-label={`Edit ${column.label} at line ${rule.line}`}
                                      onClick={() =>
                                        open({
                                          kind: 'rule',
                                          layer,
                                          rule,
                                          column: column.id,
                                        })
                                      }
                                    >
                                      <span className='mb-1 block text-[10px] font-medium text-muted-foreground'>
                                        {column.label}
                                      </span>
                                      <span
                                        className='block truncate'
                                        title={parts
                                          .map(describeAtom)
                                          .join(' AND ')}
                                      >
                                        {parts
                                          .map(describeAtom)
                                          .join(' AND ') ||
                                          (column.id === 'action'
                                            ? '—'
                                            : column.id === 'advanced'
                                              ? '—'
                                              : 'Any')}
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            ) : (
                              <span className='text-xs text-orange-700 dark:text-orange-300'>
                                {rule.disabled
                                  ? 'Disabled rule · enable to edit'
                                  : 'Preserved CPL · use advanced source mode to edit'}
                              </span>
                            )}
                            {rule.comment && (
                              <p className='truncate text-xs text-muted-foreground'>
                                {rule.comment.replace(/^;\s?/, '')}
                              </p>
                            )}
                            <button
                              type='button'
                              disabled={disabled || !rule.editable}
                              onClick={() =>
                                open({ kind: 'rule', layer, rule })
                              }
                              aria-label={`Edit rule at line ${rule.line}`}
                              className='block w-full cursor-pointer truncate text-left font-mono text-[10px] text-muted-foreground disabled:cursor-default'
                            >
                              {rule.raw.trim()}
                            </button>
                          </div>
                          <div className='flex shrink-0 gap-0.5'>
                            <Button
                              size='icon'
                              variant='ghost'
                              aria-label={`Move rule at line ${rule.line} up`}
                              disabled={
                                disabled ||
                                !!query ||
                                !rule.editable ||
                                layer?.rules[0] === rule
                              }
                              onClick={() =>
                                perform(() =>
                                  moveRule(value, layer!, rule, -1),
                                )
                              }
                            >
                              <ArrowUp className='size-3.5' />
                            </Button>
                            <Button
                              size='icon'
                              variant='ghost'
                              aria-label={`Move rule at line ${rule.line} down`}
                              disabled={
                                disabled ||
                                !!query ||
                                !rule.editable ||
                                layer?.rules.at(-1) === rule
                              }
                              onClick={() =>
                                perform(() =>
                                  moveRule(value, layer!, rule, 1),
                                )
                              }
                            >
                              <ArrowDown className='size-3.5' />
                            </Button>
                            <Button
                              size='icon'
                              variant='ghost'
                              aria-label={`${rule.disabled ? 'Enable' : 'Disable'} rule at line ${rule.line}`}
                              disabled={
                                disabled ||
                                (!rule.editable && !rule.disabled)
                              }
                              onClick={() =>
                                perform(() => toggleRule(value, rule))
                              }
                            >
                              <Power className='size-3.5' />
                            </Button>
                            <Button
                              size='icon'
                              variant='ghost'
                              aria-label={`Duplicate rule at line ${rule.line}`}
                              disabled={disabled || !rule.editable}
                              onClick={() =>
                                perform(() =>
                                  patchCpl(
                                    value,
                                    rule.end,
                                    rule.end,
                                    (rule.raw.endsWith('\n')
                                      ? ''
                                      : '\n') + rule.raw,
                                  ),
                                )
                              }
                            >
                              <Copy className='size-3.5' />
                            </Button>
                            <Button
                              size='icon'
                              variant='ghost'
                              aria-label={`Delete rule at line ${rule.line}`}
                              disabled={disabled || !rule.editable}
                              onClick={() =>
                                open({
                                  kind: 'delete',
                                  rule,
                                  title: `Delete rule at line ${rule.line}`,
                                  deleteRange: rule,
                                })
                              }
                            >
                              <Trash2 className='size-3.5' />
                            </Button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
                {!rules.length && (
                  <p className='p-6 text-sm text-muted-foreground'>
                    {query
                      ? 'No matching rules.'
                      : 'This layer has no rules yet.'}
                  </p>
                )}
              </section>
            </>
          ) : tab === 'objects' ? (
            <CplObjectLibrary
              source={value}
              definitions={document.definitions}
              disabled={disabled}
              index={policyIndex}
              onBulk={setBulkObject}
              onReveal={(line) => {
                const layerIndex = document.layers.findIndex((l) =>
                  l.rules.some((r) => r.line === line),
                );
                if (layerIndex >= 0) {
                  setSelected(layerIndex);
                  setTab('rules');
                  setQuery(`line:${line}`);
                } else {
                  const owner = [
                    ...policyIndex.symbols.values(),
                  ].find((s) => s.rows.some((r) => r.line === line));
                  if (owner) setBulkObject(owner.definition);
                }
              }}
              onEdit={(definition, rule) =>
                open({ kind: 'objectRow', definition, rule })
              }
              onDelete={deleteObject}
            />
          ) : (
            <ScrollArea className='h-[38rem]'>
              <div className='space-y-3 p-4'>
                <p className='text-xs text-muted-foreground'>
                  These ranges are retained exactly and are never
                  converted into approximate visual rules. Use the
                  optional source editor for changes.
                </p>
                {preservedBlocks.map((range) => (
                  <div
                    key={range.start}
                    className='rounded-lg border p-3'
                  >
                    <p className='text-xs font-medium'>
                      Line {range.line} · {range.reason}
                    </p>
                    <pre className='mt-2 max-h-40 overflow-auto whitespace-pre font-mono text-[11px]'>
                      {value.slice(range.start, range.end)}
                    </pre>
                  </div>
                ))}
                {protectedRules.map((rule) => (
                  <div
                    key={rule.start}
                    className='rounded-lg border p-3'
                  >
                    <p className='text-xs font-medium'>
                      Line {rule.line} · compound or unsupported rule
                    </p>
                    <pre className='mt-2 max-h-40 overflow-auto text-[11px]'>
                      {rule.raw}
                    </pre>
                  </div>
                ))}
                {!preservedBlocks.length &&
                  !protectedRules.length && (
                    <p className='text-xs text-muted-foreground'>
                      All rule expressions in this draft can be
                      represented by the visual editor. This is not a
                      compiler validation.
                    </p>
                  )}
              </div>
            </ScrollArea>
          )}
        </div>
      </div>
      <p className='border-t px-4 py-2 text-[11px] text-muted-foreground'>
        Imported gestures are available alongside documented
        suggestions; this is not a complete SGOS-version capability
        catalogue.{' '}
        <a
          className='underline'
          href={CPL_REFERENCE}
          target='_blank'
          rel='noreferrer'
        >
          CPL reference
        </a>{' '}
        · SGOS validates the final policy. Layer and rule order is
        retained unless you explicitly change it.
      </p>
      {bulkObject && (
        <CplObjectEditor
          source={value}
          definition={bulkObject}
          index={policyIndex}
          disabled={disabled}
          onClose={() => setBulkObject(null)}
          onChange={(next) => {
            change(next);
            setBulkObject(null);
          }}
        />
      )}
      <Dialog
        open={!!edit}
        onOpenChange={(open) => {
          if (!open) setEdit(null);
        }}
      >
        <DialogContent className='flex h-[min(90dvh,56rem)] flex-col overflow-hidden sm:max-w-5xl'>
          <DialogHeader className='pr-9'>
            <DialogTitle>
              {edit?.kind === 'delete'
                ? edit.title
                : edit?.kind === 'layer'
                  ? edit.layer
                    ? 'Edit layer'
                    : 'Add layer'
                  : edit?.kind === 'object'
                    ? 'Create reusable object'
                    : edit?.kind === 'objectRow'
                      ? `Edit ${edit.definition?.name}`
                      : edit?.rule
                        ? `Edit rule · line ${edit.rule.line}`
                        : 'Create rule'}
            </DialogTitle>
            <DialogDescription>
              {edit?.kind === 'delete'
                ? 'The selected source range will be removed from this draft. Review the full distribution diff before applying.'
                : 'Changes update this draft only. Unrelated source bytes, comments and rule order are preserved.'}
            </DialogDescription>
          </DialogHeader>
          <DialogClose asChild>
            <Button
              size='icon'
              variant='ghost'
              className='absolute right-3 top-3'
              aria-label='Close visual editor dialog'
            >
              <X className='size-4' />
            </Button>
          </DialogClose>
          <ScrollArea className='min-h-0 flex-1'>
            <div className='space-y-4 pr-3'>
              {edit?.kind === 'layer' ? (
                <>
                  <label
                    className='block space-y-1 text-xs'
                    htmlFor={`${id}-type`}
                  >
                    Layer type
                    <SelectField
                      id={`${id}-type`}
                      value={type}
                      onValueChange={setType}
                    >
                      {Array.from(
                        new Map(
                          [
                            ...CPL_LAYERS,
                            ...document.layers.map((l) => ({
                              name: l.type,
                              label: 'Imported layer type',
                            })),
                          ].map((l) => [l.name, l]),
                        ).values(),
                      ).map((l) => (
                        <SelectOption key={l.name} value={l.name}>
                          {l.name} · {l.label}
                        </SelectOption>
                      ))}
                    </SelectField>
                  </label>
                  <Input
                    id={`${id}-label`}
                    label='Layer identifier (letters, digits, underscore or hyphen)'
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                  {edit.layer && (
                    <>
                      {parseAtoms(edit.layer.guard).complete ? (
                        <CplRuleBuilder
                          index={policyIndex}
                          initialColumn='advanced'
                          expressions={expressions}
                          onChange={(next) => {
                            setExpressions(next);
                            const suffix = parseAtoms(
                              edit.layer!.guard,
                            ).comment;
                            setGuard(
                              next.join(' ') +
                                (suffix ? ` ${suffix}` : ''),
                            );
                          }}
                          imported={imported}
                        />
                      ) : (
                        <p className='rounded border bg-muted/20 p-3 font-mono text-xs'>
                          Preserved layer guard: {edit.layer.guard}.
                          Edit this guard in advanced source mode.
                        </p>
                      )}
                      <p className='text-xs text-muted-foreground'>
                        Header match conditions and default properties
                        apply to the whole layer. Existing header
                        attributes are retained.
                      </p>
                    </>
                  )}
                </>
              ) : edit?.kind === 'delete' ? (
                <pre className='max-h-64 overflow-auto rounded-lg bg-muted/20 p-3 font-mono text-xs'>
                  {edit.deleteRange &&
                    value.slice(
                      edit.deleteRange.start,
                      edit.deleteRange.end,
                    )}
                </pre>
              ) : (
                <>
                  {edit?.kind === 'object' &&
                    objectKind === 'condition' && (
                      <div className='space-y-3'>
                        <label className='flex items-center gap-2 text-xs'>
                          <input
                            type='checkbox'
                            checked={pasteList}
                            disabled={
                              !!expressions.length ||
                              !!objectRows.length
                            }
                            onChange={(e) =>
                              setPasteList(e.target.checked)
                            }
                          />
                          Paste a list of values (one alternative per
                          line)
                        </label>
                        {pasteList && (
                          <>
                            <label
                              className='block space-y-1 text-xs'
                              htmlFor={`${id}-list-type`}
                            >
                              Entry type
                              <SelectField
                                id={`${id}-list-type`}
                                value={listType}
                                onValueChange={setListType}
                              >
                                {POLICY_CAPABILITIES.filter(
                                  (c) => c.form === 'equals',
                                ).map((c) => (
                                  <SelectOption
                                    key={c.name}
                                    value={c.name}
                                  >
                                    {c.label}
                                  </SelectOption>
                                ))}
                              </SelectField>
                            </label>
                            <label
                              className='block space-y-1 text-xs'
                              htmlFor={`${id}-list-values`}
                            >
                              Values
                              <textarea
                                id={`${id}-list-values`}
                                className='h-48 w-full rounded border p-3 font-mono text-xs'
                                value={listValues}
                                onChange={(e) =>
                                  setListValues(e.target.value)
                                }
                                placeholder='example.com&#10;second.example.com'
                              />
                            </label>
                          </>
                        )}
                      </div>
                    )}
                  {edit?.kind === 'object' && (
                    <>
                      <div className='grid gap-3 sm:grid-cols-2'>
                        <Input
                          id={`${id}-object-name`}
                          label='Object name'
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                        />
                        <label
                          htmlFor={`${id}-object-kind`}
                          className='space-y-1 text-xs'
                        >
                          Object type
                          <SelectField
                            id={`${id}-object-kind`}
                            value={objectKind}
                            onValueChange={(next) => {
                              if (
                                objectRows.length ||
                                expressions.length ||
                                pasteList
                              ) {
                                toast.error(
                                  'Clear the current object rows before changing its type.',
                                );
                                return;
                              }
                              setObjectKind(next);
                            }}
                          >
                            <SelectOption value='condition'>
                              Condition · alternative rows
                            </SelectOption>
                            <SelectOption value='action'>
                              Action · ordered operations
                            </SelectOption>
                          </SelectField>
                        </label>
                      </div>
                      {objectRows.map((row, index) => (
                        <div
                          key={`${index}-${row}`}
                          className='flex items-center gap-2 rounded border p-2'
                        >
                          <code className='min-w-0 flex-1 truncate text-xs'>
                            {row}
                          </code>
                          <Button
                            size='sm'
                            variant='ghost'
                            onClick={() =>
                              setObjectRows(
                                objectRows.filter(
                                  (_, i) => i !== index,
                                ),
                              )
                            }
                          >
                            Remove row
                          </Button>
                        </div>
                      ))}
                    </>
                  )}
                  {!pasteList &&
                    (edit?.kind === 'rule' ||
                    ((edit?.kind === 'object' ||
                      edit?.kind === 'objectRow') &&
                      objectKind === 'condition') ? (
                      <CplRuleBuilder
                        key={`${edit?.kind}-${edit?.rule?.start}`}
                        expressions={expressions}
                        onChange={setExpressions}
                        index={policyIndex}
                        imported={imported}
                        initialColumn={edit?.column}
                        conditionOnly={edit?.kind !== 'rule'}
                      />
                    ) : (
                      <CplRuleComposer
                        key={`${edit?.kind}-${objectKind}-${edit?.rule?.start}`}
                        expressions={expressions}
                        onChange={setExpressions}
                        imported={imported}
                        objects={document.definitions}
                        scope={
                          edit?.kind === 'object' ||
                          edit?.kind === 'objectRow'
                            ? objectKind === 'condition'
                              ? 'condition'
                              : 'action'
                            : 'rule'
                        }
                      />
                    ))}
                  {edit?.kind === 'object' && !pasteList && (
                    <Button
                      size='sm'
                      variant='outline'
                      disabled={!expressions.length}
                      onClick={() => {
                        setObjectRows([
                          ...objectRows,
                          expressions.join(' '),
                        ]);
                        setExpressions([]);
                      }}
                    >
                      Add{' '}
                      {objectKind === 'condition'
                        ? 'alternative'
                        : 'action'}{' '}
                      row
                    </Button>
                  )}
                  {edit?.kind === 'rule' && (
                    <Input
                      id={`${id}-comment`}
                      label='Rule comment'
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                    />
                  )}
                  {edit?.kind === 'objectRow' && edit.rule && (
                    <Input
                      id={`${id}-row-comment`}
                      label='Row comment'
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                    />
                  )}
                </>
              )}
            </div>
          </ScrollArea>
          <DialogFooter className='border-t pt-3'>
            <DialogClose asChild>
              <Button variant='outline'>Cancel</Button>
            </DialogClose>
            <Button
              disabled={disabled}
              variant={
                edit?.kind === 'delete' ? 'destructive' : 'default'
              }
              onClick={save}
            >
              {edit?.kind === 'delete'
                ? 'Delete from draft'
                : 'Save to draft'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
