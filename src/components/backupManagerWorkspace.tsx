'use client';

import { useVirtualizer } from '@tanstack/react-virtual';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  AlertTriangle,
  Archive,
  FileText,
  FolderOpen,
  LoaderCircle,
  RefreshCw,
  Terminal,
  Trash2,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { toast } from 'sonner';
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
import PageHeader from '@/components/pageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SelectField, SelectOption } from '@/components/ui/select';
import {
  type BackupMode,
  type BackupRecord,
  type BackupStatus,
  displayBackupLine,
  findBackupAppliance,
} from '@/lib/backupManager';
import { useCredentialRevision } from '@/lib/credentialStore';
import getCredentials from '@/lib/getCredentials';
import useDataSourceMode from '@/lib/useDataSourceMode';
import { getLocalStorage } from '@/lib/utilsClient';
import { cva } from '@/lib/cva';

const backupEntryStyles = cva({
  base: 'flex min-w-0 items-center gap-1 rounded-lg border transition-colors',
  variants: {
    selected: {
      true: 'border-primary/30 bg-accent',
      false: 'border-transparent hover:bg-accent/50',
    },
  },
});

function BackupPreview({ content }: { content: string }) {
  const container = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => content.split('\n'), [content]);
  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => container.current,
    estimateSize: () => 20,
    overscan: 20,
  });
  return (
    <section
      ref={container}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users must be able to scroll the preview.
      tabIndex={0}
      aria-label='Complete backup content'
      className='h-full min-h-0 overflow-auto font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring'
    >
      <div
        className='relative min-w-full w-max'
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((line) => (
          <div
            key={line.key}
            className='absolute top-0 left-0 flex h-5 min-w-full whitespace-pre pr-4'
            style={{ transform: `translateY(${line.start}px)` }}
          >
            <span
              aria-hidden='true'
              className='sticky left-0 mr-4 w-16 shrink-0 bg-card pr-3 text-right text-muted-foreground'
            >
              {line.index + 1}
            </span>
            <span>{displayBackupLine(lines[line.index]) || ' '}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function BackupEntry({
  record,
  selected,
  onSelect,
  onDelete,
  deleting,
}: {
  record: BackupRecord;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  return (
    <div className={backupEntryStyles({ selected })}>
      <button
        type='button'
        aria-pressed={selected}
        onClick={onSelect}
        className='flex min-w-0 flex-1 cursor-pointer items-start gap-3 rounded-lg p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring'
      >
        <FileText
          className='mt-0.5 size-4 shrink-0 text-muted-foreground'
          aria-hidden='true'
        />
        <div className='min-w-0 flex-1'>
          <div className='flex flex-wrap items-center gap-2'>
            <span className='truncate text-sm font-medium'>
              {record.appliance}
            </span>
            <Badge variant='secondary'>
              {record.mode === 'unencrypted'
                ? 'Unencrypted'
                : 'Encrypted'}
            </Badge>
            {record.mode === 'unencrypted' && (
              <AlertTriangle
                className='size-3.5 shrink-0 text-orange-500'
                aria-label='Unencrypted private keys'
              />
            )}
            {record.mocked && <Badge variant='outline'>Mock</Badge>}
          </div>
          <p className='mt-1 text-xs text-muted-foreground'>
            {new Date(record.createdAt).toLocaleString()} ·{' '}
            {record.bytes.toLocaleString()} bytes
          </p>
          {record.warning && (
            <p className='mt-1 break-words text-xs text-destructive'>
              {record.warning}
            </p>
          )}
        </div>
      </button>
      <Button
        type='button'
        size='icon'
        variant='ghost'
        className='mr-2 shrink-0 text-muted-foreground hover:text-destructive'
        aria-label={`Delete backup ${record.appliance} ${new Date(record.createdAt).toLocaleString()}`}
        title='Delete backup'
        disabled={deleting}
        onClick={onDelete}
      >
        <Trash2 className='size-4' />
      </Button>
    </div>
  );
}

function useBackupStatus(
  refresh: () => Promise<BackupRecord[]>,
  onError: (message: string) => void,
) {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    if (!isTauri()) return;
    setDesktop(true);
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const applyStatus = (value: BackupStatus) => {
      if (!disposed) setStatus(value);
    };
    void listen<BackupStatus>('backup:status', ({ payload }) =>
      applyStatus(payload),
    )
      .then(async (cleanup) => {
        if (disposed) {
          cleanup();
          return;
        }
        unlisten = cleanup;
        const [value] = await Promise.all([
          invoke<BackupStatus>('get_backup_status'),
          refresh(),
        ]);
        applyStatus(value);
      })
      .catch((reason: unknown) => {
        if (!disposed) onError(String(reason));
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [refresh, onError]);
  return { status, setStatus, desktop };
}

export default function BackupManagerWorkspace({
  address,
}: {
  address: string;
}) {
  const { mode: source, ready } = useDataSourceMode();
  const revision = useCredentialRevision();
  const modeId = useId();
  const [mode, setMode] = useState<BackupMode>('encrypted');
  const [records, setRecords] = useState<BackupRecord[]>([]);
  const [selected, setSelected] = useState('');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [appliance, setAppliance] = useState(address);
  const [hasCredentials, setHasCredentials] = useState(false);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] =
    useState<BackupRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [openingFolder, setOpeningFolder] = useState(false);
  const selectedRecord = records.find(
    (record) => record.id === selected,
  );

  const refresh = useCallback(async () => {
    const value = await invoke<BackupRecord[]>('list_backups');
    setRecords(value);
    setSelected((previous) =>
      value.some((record) => record.id === previous)
        ? previous
        : (value[0]?.id ?? ''),
    );
    return value;
  }, []);
  const { status, setStatus, desktop } = useBackupStatus(
    refresh,
    setError,
  );
  const busy = starting || status?.running;

  useEffect(() => {
    setHasCredentials(Boolean(getCredentials()));
  }, [revision]);

  useEffect(() => {
    const proxy = findBackupAppliance(
      getLocalStorage<Proxy[]>('proxies') ?? [],
      address,
    );
    setAppliance(
      proxy?.hostname || address || 'No appliance selected',
    );
  }, [address]);

  useEffect(() => {
    if (!status?.id || status.running) return;
    void refresh()
      .then((value) => {
        if (value.some((record) => record.id === status.id))
          setSelected(status.id);
      })
      .catch((reason: unknown) => setError(String(reason)));
  }, [status?.id, status?.running, refresh]);

  useEffect(() => {
    setContent('');
    if (!selected) return;
    let disposed = false;
    setLoading(true);
    setError('');
    void invoke<string>('read_backup', { id: selected })
      .then((value) => {
        if (!disposed) setContent(value);
      })
      .catch((reason: unknown) => {
        if (!disposed) setError(String(reason));
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [selected]);

  const start = async () => {
    const credentials = getCredentials();
    if (!credentials || !address) return;
    setStarting(true);
    setError('');
    try {
      await invoke<string>('start_backup', {
        request: {
          appliance,
          address,
          ...credentials,
          mode,
          mocked: source === 'mock',
        },
      });
      setStatus(await invoke<BackupStatus>('get_backup_status'));
    } catch (reason) {
      setError(String(reason));
      toast.error(String(reason));
    } finally {
      setStarting(false);
    }
  };

  const openFolder = async () => {
    setOpeningFolder(true);
    try {
      await invoke('open_backup_folder');
    } catch (reason) {
      toast.error(String(reason));
    } finally {
      setOpeningFolder(false);
    }
  };

  const removeBackup = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setError('');
    try {
      await invoke('delete_backup', { id: deleteTarget.id });
      if (selected === deleteTarget.id) {
        setSelected('');
        setContent('');
      }
      setDeleteTarget(null);
      await refresh();
      toast.success('Backup deleted.');
    } catch (reason) {
      setError(String(reason));
      toast.error(String(reason));
      // Refresh even after partial filesystem cleanup so the list reflects disk state.
      await refresh().catch(() => undefined);
    } finally {
      setDeleting(false);
    }
  };

  const destination = status?.running
    ? status.destination
    : source === 'mock'
      ? '127.0.0.1:2222'
      : `${address || '—'}:22`;

  return (
    <main className='mx-auto flex w-full max-w-screen-2xl flex-col gap-4 p-4 md:p-5'>
      <PageHeader
        icon={Archive}
        eyebrow='Appliance backups'
        title='Backup Manager'
        description={<>{appliance} · Configuration backups</>}
        actions={
          <Badge variant='outline'>
            {source === 'mock' ? 'Mocked Data' : 'Live'}
          </Badge>
        }
      />
      {!desktop && (
        <output className='rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground'>
          SSH backups are available in the desktop application.
        </output>
      )}
      {error && (
        <p
          role='alert'
          className='rounded-lg border border-destructive/30 px-4 py-3 text-sm text-destructive'
        >
          {error}
        </p>
      )}
      <div className='grid min-w-0 gap-4 md:grid-cols-[260px_minmax(0,1fr)] md:h-[calc(100dvh-220px)] md:min-h-[32rem]'>
        <Card className='min-h-0 min-w-0 gap-0 overflow-hidden py-0'>
          <CardHeader className='gap-2 border-b p-4'>
            <CardTitle className='flex items-center gap-2 text-base'>
              <Terminal className='size-4' />
              SSH connection
            </CardTitle>
            <p className='break-all font-mono text-xs text-muted-foreground'>
              {destination}
            </p>
          </CardHeader>
          <CardContent className='flex min-h-0 flex-1 flex-col gap-4 p-4'>
            <div className='flex flex-col gap-2'>
              <label className='text-sm font-medium' htmlFor={modeId}>
                Backup mode
              </label>
              <SelectField
                id={modeId}
                value={mode}
                onValueChange={(value) =>
                  setMode(value as BackupMode)
                }
                disabled={Boolean(busy)}
              >
                <SelectOption value='encrypted'>
                  Encrypted
                </SelectOption>
                <SelectOption value='unencrypted'>
                  Unencrypted
                </SelectOption>
              </SelectField>
              <p className='text-xs leading-relaxed text-muted-foreground'>
                {mode === 'unencrypted'
                  ? 'Includes visible private keys without encryption.'
                  : 'Keeps the appliance’s private-key display settings. The local backup file is not encrypted.'}
              </p>
            </div>
            {!hasCredentials && (
              <p className='text-xs text-muted-foreground'>
                No saved credentials. Configure them in Settings.
              </p>
            )}
            <Button
              disabled={
                !desktop ||
                !ready ||
                !address ||
                !hasCredentials ||
                Boolean(busy)
              }
              onClick={() => void start()}
            >
              {busy ? (
                <LoaderCircle className='size-4 animate-spin' />
              ) : (
                <Archive className='size-4' />
              )}
              Create backup
            </Button>
            <div
              aria-live='polite'
              className='flex flex-col gap-1 border-t pt-4'
            >
              <p className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>
                Process status
              </p>
              <p className='break-words text-sm font-medium'>
                {status?.phase || 'Disconnected'}
              </p>
              {Boolean(status?.bytes) && (
                <p className='text-xs text-muted-foreground'>
                  {status?.bytes.toLocaleString()} bytes captured
                </p>
              )}
            </div>
            <div className='flex min-h-0 flex-1 flex-col gap-2'>
              <p className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>
                Activity
              </p>
              <ScrollArea className='h-48 min-h-0 min-w-0 md:h-auto md:flex-1'>
                {(status?.error || status?.warning) && (
                  <p
                    role='alert'
                    className='mb-3 break-words text-xs leading-relaxed text-destructive'
                  >
                    {status.error || status.warning}
                  </p>
                )}

                {status?.actions.length ? (
                  <ol className='list-decimal space-y-3 pl-5 pr-2 font-mono text-xs leading-relaxed text-muted-foreground'>
                    {status.actions.map((action, index) => (
                      <li
                        key={`${index}-${action}`}
                        className='break-words'
                      >
                        {action}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className='text-xs leading-relaxed text-muted-foreground'>
                    Start a backup to see connection activity.
                  </p>
                )}
              </ScrollArea>
            </div>
          </CardContent>
        </Card>
        <div className='grid min-h-0 min-w-0 gap-4 grid-rows-[240px_400px] md:grid-rows-[minmax(180px,0.55fr)_minmax(280px,1fr)]'>
          <Card className='min-h-0 min-w-0 gap-0 overflow-hidden py-0'>
            <CardHeader className='flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3'>
              <div className='flex items-center gap-2'>
                <CardTitle className='text-base'>Backups</CardTitle>
                <Badge variant='secondary'>{records.length}</Badge>
              </div>
              <div className='flex items-center gap-1'>
                <Button
                  size='sm'
                  variant='ghost'
                  aria-label='Open backup folder'
                  disabled={!desktop || openingFolder}
                  onClick={() => void openFolder()}
                >
                  {openingFolder ? (
                    <LoaderCircle className='size-4 animate-spin' />
                  ) : (
                    <FolderOpen className='size-4' />
                  )}
                  Open folder
                </Button>
                <Button
                  size='icon'
                  variant='ghost'
                  aria-label='Refresh backups'
                  disabled={!desktop || deleting}
                  onClick={() =>
                    void refresh().catch((reason: unknown) =>
                      setError(String(reason)),
                    )
                  }
                >
                  <RefreshCw className='size-4' />
                </Button>
              </div>
            </CardHeader>
            <ScrollArea className='min-h-0 flex-1 p-2'>
              {records.length === 0 ? (
                <div className='flex flex-col items-center gap-2 px-4 py-6 text-center text-muted-foreground'>
                  <Archive className='size-6' />
                  <p className='text-sm'>No backups yet</p>
                  <p className='text-xs'>
                    Choose a mode and create your first backup.
                  </p>
                </div>
              ) : (
                <div className='space-y-1'>
                  {records.map((record) => (
                    <BackupEntry
                      key={record.id}
                      record={record}
                      selected={selected === record.id}
                      onSelect={() => setSelected(record.id)}
                      onDelete={() => {
                        setError('');
                        setDeleteTarget(record);
                      }}
                      deleting={
                        deleting ||
                        Boolean(
                          status?.running && status.id === record.id,
                        )
                      }
                    />
                  ))}
                </div>
              )}
            </ScrollArea>
          </Card>
          <Card className='min-h-0 min-w-0 gap-0 overflow-hidden py-0'>
            <CardHeader className='flex flex-wrap items-start justify-between gap-2 border-b px-4 py-3'>
              <div className='min-w-0 flex-1'>
                <CardTitle className='text-base'>Preview</CardTitle>
                <p
                  className='mt-1 truncate text-xs text-muted-foreground'
                  title={selectedRecord?.id}
                >
                  {selectedRecord
                    ? `${selectedRecord.id}.txt`
                    : 'Select a backup to view its complete content'}
                </p>
              </div>
              {selectedRecord && (
                <Badge variant='outline'>
                  {selectedRecord.mode === 'unencrypted'
                    ? 'Unencrypted'
                    : 'Encrypted'}
                </Badge>
              )}
            </CardHeader>
            <div className='min-h-0 flex-1 py-3'>
              {loading ? (
                <p className='px-4 text-sm text-muted-foreground'>
                  Loading complete backup…
                </p>
              ) : selected && content ? (
                <BackupPreview key={selected} content={content} />
              ) : (
                <div className='flex h-full flex-col items-center justify-center gap-2 text-muted-foreground'>
                  <FileText className='size-7' />
                  <p className='text-sm'>No backup selected</p>
                </div>
              )}
            </div>
            {selectedRecord && (
              <div className='flex flex-wrap justify-between gap-2 border-t px-4 py-2 text-xs text-muted-foreground'>
                <span>
                  {new Date(
                    selectedRecord.createdAt,
                  ).toLocaleString()}
                </span>
                <span>
                  {selectedRecord.bytes.toLocaleString()} bytes ·{' '}
                  {selectedRecord.address}
                </span>
              </div>
            )}
          </Card>
        </div>
      </div>
      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete backup?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the saved backup and its
              metadata from this device. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteTarget && (
            <div className='rounded-md border p-3 text-sm'>
              <p className='font-medium'>{deleteTarget.appliance}</p>
              <p className='mt-1 text-xs text-muted-foreground'>
                {new Date(deleteTarget.createdAt).toLocaleString()} ·{' '}
                {deleteTarget.mode === 'unencrypted'
                  ? 'Unencrypted'
                  : 'Encrypted'}
              </p>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className='bg-destructive text-white hover:bg-destructive/90'
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault();
                void removeBackup();
              }}
            >
              {deleting && (
                <LoaderCircle className='size-4 animate-spin' />
              )}
              Delete backup
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
