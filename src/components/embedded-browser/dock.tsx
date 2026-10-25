'use client';
import * as Popover from '@radix-ui/react-popover';
import {
  AnimatePresence,
  motion,
  useReducedMotion,
} from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { pageDomain, type EmbeddedPage } from '@/lib/embeddedBrowser';
import { useEmbeddedBrowser } from './provider';

function WindowGroup({
  groupId,
  members,
  index,
}: {
  groupId: string;
  members: EmbeddedPage[];
  index: number;
}) {
  const { restore, restoreGroup, activeId } = useEmbeddedBrowser();
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const choices = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const dismiss = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setOpen(false);
  };
  useEffect(() => {
    if (activeId) dismiss();
  }, [activeId]);
  useEffect(() => {
    if (!open) return;
    const blur = () => dismiss();
    window.addEventListener('blur', blur);
    return () => window.removeEventListener('blur', blur);
  }, [open]);
  const root =
    members.find((page) => page.id === groupId) ?? members[0];
  const show = () => {
    if (activeId) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setOpen(true);
  };
  const hide = () => {
    if (timer.current) return;
    timer.current = setTimeout(dismiss, 140);
  };
  return (
    <Popover.Root
      open={open && !activeId}
      onOpenChange={(value) => {
        if (!value) dismiss();
        else show();
      }}
      modal={false}
    >
      <Popover.Anchor asChild>
        <button
          type='button'
          data-embedded-restore
          ref={anchor}
          aria-label={`Restore ${root.title} · ${members.length} windows`}
          aria-haspopup='dialog'
          aria-expanded={open}
          onPointerEnter={show}
          onPointerLeave={hide}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              show();
              requestAnimationFrame(() =>
                choices.current
                  ?.querySelector<HTMLButtonElement>('button')
                  ?.focus(),
              );
            }
          }}
          onClick={() => {
            dismiss();
            restoreGroup(groupId);
          }}
          className='group relative flex size-9 shrink-0 items-center justify-center rounded-full outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring'
        >
          <span
            className={`size-2.5 rounded-full bg-primary transition-transform group-hover:scale-125 ${members.some((page) => page.loading) ? 'motion-safe:animate-pulse' : ''}`}
          />
          {members.length > 1 && (
            <span className='absolute right-0 top-0 flex min-w-3.5 items-center justify-center rounded-full bg-muted px-0.5 text-[9px] font-semibold'>
              {members.length - 1}
            </span>
          )}
        </button>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          ref={popup}
          aria-label={`Windows for ${root.title}`}
          side='top'
          sideOffset={8}
          collisionPadding={12}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onBlurCapture={(event) => {
            const target = event.relatedTarget;
            if (
              !(target instanceof Node) ||
              (!popup.current?.contains(target) &&
                !anchor.current?.contains(target))
            )
              dismiss();
          }}
          onPointerEnter={show}
          onPointerLeave={hide}
          onFocusCapture={() => {
            if (timer.current) clearTimeout(timer.current);
            timer.current = null;
          }}
          className='z-[90] w-72 max-w-[calc(100vw-2rem)] rounded-lg border bg-popover p-1.5 text-popover-foreground outline-none'
        >
          <p className='truncate border-b px-2 py-1.5 text-xs font-medium'>
            {root.title}
          </p>
          <div
            ref={choices}
            className='max-h-[40vh] overflow-y-auto py-1'
          >
            {members.map((page, childIndex) => (
              <button
                key={page.id}
                type='button'
                onClick={() => {
                  dismiss();
                  restore(page.id);
                }}
                className='flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-xs hover:bg-accent focus-visible:bg-accent focus-visible:outline-none'
              >
                <span className='shrink-0 font-mono text-muted-foreground'>
                  {childIndex
                    ? `${index + 1}.${childIndex}`
                    : index + 1}
                </span>
                <span className='min-w-0'>
                  <span className='block truncate font-medium'>
                    {page.title}
                  </span>
                  <span className='block truncate text-muted-foreground'>
                    {pageDomain(page.url)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
export default function EmbeddedDock() {
  const { pages, activeId } = useEmbeddedBrowser();
  const reduceMotion = useReducedMotion();
  const groups = [...new Set(pages.map((page) => page.groupId))];
  return (
    <AnimatePresence>
      {pages.length > 0 && !activeId && (
        <motion.nav
          key='window-dock'
          initial={reduceMotion ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0, pointerEvents: 'auto' }}
          exit={{
            opacity: 0,
            y: reduceMotion ? 0 : 4,
            pointerEvents: 'none',
          }}
          transition={{
            duration: reduceMotion ? 0 : 0.14,
            ease: 'easeOut',
          }}
          aria-label='Minimized pages'
          className='fixed bottom-5 left-1/2 z-[65] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-full border bg-card/95 px-2 py-1 backdrop-blur'
        >
          {groups.map((groupId, index) => (
            <WindowGroup
              key={groupId}
              groupId={groupId}
              members={pages.filter(
                (page) => page.groupId === groupId,
              )}
              index={index}
            />
          ))}
        </motion.nav>
      )}
    </AnimatePresence>
  );
}
