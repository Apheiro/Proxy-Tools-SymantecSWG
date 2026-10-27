'use client';

import { isTauri } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Copy, Minus, Square, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type ResizeDirection = Parameters<
  ReturnType<typeof getCurrentWindow>['startResizeDragging']
>[0];

const resizeEdges: { direction: ResizeDirection; className: string }[] = [
  { direction: 'North', className: 'inset-x-2 top-0 h-1 cursor-n-resize' },
  { direction: 'South', className: 'inset-x-2 bottom-0 h-1 cursor-s-resize' },
  { direction: 'West', className: 'inset-y-2 left-0 w-1 cursor-w-resize' },
  { direction: 'East', className: 'inset-y-2 right-0 w-1 cursor-e-resize' },
  { direction: 'NorthWest', className: 'left-0 top-0 size-2 cursor-nw-resize' },
  { direction: 'NorthEast', className: 'right-0 top-0 size-2 cursor-ne-resize' },
  { direction: 'SouthWest', className: 'left-0 bottom-0 size-2 cursor-sw-resize' },
  { direction: 'SouthEast', className: 'right-0 bottom-0 size-2 cursor-se-resize' },
];

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
    let unlistenPolicy: UnlistenFn | undefined;
    void listen<string>('policy:close-blocked', ({ payload }) =>
      toast.warning(payload),
    )
      .then((cleanup) => {
        if (disposed) cleanup();
        else unlistenPolicy = cleanup;
      })
      .catch(console.error);
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
      unlistenPolicy?.();
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
    <>
    {!maximized && resizeEdges.map(({ direction, className: edgeClass }) => (
      <div
        key={direction}
        aria-hidden='true'
        className={cn('fixed z-[120] touch-none', edgeClass)}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          void getCurrentWindow().startResizeDragging(direction).catch((error) => {
            console.error('Window resize failed:', error);
            toast.error('Could not resize the window.');
          });
        }}
      />
    ))}
    <header
      data-slot='window-titlebar'
      className={cn(
        'relative z-[100] pointer-events-auto bg-background text-foreground flex h-9 shrink-0 select-none items-center border-b',
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
    </>
  );
}
