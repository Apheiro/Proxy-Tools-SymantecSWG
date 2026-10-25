'use client';
import * as Dialog from '@radix-ui/react-dialog';
import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  AnimatePresence,
  motion,
  useReducedMotion,
} from 'motion/react';
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Layers,
  Minus,
  X,
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { TooltipOne, TooltipProvider } from '@/components/ui/tooltip';
import { pageDomain } from '@/lib/embeddedBrowser';
import EmbeddedContent from './content';
import { useEmbeddedBrowser } from './provider';
import { useAppPreferences } from '@/lib/appPreferences';
import {
  formatBinding,
  type ShortcutAction,
} from '@/lib/shortcutBindings';
import {
  windowMotion,
  windowContentsMotion,
  windowCircleMotion,
  type WindowMotionGeometry,
} from './window-motion';

export default function EmbeddedModal() {
  const {
    pages,
    activeId,
    transition,
    minimize,
    close,
    restore,
    navigate,
    frontOrder,
    activation,
  } = useEmbeddedBrowser();
  const preferences = useAppPreferences();
  const shortcutHint = (label: string, action: ShortcutAction) =>
    preferences.shortcuts[action]
      ? `${label} · ${formatBinding(preferences.shortcuts[action])}`
      : label;
  const page = pages.find((p) => p.id === activeId);
  const reduceMotion = useReducedMotion();
  const [surfaceReady, setSurfaceReady] = useState(false);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const lastPage = useRef(page);
  if (page) lastPage.current = page;
  useEffect(() => {
    const resize = () =>
      setViewport({
        width: window.innerWidth,
        height: Math.max(0, window.innerHeight - 36),
      });
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  useEffect(() => {
    if (!activeId) setSurfaceReady(false);
  }, [activeId]);
  const descriptionId = useId();
  const controls = useRef<HTMLButtonElement>(null);
  const current = useRef(activeId);
  current.current = activeId;
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let off: (() => void) | undefined;
    void listen<string>('embedded:focus-controls', (event) => {
      if (event.payload === current.current)
        controls.current?.focus();
    }).then((cleanup) => {
      if (disposed) cleanup();
      else off = cleanup;
    });
    return () => {
      disposed = true;
      off?.();
    };
  }, []);
  const [expanded, setExpanded] = useState(false);
  const layers = pages.filter((p) => p.groupId === page?.groupId);
  const behind = layers
    .filter((p) => p.id !== activeId)
    .sort(
      (a, b) => frontOrder.indexOf(a.id) - frontOrder.indexOf(b.id),
    );
  const visibleBehind = expanded ? behind : [];
  const stripHeight = 32;
  const stackHeight = Math.min(
    visibleBehind.length * stripHeight,
    240,
  );
  const groups = [...new Set(pages.map((p) => p.groupId))];
  const groupIndex = Math.max(
    0,
    groups.indexOf((page ?? lastPage.current)?.groupId ?? ''),
  );
  const geometry: WindowMotionGeometry = {
    left: viewport.width * 0.05,
    top: viewport.height * 0.05,
    width: viewport.width * 0.9,
    height: viewport.height * 0.9,
    dockX: Math.max(
      24,
      Math.min(
        viewport.width - 24,
        viewport.width / 2 +
          (groupIndex - (groups.length - 1) / 2) * 40,
      ),
    ),
    dockY: viewport.height - 43,
    reduced: !!reduceMotion,
    restoring: transition === 'restore',
  };
  return (
    <Dialog.Root
      modal={false}
      open={!!page}
      onOpenChange={(open) => {
        if (!open) minimize();
      }}
    >
      <Dialog.Portal forceMount>
        <AnimatePresence custom={geometry}>
          {page && (
            <motion.div
              key='embedded-window'
              className='pointer-events-none fixed inset-x-0 bottom-0 top-9 z-[70]'
            >
              <motion.button
                type='button'
                tabIndex={-1}
                aria-label='Minimize active window'
                data-embedded-overlay
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, pointerEvents: 'auto' }}
                exit={{ opacity: 0, pointerEvents: 'none' }}
                transition={{ duration: reduceMotion ? 0 : 0.5 }}
                className='pointer-events-auto absolute inset-0 cursor-default border-0 bg-black/60 backdrop-blur-[2px]'
                onPointerDownCapture={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  minimize();
                }}
                onClick={minimize}
              />

              <Dialog.Content
                forceMount
                asChild
                aria-describedby={descriptionId}
                onFocusOutside={(event) => event.preventDefault()}
                onCloseAutoFocus={(event) => event.preventDefault()}
                onPointerDownOutside={(event) => {
                  event.preventDefault();
                  const target = event.detail.originalEvent.target;
                  if (
                    !(
                      target instanceof Element &&
                      target.closest('[data-slot=window-titlebar]')
                    )
                  )
                    minimize();
                }}
                onEscapeKeyDown={(event) => {
                  event.preventDefault();
                }}
              >
                <motion.div
                  className='pointer-events-auto absolute flex flex-col overflow-hidden rounded-xl border bg-background outline-none'
                  custom={geometry}
                  variants={windowMotion}
                  initial={
                    reduceMotion
                      ? false
                      : transition === 'restore'
                        ? 'circle'
                        : 'enter'
                  }
                  animate='open'
                  exit='minimized'
                  onAnimationComplete={(definition) => {
                    if (definition === 'open' && current.current)
                      setSurfaceReady(true);
                  }}
                  onUpdate={() =>
                    window.dispatchEvent(new Event('embedded:layout'))
                  }
                >
                  <TooltipProvider delayDuration={250}>
                    <motion.div
                      variants={windowContentsMotion}
                      className='flex min-h-0 flex-1 flex-col'
                      onPointerLeave={() => setExpanded(false)}
                      onPointerMove={(event) => {
                        if (
                          event.target instanceof Element &&
                          !event.target.closest(
                            '[data-window-bar], [data-window-stack]',
                          )
                        )
                          setExpanded(false);
                      }}
                    >
                      <motion.div
                        className='relative shrink-0 overflow-y-auto overflow-x-hidden'
                        initial={false}
                        animate={{ height: stackHeight }}
                        transition={{
                          duration: reduceMotion ? 0 : 0.16,
                          ease: 'easeOut',
                        }}
                        onPointerEnter={() => setExpanded(true)}
                        data-window-stack
                        aria-hidden={!expanded}
                        aria-label='Stacked windows'
                      >
                        <div
                          className='relative'
                          style={{
                            height:
                              visibleBehind.length * stripHeight,
                          }}
                        >
                          {visibleBehind.map((entry, index) => (
                            <button
                              key={entry.id}
                              type='button'
                              style={{
                                top: index * stripHeight,
                                left: Math.min(
                                  24,
                                  (visibleBehind.length - index) * 5,
                                ),
                                right: Math.min(
                                  24,
                                  (visibleBehind.length - index) * 5,
                                ),
                                zIndex: index + 1,
                              }}
                              className='absolute flex h-12 items-start gap-2 rounded-t-lg border bg-muted px-3 pt-0.5 text-left text-xs text-muted-foreground hover:bg-accent focus-visible:bg-accent focus-visible:outline-none'
                              onClick={() => {
                                setExpanded(false);
                                restore(entry.id, 'left');
                              }}
                            >
                              <span className='min-w-0 flex-1 truncate'>
                                {entry.title}
                              </span>
                              <span className='max-w-[40%] truncate'>
                                {pageDomain(entry.url)}
                              </span>
                            </button>
                          ))}
                        </div>
                      </motion.div>
                      <section className='flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-background'>
                        <header
                          data-window-bar
                          className='flex shrink-0 items-center gap-2 border-b bg-card px-3 py-2 sm:px-4'
                        >
                          <TooltipOne
                            content={shortcutHint(
                              'Previous page',
                              'previous',
                            )}
                          >
                            <Button
                              size='icon'
                              variant='ghost'
                              className='size-8 shrink-0'
                              disabled={groups.length < 2}
                              onClick={() => navigate('previous')}
                              aria-label='Previous page'
                            >
                              <ChevronLeft className='size-4' />
                            </Button>
                          </TooltipOne>
                          <TooltipOne
                            content={shortcutHint(
                              'Next page',
                              'next',
                            )}
                          >
                            <Button
                              size='icon'
                              variant='ghost'
                              className='size-8 shrink-0'
                              disabled={groups.length < 2}
                              onClick={() => navigate('next')}
                              aria-label='Next page'
                            >
                              <ChevronRight className='size-4' />
                            </Button>
                          </TooltipOne>
                          {layers.length > 1 && (
                            <Button
                              type='button'
                              size='sm'
                              variant='ghost'
                              className='h-8 shrink-0 gap-1 px-2'
                              aria-label='Show window stack'
                              aria-expanded={expanded}
                              onClick={() => setExpanded(true)}
                            >
                              <Layers className='size-4' />
                              <span className='text-xs'>
                                {layers.length}
                              </span>
                            </Button>
                          )}
                          <motion.div
                            key={`${page?.id}:${activation}`}
                            initial={
                              reduceMotion
                                ? false
                                : {
                                    x:
                                      transition === 'left'
                                        ? -20
                                        : transition === 'right'
                                          ? 20
                                          : 0,
                                    opacity:
                                      transition === 'left' ||
                                      transition === 'right'
                                        ? 0.6
                                        : 1,
                                  }
                            }
                            animate={{ x: 0, opacity: 1 }}
                            transition={{
                              duration: reduceMotion ? 0 : 0.18,
                              ease: [0.22, 1, 0.36, 1],
                            }}
                            className='min-w-0 flex-1'
                            onPointerEnter={() => setExpanded(true)}
                          >
                            <Dialog.Title className='flex items-center gap-2 truncate text-sm font-semibold'>
                              {page?.loading && (
                                <LoaderCircle className='size-3 shrink-0 motion-safe:animate-spin' />
                              )}
                              <span className='truncate'>
                                {page?.title}
                              </span>
                            </Dialog.Title>
                            <Dialog.Description
                              id={descriptionId}
                              className='truncate text-xs text-muted-foreground'
                            >
                              {page && pageDomain(page.url)}
                              {layers.length > 1
                                ? ` · Related pages ${layers.findIndex((p) => p.id === page?.id) + 1}/${layers.length}`
                                : ''}
                            </Dialog.Description>
                          </motion.div>
                          {layers.length > 1 && (
                            <>
                              <TooltipOne
                                content={shortcutHint(
                                  'Previous related page',
                                  'up',
                                )}
                              >
                                <Button
                                  size='icon'
                                  variant='ghost'
                                  className='size-8 shrink-0'
                                  onClick={() => navigate('up')}
                                  aria-label='Previous related page'
                                >
                                  <ArrowUp className='size-4' />
                                </Button>
                              </TooltipOne>
                              <TooltipOne
                                content={shortcutHint(
                                  'Next related page',
                                  'down',
                                )}
                              >
                                <Button
                                  size='icon'
                                  variant='ghost'
                                  className='size-8 shrink-0'
                                  onClick={() => navigate('down')}
                                  aria-label='Next related page'
                                >
                                  <ArrowDown className='size-4' />
                                </Button>
                              </TooltipOne>
                            </>
                          )}
                          <TooltipOne
                            content={shortcutHint(
                              'Minimize',
                              'minimize',
                            )}
                          >
                            <Button
                              size='icon'
                              variant='ghost'
                              className='size-8 shrink-0'
                              onClick={minimize}
                              ref={controls}
                              aria-label='Minimize page'
                            >
                              <Minus className='size-4' />
                            </Button>
                          </TooltipOne>
                          <TooltipOne
                            content={shortcutHint(
                              'Close this page',
                              'close',
                            )}
                          >
                            <Button
                              size='icon'
                              variant='ghost'
                              className='size-8 shrink-0 hover:bg-destructive/10 hover:text-destructive'
                              onClick={() => {
                                if (page) void close(page.id);
                              }}
                              aria-label='Close page'
                            >
                              <X className='size-4' />
                            </Button>
                          </TooltipOne>
                        </header>
                        {page && (
                          <EmbeddedContent
                            key={`${page.id}:${activation}`}
                            page={page}
                            transition={transition}
                            visible={surfaceReady}
                          />
                        )}
                      </section>
                    </motion.div>
                  </TooltipProvider>
                  <motion.div
                    aria-hidden
                    className='pointer-events-none absolute inset-0 bg-primary'
                    variants={windowCircleMotion}
                  />
                </motion.div>
              </Dialog.Content>
            </motion.div>
          )}
        </AnimatePresence>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
