'use client';
import { useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { SelectField, SelectOption } from '@/components/ui/select';
import {
  capabilityFor,
  makeExpression,
  POLICY_CAPABILITIES,
} from '@/lib/cplCapabilities';
import {
  type CplDefinition,
  definitionRows,
} from '@/lib/cplDocument';
import {
  clonePolicyObject,
  type PolicyIndex,
  renamePolicyObject,
  replaceObjectRows,
} from '@/lib/cplSemantics';
export default function CplObjectEditor({
  source,
  definition,
  index,
  disabled,
  onChange,
  onClose,
}: {
  source: string;
  definition: CplDefinition;
  index: PolicyIndex;
  disabled: boolean;
  onChange: (next: string) => void;
  onClose: () => void;
}) {
  const base = useRef(source);
  const rows = useRef(definitionRows(source, definition)).current;
  const common =
    rows.length &&
    rows.every(
      (r) =>
        r.atoms.length === 1 &&
        r.atoms[0].name === rows[0].atoms[0].name &&
        r.atoms[0].operator !== '!=',
    )
      ? capabilityFor(rows[0].atoms[0].name)
      : null;
  const [newName, setNewName] = useState(
    definition.name.replace(/^"|"$/g, ''),
  );
  const [operation, setOperation] = useState<
    'edit' | 'rename' | 'clone'
  >('edit');
  const [type, setType] = useState(
    common?.form === 'equals' ? common.name : '__rows',
  );
  const [text, setText] = useState(
    common?.form === 'equals'
      ? rows.map((r) => r.atoms[0].value).join('\n')
      : rows
          .map((r) => r.atoms.map((a) => a.raw).join(' '))
          .join('\n'),
  );
  const [changed, setChanged] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const id = useId();
  const symbol = index.symbols.get(
    definition.name.replace(/^"|"$/g, ''),
  );
  const uses = symbol?.uses.length || 0;
  function save() {
    try {
      if (source !== base.current)
        throw new Error('The draft changed. Reopen this object.');
      if (operation !== 'edit') {
        onChange(
          operation === 'rename'
            ? renamePolicyObject(source, definition, newName)
            : clonePolicyObject(source, definition, newName),
        );
        return;
      }
      if (!changed) {
        onClose();
        return;
      }
      const cap = capabilityFor(type);
      const desired = text
        .split(/\r?\n/)
        .filter((v) => v.trim())
        .map((v) => (cap ? makeExpression(cap, v) : v.trim()));
      onChange(replaceObjectRows(source, definition, desired));
    } catch (e) {
      toast.error(String(e));
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className='flex h-[85dvh] flex-col sm:max-w-4xl'>
        <DialogHeader>
          <DialogTitle>Edit object · {definition.name}</DialogTitle>
          <DialogDescription>
            {rows.length} rows · {uses} direct references. Each row is
            an alternative (OR); expressions within one row are ALL
            required. Existing comments and definition delimiters are
            preserved.
          </DialogDescription>
        </DialogHeader>
        <div className='flex flex-wrap items-end gap-2'>
          <label
            className='space-y-1 text-xs'
            htmlFor={`${id}-operation`}
          >
            Operation
            <SelectField
              id={`${id}-operation`}
              value={operation}
              onValueChange={(v) =>
                setOperation(v as typeof operation)
              }
            >
              <SelectOption value='edit'>
                Edit shared entries
              </SelectOption>
              <SelectOption value='rename'>
                Rename and update active references
              </SelectOption>
              <SelectOption value='clone'>
                Duplicate as independent object
              </SelectOption>
            </SelectField>
          </label>
          {operation !== 'edit' && (
            <Input
              id={`${id}-name`}
              label='New object name'
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          )}
        </div>
        {!!symbol?.issues.length && (
          <p className='text-xs text-orange-700 dark:text-orange-300'>
            {symbol.issues.join(' ')}
          </p>
        )}
        <label htmlFor={`${id}-type`} className='space-y-1 text-xs'>
          List format
          <SelectField
            id={`${id}-type`}
            value={type}
            onValueChange={(v) => {
              if (changed) {
                toast.error(
                  'Close and reopen before changing the list format of an edited draft.',
                );
                return;
              }
              setType(v);
              const cap = capabilityFor(v);
              if (!cap)
                setText(
                  rows
                    .map((r) => r.atoms.map((a) => a.raw).join(' '))
                    .join('\n'),
                );
              else if (
                rows.every(
                  (r) =>
                    r.atoms.length === 1 &&
                    r.atoms[0].name === cap.name &&
                    r.atoms[0].operator !== '!=',
                )
              )
                setText(rows.map((r) => r.atoms[0].value).join('\n'));
              else {
                setType('__rows');
                toast.error(
                  'This object combines multiple criteria. Edit full alternative rows to preserve its logic.',
                );
              }
            }}
          >
            <SelectOption value='__rows'>
              Advanced · one full CPL alternative per line
            </SelectOption>
            {POLICY_CAPABILITIES.filter(
              (c) => c.form === 'equals',
            ).map((c) => (
              <SelectOption key={c.name} value={c.name}>
                {c.label} · one value per line
              </SelectOption>
            ))}
          </SelectField>
        </label>
        <label className='sr-only' htmlFor={`${id}-list`}>
          Object entries
        </label>
        <textarea
          id={`${id}-list`}
          value={text}
          disabled={operation !== 'edit'}
          onChange={(e) => {
            setText(e.target.value);
            setChanged(true);
          }}
          spellCheck={false}
          className='min-h-0 flex-1 resize-none rounded-lg border bg-muted/20 p-3 font-mono text-xs'
        />
        {!!uses && (
          <label className='flex items-start gap-2 text-xs'>
            <input
              type='checkbox'
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
            />
            I understand that changing this shared object affects all{' '}
            {uses} direct references and their dependent rules.
          </label>
        )}
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={
              disabled ||
              (!!uses && operation !== 'clone' && !acknowledged) ||
              !definition.complete
            }
            onClick={save}
          >
            Save object draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
