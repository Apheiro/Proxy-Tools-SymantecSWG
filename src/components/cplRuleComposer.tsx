'use client';
import { useId, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SelectField, SelectOption } from '@/components/ui/select';
import { CPL_GESTURES, type CplGesture } from '@/lib/cplCatalog';
import {
  atomText,
  parseAtoms,
  type CplAtom,
  type CplAtomKind,
} from '@/lib/cplDocument';
import { toast } from 'sonner';
export default function CplRuleComposer({
  expressions,
  onChange,
  imported = [],
  scope = 'rule',
  objects = [],
}: {
  expressions: string[];
  onChange: (value: string[]) => void;
  imported?: CplGesture[];
  scope?: 'rule' | 'condition' | 'action';
  objects?: { name: string; kind: string }[];
}) {
  const id = useId();
  const [kind, setKind] = useState<CplAtomKind>(
    scope === 'action' ? 'property' : 'condition',
  );
  const [gesture, setGesture] = useState(
    scope === 'action' ? '__custom' : 'client.address',
  );
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [form, setForm] = useState<CplAtom['form']>(
    scope === 'action' ? 'call' : 'equals',
  );
  const [editing, setEditing] = useState<number | null>(null);
  const gestures = useMemo(
    () =>
      Array.from(
        new Map(
          [...CPL_GESTURES, ...imported].map((g) => [
            `${g.kind}:${g.name}`,
            g,
          ]),
        ).values(),
      ).filter((g) => g.kind === kind),
    [imported, kind],
  );
  const current = gestures.find((g) => g.name === gesture);
  const custom = gesture === '__custom';
  function select(next: string) {
    setGesture(next);
    const item = gestures.find((g) => g.name === next);
    if (item) {
      setName(item.name);
      setForm(item.form);
      setValue(
        item.form === 'bare'
          ? ''
          : item.name.startsWith('action.')
            ? 'yes'
            : '',
      );
    }
  }
  function add() {
    try {
      const next = atomText(
        custom ? name : current?.name || gesture,
        value,
        custom ? form : current?.form || form,
      );
      if (
        scope === 'condition' &&
        parseAtoms(next).atoms[0]?.kind !== 'condition'
      )
        throw new Error(
          'Condition objects contain condition expressions.',
        );
      const result = [...expressions];
      if (editing === null) result.push(next);
      else result[editing] = next;
      if (
        result.filter((s) => /^(allow|deny|force_deny)$/i.test(s))
          .length > 1
      )
        throw new Error('Choose one decision per rule.');
      onChange(result);
      setEditing(null);
      setValue('');
    } catch (e) {
      toast.error(String(e));
    }
  }
  function edit(index: number) {
    const atom = parseAtoms(expressions[index]).atoms[0];
    if (!atom) return;
    setEditing(index);
    setKind(atom.kind);
    setGesture('__custom');
    setName(atom.name);
    setValue(atom.value);
    setForm(atom.form);
  }
  return (
    <div className='space-y-4'>
      <div className='space-y-2'>
        {expressions.map((expression, index) => (
          <div
            key={`${index}-${expression}`}
            className='flex items-center gap-1 rounded-lg border bg-muted/20 p-2'
          >
            <span className='w-7 shrink-0 text-center text-[10px] text-muted-foreground'>
              {index + 1}
            </span>
            <button
              type='button'
              className='min-w-0 flex-1 cursor-pointer truncate text-left font-mono text-xs hover:underline'
              onClick={() => edit(index)}
              title={expression}
            >
              {expression}
            </button>
            <Button
              type='button'
              size='icon'
              variant='ghost'
              aria-label={`Move expression ${index + 1} up`}
              disabled={!index}
              onClick={() => {
                const next = [...expressions];
                [next[index - 1], next[index]] = [
                  next[index],
                  next[index - 1],
                ];
                onChange(next);
              }}
            >
              <ArrowUp className='size-3.5' />
            </Button>
            <Button
              type='button'
              size='icon'
              variant='ghost'
              aria-label={`Move expression ${index + 1} down`}
              disabled={index === expressions.length - 1}
              onClick={() => {
                const next = [...expressions];
                [next[index + 1], next[index]] = [
                  next[index],
                  next[index + 1],
                ];
                onChange(next);
              }}
            >
              <ArrowDown className='size-3.5' />
            </Button>
            <Button
              type='button'
              size='icon'
              variant='ghost'
              aria-label={`Remove expression ${index + 1}`}
              onClick={() => {
                onChange(expressions.filter((_, i) => i !== index));
                setEditing(null);
              }}
            >
              <Trash2 className='size-3.5' />
            </Button>
          </div>
        ))}
      </div>
      <fieldset className='space-y-3 rounded-lg border p-3'>
        <legend className='px-1 text-xs font-medium'>
          {editing === null
            ? 'Add an expression'
            : `Edit expression ${editing + 1}`}
        </legend>
        <div className='grid gap-3 sm:grid-cols-[10rem_1fr]'>
          <div>
            <label htmlFor={`${id}-kind`} className='text-xs'>
              Expression type
            </label>
            <SelectField
              id={`${id}-kind`}
              value={kind}
              onValueChange={(v) => {
                setKind(v as CplAtomKind);
                setGesture('__custom');
                setForm(v === 'condition' ? 'equals' : 'call');
                setName('');
                setValue('');
              }}
              disabled={scope === 'condition'}
            >
              <SelectOption value='condition'>
                Condition (match)
              </SelectOption>
              <SelectOption value='property'>
                Property / decision
              </SelectOption>
              <SelectOption value='action'>
                Action reference / call
              </SelectOption>
            </SelectField>
          </div>
          <div>
            <label htmlFor={`${id}-gesture`} className='text-xs'>
              Condition, property or action
            </label>
            <SelectField
              id={`${id}-gesture`}
              value={gesture}
              onValueChange={select}
            >
              {gestures.map((g) => (
                <SelectOption key={g.name} value={g.name}>
                  {g.family} · {g.name}
                </SelectOption>
              ))}
              <SelectOption value='__custom'>
                Other CPL gesture…
              </SelectOption>
            </SelectField>
          </div>
        </div>
        {custom && (
          <div className='grid gap-3 sm:grid-cols-[1fr_10rem]'>
            <Input
              label='CPL gesture name'
              id={`${id}-name`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={
                kind === 'condition'
                  ? 'url.domain'
                  : 'action.ObjectName'
              }
            />
            <div>
              <label htmlFor={`${id}-form`} className='text-xs'>
                Syntax
              </label>
              <SelectField
                id={`${id}-form`}
                value={form}
                onValueChange={(v) => setForm(v as CplAtom['form'])}
              >
                <SelectOption value='equals'>name=value</SelectOption>
                <SelectOption value='call'>
                  name(arguments)
                </SelectOption>
                <SelectOption value='bare'>Decision</SelectOption>
              </SelectField>
            </div>
          </div>
        )}
        {(current?.name === 'condition' ||
          (custom && name === 'condition')) &&
          objects.some(
            (o) => o.kind.toLowerCase() === 'condition',
          ) && (
            <label
              className='block space-y-1 text-xs'
              htmlFor={`${id}-object`}
            >
              Condition object
              <SelectField
                id={`${id}-object`}
                value={
                  objects.some((o) => o.name === value) ? value : ''
                }
                onValueChange={setValue}
                placeholder='Choose a reusable condition'
              >
                {objects
                  .filter((o) => o.kind.toLowerCase() === 'condition')
                  .map((o) => (
                    <SelectOption key={o.name} value={o.name}>
                      {o.name}
                    </SelectOption>
                  ))}
              </SelectField>
            </label>
          )}
        {(custom ? form : current?.form) !== 'bare' && (
          <Input
            label={
              kind === 'condition'
                ? 'Value / match expression'
                : 'Arguments'
            }
            id={`${id}-value`}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={
              current?.hint ||
              'CPL parameters, including quotes where required'
            }
          />
        )}
        <p className='text-xs text-muted-foreground'>
          {current?.hint ||
            'Imported gestures and other version-specific CPL names are supported without changing unrelated expressions.'}{' '}
          Parameters use CPL syntax. The appliance compiler validates
          availability and argument types.
        </p>
        <div className='flex justify-end gap-2'>
          {editing !== null && (
            <Button
              type='button'
              size='sm'
              variant='ghost'
              onClick={() => setEditing(null)}
            >
              Cancel expression edit
            </Button>
          )}
          <Button
            type='button'
            size='sm'
            variant='outline'
            onClick={add}
          >
            <Plus className='size-3.5' />
            {editing === null ? 'Add expression' : 'Apply expression'}
          </Button>
        </div>
      </fieldset>
      <p className='text-xs text-muted-foreground'>
        {scope === 'condition'
          ? 'Expressions on this row are AND. Separate rows in a condition object are alternatives (OR).'
          : 'Conditions on the same rule are AND. Reference a condition object for reusable alternatives. Properties retain their explicit order.'}
      </p>
    </div>
  );
}
