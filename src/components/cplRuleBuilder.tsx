'use client';
import { useId, useMemo, useState } from 'react';
import { toast } from 'sonner';
import CplConditionInspector from '@/components/cplConditionInspector';
import CplRuleComposer from '@/components/cplRuleComposer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SelectField, SelectOption } from '@/components/ui/select';
import {
  capabilityFor,
  makeExpression,
  POLICY_CAPABILITIES,
  POLICY_COLUMNS,
  type PolicyColumn,
} from '@/lib/cplCapabilities';
import type { CplGesture } from '@/lib/cplCatalog';
import { atomText, parseAtoms } from '@/lib/cplDocument';
import {
  columnFor,
  describeAtom,
  type PolicyIndex,
} from '@/lib/cplSemantics';
export default function CplRuleBuilder({
  expressions,
  onChange,
  index,
  initialColumn = 'source',
  imported = [],
  conditionOnly = false,
}: {
  expressions: string[];
  onChange: (expressions: string[]) => void;
  index: PolicyIndex;
  initialColumn?: PolicyColumn;
  imported?: CplGesture[];
  conditionOnly?: boolean;
}) {
  const id = useId();
  const [column, setColumn] = useState<PolicyColumn>(initialColumn);
  const [capability, setCapability] = useState('');
  const [value, setValue] = useState('');
  const [negated, setNegated] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const atoms = expressions.map(
    (expression) => parseAtoms(expression).atoms[0],
  );
  const options = POLICY_CAPABILITIES.filter(
    (c) =>
      c.column === column && (!conditionOnly || c.form === 'equals'),
  );
  const current = capabilityFor(capability || options[0]?.name || '');
  const symbols = useMemo(
    () =>
      [...index.symbols.entries()].filter(
        ([, s]) => s.definition.kind.toLowerCase() === 'condition',
      ),
    [index],
  );
  function reset(next: PolicyColumn) {
    setColumn(next);
    setCapability('');
    setValue('');
    setNegated(false);
    setEditing(null);
  }
  function add() {
    try {
      let expression: string;
      if (capability === '__action') {
        const symbol = index.symbols.get(value);
        if (symbol?.definition.kind.toLowerCase() !== 'action')
          throw new Error('Choose an action object.');
        expression = atomText(`action.${value}`, 'yes', 'call');
      } else if (
        capability === '__object' ||
        (!capability && !options.length)
      ) {
        if (!index.symbols.has(value))
          throw new Error('Choose an existing condition object.');
        expression = `condition=${negated ? '!' : ''}${/\s/.test(value) ? `"${value}"` : value}`;
      } else {
        if (!current)
          throw new Error(
            'Choose a supported object type or use advanced expressions.',
          );
        expression = makeExpression(current, value, negated);
      }
      const next = [...expressions];
      if (editing === null) next.push(expression);
      else next[editing] = expression;
      if (
        next.filter((e) => /^(allow|deny|force_deny)$/i.test(e))
          .length > 1
      )
        throw new Error('Choose one access decision per rule.');
      onChange(next);
      setEditing(null);
      setValue('');
      setNegated(false);
    } catch (e) {
      toast.error(String(e));
    }
  }
  return (
    <div className='space-y-4'>
      <p className='text-xs text-muted-foreground'>
        Select a column, choose an object type and enter its value.
        Conditions on this rule are ALL required. Compound objects
        keep their original grouping.
      </p>
      <div className='grid gap-2 sm:grid-cols-3'>
        {POLICY_COLUMNS.filter(
          (c) => !conditionOnly || c.id !== 'action',
        ).map((c) => (
          <button
            key={c.id}
            type='button'
            aria-label={`${c.label} criteria`}
            aria-pressed={column === c.id}
            onClick={() => reset(c.id)}
            className={`min-w-0 cursor-pointer rounded-lg border p-3 text-left text-xs ${column === c.id ? 'border-primary bg-primary/5' : 'hover:bg-muted'}`}
          >
            <span className='font-semibold'>{c.label}</span>
            <span className='mt-1 block truncate text-muted-foreground'>
              {atoms
                .flatMap((a, i) =>
                  a && columnFor(a, index) === c.id
                    ? [describeAtom(a)]
                    : [],
                )
                .join(' AND ') ||
                (c.id === 'action'
                  ? 'No explicit action'
                  : 'Any / no additional condition')}
            </span>
          </button>
        ))}
      </div>
      <div className='space-y-2 rounded-lg border p-3'>
        <h4 className='text-sm font-semibold'>
          {POLICY_COLUMNS.find((c) => c.id === column)?.label}
        </h4>
        {atoms.map(
          (atom, position) =>
            atom &&
            columnFor(atom, index) === column && (
              <div
                key={`${position}-${expressions[position]}`}
                className='flex items-start gap-2 rounded bg-muted/30 p-2 text-xs'
              >
                <button
                  type='button'
                  className='min-w-0 flex-1 cursor-pointer text-left'
                  onClick={() => {
                    if (
                      !capabilityFor(atom.name) &&
                      atom.name !== 'condition'
                    ) {
                      setAdvanced(true);
                      return;
                    }
                    setEditing(position);
                    setCapability(
                      atom.name === 'condition'
                        ? '__object'
                        : capabilityFor(atom.name)!.name,
                    );
                    setValue(
                      atom.name === 'condition'
                        ? atom.value
                            .replace(/^!/, '')
                            .replace(/^["']|["']$/g, '')
                        : atom.value,
                    );
                    setNegated(
                      atom.operator === '!=' ||
                        (atom.name === 'condition' &&
                          atom.value.startsWith('!')),
                    );
                  }}
                >
                  <span className='block font-medium'>
                    {describeAtom(atom)}
                  </span>
                  <code className='block break-all text-[10px] text-muted-foreground'>
                    {atom.raw}
                  </code>
                </button>
                <Button
                  size='sm'
                  variant='ghost'
                  aria-label={`Remove criterion ${position + 1}`}
                  onClick={() => {
                    onChange(
                      expressions.filter((_, i) => i !== position),
                    );
                    setEditing(null);
                  }}
                >
                  Remove
                </Button>
              </div>
            ),
        )}
        <label
          className='block space-y-1 text-xs'
          htmlFor={`${id}-type`}
        >
          Object type
          <SelectField
            id={`${id}-type`}
            value={capability || options[0]?.name || '__object'}
            onValueChange={(v) => {
              setCapability(v);
              setValue('');
              setNegated(false);
            }}
          >
            {options.map((c) => (
              <SelectOption key={c.name} value={c.name}>
                {c.label}
              </SelectOption>
            ))}
            {column === 'action' && (
              <SelectOption value='__action'>
                Existing action object
              </SelectOption>
            )}
            <SelectOption value='__object'>
              Existing condition object
            </SelectOption>
          </SelectField>
        </label>
        {capability === '__action' ? (
          <label
            className='block space-y-1 text-xs'
            htmlFor={`${id}-action`}
          >
            Reusable action
            <SelectField
              id={`${id}-action`}
              value={value}
              onValueChange={setValue}
              placeholder='Select an action object'
            >
              {[...index.symbols.entries()]
                .filter(
                  ([, s]) =>
                    s.definition.kind.toLowerCase() === 'action',
                )
                .map(([name]) => (
                  <SelectOption key={name} value={name}>
                    {name}
                  </SelectOption>
                ))}
            </SelectField>
          </label>
        ) : capability === '__object' ||
          (!options.length && !capability) ? (
          <label
            className='block space-y-1 text-xs'
            htmlFor={`${id}-object`}
          >
            Reusable object
            <SelectField
              id={`${id}-object`}
              value={value}
              onValueChange={setValue}
              placeholder='Select a named condition'
            >
              {symbols.map(([name, symbol]) => (
                <SelectOption key={name} value={name}>
                  {name} · {symbol.rows.length} alternatives
                  {symbol.columns.size > 1 ? ' · compound' : ''}
                </SelectOption>
              ))}
            </SelectField>
          </label>
        ) : (
          current?.form !== 'bare' && (
            <div>
              <Input
                id={`${id}-value`}
                label={current?.label || 'Value'}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                autoComplete='off'
                placeholder={
                  current?.input === 'ip'
                    ? '192.0.2.0/24 or 2001:db8::/32'
                    : current?.choices?.join(' / ')
                }
              />
              {!!current?.choices?.length && (
                <div className='mt-2 flex flex-wrap gap-1'>
                  {current.choices.map((choice) => (
                    <Button
                      key={choice}
                      size='sm'
                      variant='outline'
                      onClick={() => setValue(choice)}
                    >
                      {choice}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          )
        )}
        {(capability === '__object' ||
          current?.form === 'equals') && (
          <label className='flex items-center gap-2 text-xs'>
            <input
              type='checkbox'
              checked={negated}
              onChange={(e) => setNegated(e.target.checked)}
            />
            Negate this condition (NOT)
          </label>
        )}
        <div className='flex justify-end gap-2'>
          {editing !== null && (
            <Button
              size='sm'
              variant='ghost'
              onClick={() => {
                setEditing(null);
                setValue('');
              }}
            >
              Cancel criterion edit
            </Button>
          )}
          <Button size='sm' variant='outline' onClick={add}>
            {editing === null ? 'Add criterion' : 'Update criterion'}
          </Button>
        </div>
      </div>
      {capability === '__object' && index.symbols.has(value) && (
        <CplConditionInspector
          key={value}
          name={value}
          index={index}
        />
      )}
      <details
        open={advanced}
        onToggle={(e) => setAdvanced(e.currentTarget.open)}
      >
        <summary className='cursor-pointer text-xs font-medium'>
          Advanced CPL expressions
        </summary>
        <div className='mt-3'>
          <CplRuleComposer
            expressions={expressions}
            onChange={onChange}
            objects={[...index.symbols.values()].map(
              (s) => s.definition,
            )}
            imported={imported}
            scope={conditionOnly ? 'condition' : 'rule'}
          />
        </div>
      </details>
      <div className='rounded-lg border bg-muted/20 p-3'>
        <p className='mb-2 text-[10px] font-semibold uppercase text-muted-foreground'>
          Resulting CPL · expression order is retained
        </p>
        <code className='break-all text-xs'>
          {expressions.join(' ') || 'No criteria or action yet'}
        </code>
      </div>
    </div>
  );
}
