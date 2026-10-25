'use client';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { LoaderCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type {
  EmbeddedPage,
  EmbeddedTransition,
} from '@/lib/embeddedBrowser';
import { useEmbeddedBrowser } from './provider';

/** A measured slot for a native child view, not an HTML iframe or recreated document. */
export default function EmbeddedContent({
  page,
  transition,
  visible = true,
}: {
  page: EmbeddedPage;
  transition: EmbeddedTransition;
  visible?: boolean;
}) {
  const { nextPresentation } = useEmbeddedBrowser();
  const slot = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (page.loaded) return;
    const timer = setTimeout(() => setSlow(true), 30000);
    return () => clearTimeout(timer);
  }, [page.id, page.loaded]);
  useEffect(() => {
    const element = slot.current;
    if (!element || !isTauri()) return;
    let disposed = false,
      frame = 0,
      sending = false,
      again = false;
    let last = '';
    let first = true;
    const version = nextPresentation();
    setError('');
    const present = async () => {
      if (disposed) return;
      if (sending) {
        again = true;
        return;
      }
      if (!visible || !page.loaded) return;
      const rect = element.getBoundingClientRect();
      // Keep the native viewport size stable: animating width reflows remote pages.
      const bounds = {
        x: Math.ceil(rect.left),
        y: Math.ceil(rect.top),
        width: Math.floor(rect.right) - Math.ceil(rect.left),
        height: Math.floor(rect.bottom) - Math.ceil(rect.top),
      };
      const serialized = JSON.stringify(bounds);
      if (serialized === last || rect.width < 1 || rect.height < 1)
        return;
      sending = true;
      try {
        await invoke('embedded_present', {
          id: page.id,
          bounds,
          revision: version,
          focus: first,
        });
        last = serialized;
        first = false;
      } catch (error) {
        if (!disposed) setError(String(error));
      } finally {
        sending = false;
        if (again && !disposed) {
          again = false;
          void present();
        }
      }
    };
    const observer = new ResizeObserver(() => void present());
    observer.observe(element);
    const resize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        void present();
      });
    };
    window.addEventListener('resize', resize);
    window.addEventListener('embedded:layout', resize);
    if (!visible || !page.loaded)
      void invoke('embedded_hide', { revision: version }).catch(
        (error) => {
          if (!disposed) setError(String(error));
        },
      );
    void present();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', resize);
      window.removeEventListener('embedded:layout', resize);
    };
  }, [page.id, page.loaded, transition, visible, nextPresentation]);
  return (
    <section
      ref={slot}
      data-embedded-slot
      className='relative min-h-0 flex-1 overflow-hidden bg-background outline-none'
      tabIndex={-1}
      aria-label={`Page content: ${page.title}`}
    >
      {visible && page.loaded && !error && (
        <button
          type='button'
          className='sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2'
          onFocus={() => {
            if (isTauri())
              void invoke('embedded_focus', { id: page.id }).catch(
                () => {},
              );
          }}
        >
          Focus page content
        </button>
      )}
      {(error || !page.loaded || !visible) && (
        <div
          className='absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground'
          role={error ? 'alert' : 'status'}
        >
          {!error && (
            <LoaderCircle className='size-5 motion-safe:animate-spin' />
          )}
          <p>
            {error ||
              (slow
                ? 'This page is taking longer to load. You can minimize it and keep working.'
                : 'Opening page…')}
          </p>
        </div>
      )}
    </section>
  );
}
