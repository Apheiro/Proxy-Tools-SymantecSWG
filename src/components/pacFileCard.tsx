'use client';

import { useState } from 'react';
import {
  Download,
  FileCode2,
  GitCompareArrows,
  MoreHorizontal,
  Pencil,
  RefreshCcw,
  Tags,
  Trash2,
} from 'lucide-react';
import PacFileTagsEditor from '@/components/pacFileTagsEditor';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { PacSource } from '@/lib/pac';
import { downloadedText } from '@/lib/pacTextDiff';
import { downloadRawPac } from '@/lib/pacMerge';
import { normalizeProxyTags } from '@/lib/proxyTags';
import { toast } from 'sonner';

const statusText = {
  synced: 'Synced',
  'local-changes': 'Local changes',
  'remote-changes': 'Remote changes',
  conflict: 'Conflict',
  offline: 'Offline',
};

export default function PacFileCard({
  source,
  availableTags,
  loading,
  onSync,
  onEdit,
  onDelete,
  onTagsChange,
  onCompare,
}: {
  source: PacSource;
  availableTags: string[];
  loading: boolean;
  onSync: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onTagsChange: (tags: string[]) => void;
  onCompare: () => void;
}) {
  const [tagsOpen, setTagsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const hasRaw =
    source.localContent !== undefined ||
    source.downloadedContent !== undefined ||
    source.remoteContent !== undefined ||
    source.pendingContent !== undefined ||
    Boolean(source.lastSyncedAt);
  const download = () => {
    try {
      const content = downloadedText(source);
      if (content === undefined)
        throw new Error(
          'Original text is unavailable. Synchronize this source first.',
        );
      downloadRawPac(source.name, content);
    } catch (error) {
      toast.error(String(error));
    }
  };
  // Both menu surfaces are rendered from the same action definitions.
  const actions = [
    {
      label:
        source.localContent !== undefined
          ? 'View source'
          : 'Edit source',
      icon: Pencil,
      run: onEdit,
    },
    {
      label: 'Open in comparator',
      icon: GitCompareArrows,
      run: onCompare,
      disabled: !hasRaw,
    },
    {
      label: 'Download original text',
      icon: Download,
      run: download,
      disabled: !hasRaw,
    },
    {
      label: 'Sync',
      icon: RefreshCcw,
      run: onSync,
      disabled: loading || !source.url,
    },
    { label: 'Edit tags', icon: Tags, run: () => setTagsOpen(true) },
    {
      label: 'Delete',
      icon: Trash2,
      run: () => setDeleteOpen(true),
      destructive: true,
    },
  ];
  const menu = (context: boolean) =>
    actions.map((action) => {
      const Item = context ? ContextMenuItem : DropdownMenuItem;
      return (
        <Item
          key={action.label}
          onSelect={action.run}
          disabled={action.disabled}
          variant={action.destructive ? 'destructive' : 'default'}
        >
          <action.icon className='size-4' />
          {action.label}
        </Item>
      );
    });
  return (
    <>
      <ContextMenu modal={false}>
        <ContextMenuTrigger asChild>
          <Card
            tabIndex={0}
            className='min-w-0 gap-0 py-0 transition-colors hover:border-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
          >
            <CardContent className='flex h-full flex-col gap-4 p-5'>
              <div className='flex items-start gap-3'>
                <span className='flex size-10 shrink-0 items-center justify-center rounded-xl border bg-muted/40 text-muted-foreground'>
                  <FileCode2 className='size-5' />
                </span>
                <div className='min-w-0 flex-1'>
                  <h3
                    className='truncate font-semibold'
                    title={source.name}
                  >
                    {source.name}
                  </h3>
                  <p
                    className='mt-1 truncate text-xs text-muted-foreground'
                    title={source.url}
                  >
                    {source.url ||
                      (source.localContent !== undefined
                        ? 'Independent merge result'
                        : 'Local source')}
                  </p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant='ghost'
                      size='icon'
                      className='size-8 shrink-0'
                      aria-label={`File actions for ${source.name}`}
                    >
                      <MoreHorizontal className='size-4' />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align='end'>
                    {menu(false)}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className='flex flex-wrap items-center gap-2'>
                <Badge
                  variant={
                    source.status === 'conflict'
                      ? 'destructive'
                      : 'secondary'
                  }
                >
                  {statusText[source.status]}
                </Badge>
                <span className='text-xs text-muted-foreground'>
                  {source.localContent !== undefined
                    ? 'Raw text'
                    : `${source.rules.length} rules`}
                </span>
              </div>
              <div className='flex min-h-6 flex-wrap items-center gap-1.5'>
                {normalizeProxyTags(source.tags).map((tag) => (
                  <Badge
                    key={tag}
                    variant='outline'
                    className='max-w-full whitespace-normal break-words'
                  >
                    {tag}
                  </Badge>
                ))}
                {!normalizeProxyTags(source.tags).length && (
                  <button
                    type='button'
                    onClick={() => setTagsOpen(true)}
                    className='flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground'
                  >
                    <Tags className='size-3' />
                    Add tags
                  </button>
                )}
              </div>
              <div className='mt-auto flex flex-wrap items-center justify-between gap-2 border-t pt-3'>
                <p className='text-xs text-muted-foreground'>
                  {source.lastSyncedAt
                    ? `Downloaded ${new Date(source.lastSyncedAt).toLocaleString('en')}`
                    : source.localContent !== undefined
                      ? 'Saved locally'
                      : 'Not downloaded'}
                </p>
                <Button size='sm' variant='outline' onClick={onEdit}>
                  <Pencil className='size-3.5' />
                  {source.localContent !== undefined
                    ? 'View'
                    : 'Edit source'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </ContextMenuTrigger>
        <ContextMenuContent>{menu(true)}</ContextMenuContent>
      </ContextMenu>
      <PacFileTagsEditor
        tags={normalizeProxyTags(source.tags)}
        availableTags={availableTags}
        onChange={onTagsChange}
        open={tagsOpen}
        onOpenChange={setTagsOpen}
      />
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {source.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the saved source from PAC File Manager. The
              remote file is not changed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete}>
              Delete source
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
