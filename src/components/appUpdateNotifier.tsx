'use client';

import { invoke, isTauri } from '@tauri-apps/api/core';
import { Download, FolderOpen, LoaderCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
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
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  type AppUpdate,
  type DownloadedUpdate,
  MOCK_UPDATE_TOKEN_KEY,
  UPDATE_CHECK_EVENT,
  UPDATE_TOKEN_EVENT,
  updateRequest,
} from '@/lib/appUpdates';
import useDataSourceMode from '@/lib/useDataSourceMode';

export default function AppUpdateNotifier() {
  const { mode, ready } = useDataSourceMode();
  const [update, setUpdate] = useState<AppUpdate | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const noticeRef = useRef<string | number | null>(null);
  function dismissNotice() {
    if (noticeRef.current !== null) toast.dismiss(noticeRef.current);
    noticeRef.current = null;
  }
  const [download, setDownload] = useState<DownloadedUpdate | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!ready || !isTauri()) return;
    let cancelled = false;
    let requestId = 0;
    if (!busyRef.current) {
      setUpdate(null);
      setDownload(null);
      setOpen(false);
    }
    dismissNotice();
    async function check(manual = false) {
      if (busyRef.current) {
        if (manual)
          toast.info('An update download is already running.');
        return;
      }
      const id = ++requestId;
      try {
        const result = await invoke<AppUpdate | null>(
          'check_app_update',
          updateRequest(mode),
        );
        if (cancelled || id !== requestId || busyRef.current) return;
        setUpdate(result);
        setDownload(null);
        setError(null);
        dismissNotice();
        if (!result) {
          if (manual)
            toast.success(
              'No newer Windows release is ready to download.',
            );
          return;
        }
        noticeRef.current = toast.custom(
          (toastId) => (
            <Button
              variant='outline'
              className='h-auto w-full justify-start whitespace-normal p-4 text-left'
              onClick={() => {
                toast.dismiss(toastId);
                setOpen(true);
              }}
            >
              <Download className='size-5 shrink-0' />
              <span>
                <span className='block font-semibold'>
                  Proxy Tools {result.version} is available
                </span>
                <span className='block text-xs text-muted-foreground'>
                  Click to view changes and download.
                </span>
              </span>
            </Button>
          ),
          { duration: Infinity, position: 'bottom-right' },
        );
      } catch (reason) {
        if (!cancelled && id === requestId && manual)
          toast.error(String(reason));
      }
    }
    const manual = () => void check(true);
    const tokenChanged = () => {
      setError(null);
      void check();
    };
    const storage = (event: StorageEvent) => {
      if (event.key === MOCK_UPDATE_TOKEN_KEY || event.key === null)
        tokenChanged();
    };
    void check();
    window.addEventListener(UPDATE_CHECK_EVENT, manual);
    window.addEventListener(UPDATE_TOKEN_EVENT, tokenChanged);
    window.addEventListener('storage', storage);
    return () => {
      cancelled = true;
      dismissNotice();
      window.removeEventListener(UPDATE_CHECK_EVENT, manual);
      window.removeEventListener(UPDATE_TOKEN_EVENT, tokenChanged);
      window.removeEventListener('storage', storage);
    };
  }, [mode, ready]);
  async function startDownload() {
    if (!update || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await invoke<DownloadedUpdate>(
        'download_app_update',
        { ...updateRequest(mode), releaseId: update.id },
      );
      setDownload(result);
      setOpen(true);
    } catch (reason) {
      setError(String(reason));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) setOpen(value);
      }}
    >
      <DialogContent className='flex max-h-[85dvh] flex-col sm:max-w-xl'>
        <DialogHeader>
          <DialogTitle>
            {download
              ? 'New executable ready'
              : `Proxy Tools ${update?.version ?? ''}`}
          </DialogTitle>
          <DialogDescription>
            {download
              ? 'The download was verified. Replace the current executable manually when you are ready.'
              : `Installed version: ${update?.currentVersion ?? ''}. Review the release changes before downloading.`}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className='min-h-0 flex-1'>
          {download ? (
            <div className='space-y-4 pr-3 text-sm'>
              <ol className='list-decimal space-y-2 pl-5'>
                <li>Open the download folder.</li>
                <li>Finish active work and close Proxy Tools.</li>
                <li>
                  Keep a copy of the old executable. Move the
                  downloaded file to the previous location, renaming
                  it to match the old executable if needed, and
                  replace it.
                </li>
                <li>Run the new executable.</li>
              </ol>
              <div>
                <p className='font-medium'>Downloaded executable</p>
                <p className='break-all text-muted-foreground'>
                  {download.path}
                </p>
              </div>
              <div>
                <p className='font-medium'>Current executable</p>
                <p className='break-all text-muted-foreground'>
                  {download.currentExecutable}
                </p>
              </div>
              <p className='text-xs text-muted-foreground'>
                The download is in the application cache. Move it
                before clearing temporary files. Your application data
                is kept separately.
              </p>
            </div>
          ) : (
            <pre className='whitespace-pre-wrap break-words pr-3 font-sans text-sm leading-relaxed'>
              {update?.notes || 'No release notes were provided.'}
            </pre>
          )}
        </ScrollArea>
        {error && (
          <p role='alert' className='text-sm text-destructive'>
            {error}
          </p>
        )}
        <DialogFooter>
          <Button
            variant='outline'
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            {download ? 'Close' : 'Later'}
          </Button>
          {download ? (
            <Button
              onClick={() =>
                void invoke('open_update_folder').catch((reason) =>
                  setError(String(reason)),
                )
              }
            >
              <FolderOpen className='size-4' />
              Open download folder
            </Button>
          ) : (
            <Button
              disabled={busy || !update}
              onClick={() => void startDownload()}
            >
              {busy ? (
                <LoaderCircle className='size-4 animate-spin' />
              ) : (
                <Download className='size-4' />
              )}
              {busy
                ? 'Downloading and verifying…'
                : 'Download update'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
