'use client';

import { X } from 'lucide-react';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
  DialogFooter,
} from '@/components/ui/dialog';
import { normalizeProxyTags } from '@/lib/proxyTags';

export default function ProxyTagsEditor({
  tags,
  availableTags,
  onChange,
  open,
  onOpenChange,
}: {
  tags: string[];
  availableTags: string[];
  onChange: (tags: string[]) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [draft, setDraft] = useState('');
  const inputId = useId();
  const selected = (tag: string) =>
    tags.some(
      (value) =>
        value.toLocaleLowerCase() === tag.toLocaleLowerCase(),
    );
  const addTag = () => {
    const normalized = normalizeProxyTags([draft])[0];
    if (!normalized) return;
    const tag =
      availableTags.find(
        (value) =>
          value.toLocaleLowerCase() ===
          normalized.toLocaleLowerCase(),
      ) ?? normalized;
    onChange(normalizeProxyTags([...tags, tag]));
    setDraft('');
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-labelledby={`${inputId}-title`}
        className='sm:max-w-sm'
      >
        <DialogHeader>
          <DialogTitle id={`${inputId}-title`}>
            Proxy tags
          </DialogTitle>
          <DialogDescription>
            Create your own tags or reuse existing ones. Changes are
            saved automatically.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            addTag();
          }}
          className='space-y-2'
        >
          <label htmlFor={inputId} className='text-xs font-medium'>
            New tag
          </label>
          <div className='flex gap-2'>
            <Input
              id={inputId}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder='Enter a tag name'
              maxLength={64}
            />
            <Button type='submit' size='sm' disabled={!draft.trim()}>
              Add
            </Button>
          </div>
        </form>
        {!!availableTags.length && (
          <div className='flex max-h-48 flex-wrap gap-1.5 overflow-y-auto'>
            {availableTags.map((tag) => (
              <Button
                key={tag}
                size='sm'
                variant={selected(tag) ? 'secondary' : 'outline'}
                aria-pressed={selected(tag)}
                className='h-auto max-w-full whitespace-normal break-words text-left'
                onClick={() =>
                  onChange(
                    selected(tag)
                      ? tags.filter(
                          (value) =>
                            value.toLocaleLowerCase() !==
                            tag.toLocaleLowerCase(),
                        )
                      : [...tags, tag],
                  )
                }
              >
                {tag}
                {selected(tag) && (
                  <X className='size-3 shrink-0' aria-hidden='true' />
                )}
              </Button>
            ))}
          </div>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant='outline'>Done</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
