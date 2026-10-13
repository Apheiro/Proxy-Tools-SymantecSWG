'use client';

import { isTauri } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Copy, Minus, Square, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export default function WindowTitlebar({
  title = 'Proxy Tools',
  className,
}: {
  title?: string;
  className?: string;
}) {
  const [desktop, setDesktop] = useState(false);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    setDesktop(true);
    const appWindow = getCurrentWindow();
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    let unlistenClose: UnlistenFn | undefined;
    void listen<string>('backup:close-blocked', ({ payload }) =>
      toast.warning(payload),
    )
      .then((cleanup) => {
        if (disposed) cleanup();
        else unlistenClose = cleanup;
      })
      .catch(console.error);
    const updateMaximized = async () => {
      const value = await appWindow.isMaximized();
      if (!disposed) setMaximized(value);
    };

    void appWindow
      .onResized(() => {
        void updateMaximized().catch(console.error);
      })
      .then((cleanup) => {
        if (disposed) cleanup();
        else {
          unlisten = cleanup;
          return updateMaximized();
        }
      })
      .catch(console.error);

    return () => {
      disposed = true;
      unlisten?.();
      unlistenClose?.();
    };
  }, []);

  if (!desktop) return null;

  const run = (action: 'minimize' | 'toggleMaximize' | 'close') => {
    void getCurrentWindow()
      [action]()
      .catch((error: unknown) => {
        console.error(`Window action failed: ${action}`, error);
        toast.error('Could not update the window. Please try again.');
      });
  };

  return (
    <header
      data-slot='window-titlebar'
      className={cn(
        'bg-background text-foreground flex h-9 shrink-0 select-none items-center border-b',
        className,
      )}
    >
      {/* Tauri handles dragging and double-click maximize natively. */}
      <div
        data-tauri-drag-region
        className='flex h-full min-w-0 flex-1 items-center px-4 text-xs font-medium'
      >
        <span className='pointer-events-none truncate'>{title}</span>
      </div>
      <div className='flex h-full shrink-0'>
        <Button
          type='button'
          variant='ghost'
          size='icon'
          className='h-full w-11 cursor-pointer rounded-none'
          aria-label='Minimize window'
          title='Minimize'
          onClick={() => run('minimize')}
        >
          <Minus aria-hidden='true' className='size-4' />
        </Button>
        <Button
          type='button'
          variant='ghost'
          size='icon'
          className='h-full w-11 cursor-pointer rounded-none'
          aria-label={
            maximized ? 'Restore window' : 'Maximize window'
          }
          title={maximized ? 'Restore' : 'Maximize'}
          onClick={() => run('toggleMaximize')}
        >
          {maximized ? (
            <Copy aria-hidden='true' className='size-3.5' />
          ) : (
            <Square aria-hidden='true' className='size-3.5' />
          )}
        </Button>
        <Button
          type='button'
          variant='ghost'
          size='icon'
          className='h-full w-11 cursor-pointer rounded-none hover:bg-destructive hover:text-white dark:hover:bg-destructive'
          aria-label='Close window'
          title='Close'
          onClick={() => run('close')}
        >
          <X aria-hidden='true' className='size-4' />
        </Button>
      </div>
    </header>
  );
}
