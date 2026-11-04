'use client';

import { useEffect, useId, useState } from 'react';
import { FileCode2, Search, Tags } from 'lucide-react';
import { toast } from 'sonner';
import PacFileCard from '@/components/pacFileCard';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { SelectField, SelectOption } from '@/components/ui/select';
import type { PacSource } from '@/lib/pac';
import {
  groupPacFiles,
  pacFileTags,
  PAC_GROUPING_KEY,
  type PacFileGrouping,
} from '@/lib/pacFileTags';
import { normalizeProxyTags } from '@/lib/proxyTags';
import { getLocalStorage, postLocalStorage } from '@/lib/utilsClient';

export default function PacFileInventory({
  sources,
  loading,
  onSync,
  onEdit,
  onDelete,
  onTagsChange,
  onCompare,
}: {
  sources: PacSource[];
  loading: boolean;
  onSync: (source: PacSource) => void;
  onEdit: (source: PacSource) => void;
  onDelete: (source: PacSource) => void;
  onTagsChange: (source: PacSource, tags: string[]) => void;
  onCompare: (source: PacSource) => void;
}) {
  const groupId = useId();
  const tagId = useId();
  const [grouping, setGrouping] = useState<PacFileGrouping>({
    groupBy: 'none',
    tag: '',
  });
  const [search, setSearch] = useState('');
  useEffect(() => {
    try {
      const saved =
        getLocalStorage<PacFileGrouping>(PAC_GROUPING_KEY);
      if (saved?.groupBy === 'tags')
        setGrouping({
          groupBy: 'tags',
          tag: typeof saved.tag === 'string' ? saved.tag : '',
        });
    } catch {
      toast.error(
        'Could not read saved file grouping. Default grouping is being used.',
      );
    }
  }, []);
  const changeGrouping = (next: PacFileGrouping) => {
    setGrouping(next);
    try {
      postLocalStorage(PAC_GROUPING_KEY, next);
    } catch {
      toast.error('Could not save file grouping.');
    }
  };
  const tags = pacFileTags(sources);
  const allGroups = groupPacFiles(sources, {
    groupBy: 'tags',
    tag: '',
  });
  const activeTag = allGroups.some(
    (group) => group.key === grouping.tag,
  )
    ? grouping.tag
    : '';
  const query = search.trim().toLocaleLowerCase();
  const filtered = sources.filter((source) =>
    [
      source.name,
      source.url,
      ...normalizeProxyTags(source.tags),
    ].some((value) => value.toLocaleLowerCase().includes(query)),
  );
  const groups = groupPacFiles(filtered, {
    ...grouping,
    tag: activeTag,
  });
  return (
    <section
      aria-label='PAC file inventory'
      className='min-w-0 space-y-4'
    >
      <div className='flex flex-wrap items-end justify-between gap-3'>
        <div>
          <div className='flex items-center gap-2'>
            <h2 className='text-xl font-semibold'>PAC sources</h2>
            <Badge variant='secondary'>{sources.length} files</Badge>
          </div>
          <p className='mt-1 text-sm text-muted-foreground'>
            Organize your WPAD files, review originals, and open their
            routing editor.
          </p>
        </div>
        <p className='text-xs text-muted-foreground'>
          Right-click a file or use its actions menu.
        </p>
      </div>
      {sources.length > 0 && (
        <div className='flex flex-wrap items-end gap-3 rounded-xl border bg-muted/25 p-4'>
          <div className='min-w-48 flex-1 space-y-1.5'>
            <label
              htmlFor={`${groupId}-search`}
              className='flex items-center gap-1.5 text-xs font-medium text-muted-foreground'
            >
              <Search className='size-3' />
              Find a file
            </label>
            <Input
              id={`${groupId}-search`}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder='Search names, URLs or tags'
            />
          </div>
          <div className='min-w-40 space-y-1.5'>
            <label
              htmlFor={groupId}
              className='text-xs font-medium text-muted-foreground'
            >
              Group by
            </label>
            <SelectField
              id={groupId}
              className='w-full'
              value={grouping.groupBy}
              onValueChange={(value) =>
                changeGrouping({
                  groupBy: value === 'tags' ? 'tags' : 'none',
                  tag: '',
                })
              }
            >
              <SelectOption value='none'>No grouping</SelectOption>
              <SelectOption value='tags'>Tags</SelectOption>
            </SelectField>
          </div>
          {grouping.groupBy === 'tags' && (
            <div className='min-w-40 space-y-1.5'>
              <label
                htmlFor={tagId}
                className='text-xs font-medium text-muted-foreground'
              >
                Show tag
              </label>
              <SelectField
                id={tagId}
                className='w-full'
                value={activeTag}
                onValueChange={(tag) =>
                  changeGrouping({ groupBy: 'tags', tag })
                }
              >
                <SelectOption value=''>All tags</SelectOption>
                {allGroups.map((group) => (
                  <SelectOption key={group.key} value={group.key}>
                    {group.label}
                  </SelectOption>
                ))}
              </SelectField>
            </div>
          )}
          <p className='w-full text-xs text-muted-foreground'>
            Tags and grouping are saved on this device.
            {grouping.groupBy === 'tags' &&
              ' Files with multiple tags appear in each matching group.'}
          </p>
        </div>
      )}
      {sources.length === 0 ? (
        <div className='flex min-h-60 flex-col items-center justify-center rounded-xl border border-dashed p-8 text-center'>
          <FileCode2 className='size-9 text-muted-foreground/50' />
          <p className='mt-4 font-medium'>No PAC sources yet</p>
          <p className='mt-1 text-sm text-muted-foreground'>
            Add a remote source or create a PAC file from scratch.
          </p>
        </div>
      ) : !filtered.length ||
        !groups.some((group) => group.sources.length) ? (
        <p className='rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground'>
          No files match these filters.
        </p>
      ) : (
        <div className='space-y-6'>
          {groups.map((group) => (
            <section
              key={group.key}
              aria-label={group.label || 'All PAC files'}
              className='space-y-3'
            >
              {grouping.groupBy === 'tags' && (
                <div className='flex items-center gap-2 border-b pb-2'>
                  <Tags className='size-4 text-muted-foreground' />
                  <h3 className='font-semibold'>{group.label}</h3>
                  <Badge variant='secondary'>
                    {group.sources.length}
                  </Badge>
                </div>
              )}
              <div className='grid gap-4 md:grid-cols-2 xl:grid-cols-3'>
                {group.sources.map((source) => (
                  <PacFileCard
                    key={source.id}
                    source={source}
                    loading={loading}
                    availableTags={tags}
                    onSync={() => onSync(source)}
                    onEdit={() => onEdit(source)}
                    onDelete={() => onDelete(source)}
                    onCompare={() => onCompare(source)}
                    onTagsChange={(nextTags) =>
                      onTagsChange(source, nextTags)
                    }
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
