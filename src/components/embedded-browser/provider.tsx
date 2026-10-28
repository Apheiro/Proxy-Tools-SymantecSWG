'use client';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { toast } from 'sonner';
import {
  adjacentPage,
  type EmbeddedAction,
  type EmbeddedOpenOptions,
  type EmbeddedPage,
  type EmbeddedSnapshot,
  type EmbeddedTransition,
  replacementForClose,
  shortcutAction,
} from '@/lib/embeddedBrowser';
import { useAppPreferences } from '@/lib/appPreferences';
import type { ShortcutAction } from '@/lib/shortcutBindings';
import EmbeddedDock from './dock';
import EmbeddedModal from './modal';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

type BrowserContext = {
  pages: EmbeddedPage[];
  activeId: string | null;
  transition: EmbeddedTransition;
  open: (options: EmbeddedOpenOptions) => Promise<void>;
  restore: (id: string, transition?: EmbeddedTransition) => void;
  minimize: () => void;
  close: (id: string) => Promise<void>;
  navigate: (action: EmbeddedAction) => void;
  nextPresentation: () => number;
  frontOrder: string[];
  activation: number;
  restoreGroup: (groupId: string) => void;
};
const Context = createContext<BrowserContext | null>(null);
export function useEmbeddedBrowser() {
  const context = useContext(Context);
  if (!context)
    throw new Error('EmbeddedBrowserProvider is required.');
  return context;
}
export default function EmbeddedBrowserProvider({
  children,
}: {
  children: ReactNode;
}) {
  const preferences = useAppPreferences();
  const [pages, setPages] = useState<EmbeddedPage[]>([]);
  const [authenticationError, setAuthenticationError] = useState<{
    title: string;
    message: string;
  } | null>(null);
  const [activation, setActivation] = useState(0);
  const [frontOrder, setFrontOrder] = useState<string[]>([]);
  const closing = useRef(new Set<string>());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [transition, setTransition] =
    useState<EmbeddedTransition>('open');
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const activeRef = useRef(activeId);
  activeRef.current = activeId;
  const revision = useRef(-1);
  const presentation = useRef(Date.now() * 1000);
  const lastActive = useRef<Record<string, string>>({});
  const returnFocus = useRef<HTMLElement | null>(null);
  const opening = useRef(0);
  const nativeOpened = useRef(new Set<string>());
  const mounted = useRef(true);
  const nextPresentation = useCallback(
    () => ++presentation.current,
    [],
  );
  const restore = useCallback(
    (id: string, motion: EmbeddedTransition = 'restore') => {
      if (!activeRef.current)
        returnFocus.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
      activeRef.current = id;
      const page = pagesRef.current.find((p) => p.id === id);
      if (page) lastActive.current[page.groupId] = id;
      setFrontOrder((order) => [
        ...order.filter((value) => value !== id),
        id,
      ]);
      setActivation((value) => value + 1);
      setTransition(motion);
      setActiveId(id);
    },
    [],
  );
  const minimize = useCallback(() => {
    if (!activeRef.current) return;
    opening.current++;
    activeRef.current = null;
    setActiveId(null);
    if (isTauri())
      void invoke('embedded_hide', {
        revision: nextPresentation(),
      }).catch((error) =>
        toast.error(`Could not hide page: ${String(error)}`),
      );
    requestAnimationFrame(() => {
      if (returnFocus.current?.isConnected)
        returnFocus.current.focus();
      else
        document
          .querySelector<HTMLButtonElement>('[data-embedded-restore]')
          ?.focus();
    });
  }, [nextPresentation]);
  const applySnapshot = useCallback(
    (snapshot: EmbeddedSnapshot) => {
      if (!snapshot || snapshot.revision < revision.current) return;
      snapshot = {
        ...snapshot,
        pages: snapshot.pages.filter(
          (page) => !closing.current.has(page.id),
        ),
      };
      const before = pagesRef.current;
      const closed =
        activeRef.current &&
        !snapshot.pages.some((p) => p.id === activeRef.current)
          ? activeRef.current
          : null;
      const replacement = closed
        ? replacementForClose(before, closed)
        : null;
      revision.current = snapshot.revision;
      pagesRef.current = snapshot.pages;
      setPages(snapshot.pages);
      if (closed) {
        if (
          replacement &&
          snapshot.pages.some((p) => p.id === replacement)
        )
          restore(replacement, 'left');
        else minimize();
      }
    },
    [restore, minimize],
  );
  const navigate = useCallback(
    (action: EmbeddedAction) => {
      if (!activeRef.current) return;
      if (action === 'minimize') {
        minimize();
        return;
      }
      const target = adjacentPage(
        pagesRef.current,
        activeRef.current,
        action,
        lastActive.current,
      );
      if (target && target !== activeRef.current)
        restore(
          target,
          action === 'previous' || action === 'up' ? 'left' : 'right',
        );
    },
    [minimize, restore],
  );
  const open = useCallback(
    async (options: EmbeddedOpenOptions) => {
      if (!isTauri()) {
        toast.info(
          'Embedded pages are available in the desktop application.',
        );
        return;
      }
      // The native manager reuses matching URLs, including concurrent open requests.
      const request = ++opening.current;
      try {
        const page = await invoke<EmbeddedPage>('embedded_open', {
          ...options,
          authentication: options.authentication ?? null,
        });
        if (!mounted.current || closing.current.has(page.id)) return;
        if (!pagesRef.current.some((p) => p.id === page.id)) {
          pagesRef.current = [...pagesRef.current, page];
          setPages(pagesRef.current);
        }
        if (
          request === opening.current &&
          !nativeOpened.current.has(page.id)
        )
          restore(page.id, 'open');
      } catch (error) {
        if (mounted.current)
          toast.error(
            `Could not open embedded page: ${String(error)}`,
          );
      }
    },
    [restore],
  );
  const restoreGroup = useCallback(
    (groupId: string) => {
      const members = pagesRef.current.filter(
        (page) => page.groupId === groupId,
      );
      const remembered = members.find(
        (page) => page.id === lastActive.current[groupId],
      );
      const target =
        remembered ??
        members.toSorted(
          (a, b) =>
            frontOrder.indexOf(b.id) - frontOrder.indexOf(a.id),
        )[0] ??
        members.find((page) => page.id === groupId) ??
        members[0];
      if (target) restore(target.id);
    },
    [restore, frontOrder],
  );
  const close = useCallback(
    async (id: string) => {
      if (closing.current.has(id)) return;
      const removed = pagesRef.current.find((page) => page.id === id);
      if (!removed) return;
      closing.current.add(id);
      opening.current++;
      const replacement = replacementForClose(pagesRef.current, id);
      const wasActive = activeRef.current === id;
      pagesRef.current = pagesRef.current.filter(
        (page) => page.id !== id,
      );
      setPages(pagesRef.current);
      if (wasActive) {
        if (isTauri())
          void invoke('embedded_hide', {
            revision: nextPresentation(),
          }).catch(() => {});
        if (replacement) restore(replacement, 'left');
        else minimize();
      }
      try {
        await invoke('embedded_close', { id });
      } catch (error) {
        closing.current.delete(id);
        if (!pagesRef.current.some((page) => page.id === id)) {
          pagesRef.current = [...pagesRef.current, removed];
          setPages(pagesRef.current);
        }
        if (wasActive) restore(id);
        toast.error(`Could not close page: ${String(error)}`);
      }
    },
    [minimize, restore, nextPresentation],
  );
  useEffect(() => {
    mounted.current = true;
    if (!isTauri())
      return () => {
        mounted.current = false;
      };
    let disposed = false;
    const listeners: UnlistenFn[] = [];
    const subscribe = async <T,>(
      name: string,
      handle: (payload: T) => void,
    ) => {
      const off = await listen<T>(name, (event) => {
        if (!disposed) handle(event.payload);
      });
      if (disposed) off();
      else listeners.push(off);
    };
    void (async () => {
      await subscribe<EmbeddedSnapshot>(
        'embedded:changed',
        applySnapshot,
      );
      await subscribe<EmbeddedPage>('embedded:opened', (page) => {
        if (closing.current.has(page.id)) return;
        nativeOpened.current.add(page.id);
        if (!pagesRef.current.some((p) => p.id === page.id)) {
          pagesRef.current = [...pagesRef.current, page];
          setPages(pagesRef.current);
        }
        restore(page.id, page.parentId ? 'child' : 'open');
      });
      await subscribe<EmbeddedPage>('embedded:restore', (page) => {
        if (closing.current.has(page.id)) return;
        nativeOpened.current.add(page.id);
        if (!pagesRef.current.some((value) => value.id === page.id)) {
          pagesRef.current = [...pagesRef.current, page];
          setPages(pagesRef.current);
        }
        if (activeRef.current === page.id) {
          void invoke('embedded_focus', { id: page.id }).catch(
            () => {},
          );
        } else {
          restore(page.id, activeRef.current ? 'right' : 'restore');
        }
      });
      await subscribe<{ id: string; action: ShortcutAction }>(
        'embedded:shortcut',
        (value) => {
          if (value.id !== activeRef.current) return;
          if (value.action === 'close') void close(value.id);
          else navigate(value.action);
        },
      );
      await subscribe<string>('embedded:error', (message) =>
        toast.error(message),
      );
      await subscribe<{ id: string; message: string }>(
        'embedded:authentication-error',
        (failure) => {
          const title = pagesRef.current.find((page) => page.id === failure.id)?.title ?? 'Proxy page';
          // Native webviews draw above HTML. Hide them before presenting the
          // alert, and destroy only the failed page to end its auth loop.
          minimize();
          void (async () => {
            try {
              let cleanupMessage = 'The proxy site session was cleared before closing.';
              try {
                await invoke('embedded_reset_session', { id: failure.id });
              } catch (error) {
                cleanupMessage = `The page was closed, but session cleanup could not be completed: ${String(error)}`;
              }
              await close(failure.id);
              await invoke('embedded_hide', { revision: nextPresentation() });
              if (!disposed) setAuthenticationError({ title, message: `${failure.message} ${cleanupMessage}` });
            } catch (error) {
              if (!disposed) toast.error(`Could not display authentication error: ${String(error)}`);
            }
          })();
        },
      );
      const snapshot =
        await invoke<EmbeddedSnapshot>('embedded_list');
      if (!disposed) applySnapshot(snapshot);
    })().catch((error) => {
      if (!disposed)
        toast.error(
          `Embedded page manager unavailable: ${String(error)}`,
        );
    });
    return () => {
      disposed = true;
      mounted.current = false;
      for (const off of listeners) off();
    };
  }, [applySnapshot, restore, navigate, close, nextPresentation]);
  useEffect(() => {
    if (!activeId) return;
    const key = (event: KeyboardEvent) => {
      const action = shortcutAction(event, preferences.shortcuts);
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      if (action === 'close') {
        if (activeRef.current) void close(activeRef.current);
      } else navigate(action);
    };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, [activeId, navigate, close, preferences.shortcuts]);
  useEffect(() => {
    if (!isTauri()) return;
    void invoke('embedded_set_shortcuts', {
      bindings: preferences.shortcuts,
    }).catch((error) =>
      toast.error(
        `Could not apply window shortcuts: ${String(error)}`,
      ),
    );
  }, [preferences.shortcuts]);
  const value = {
    pages,
    activeId,
    transition,
    open,
    restore,
    minimize,
    close,
    navigate,
    nextPresentation,
    frontOrder,
    activation,
    restoreGroup,
  };
  return (
    <Context.Provider value={value}>
      <div
        className='flex h-full min-h-0 min-w-0 flex-1 flex-col'
        inert={!!activeId}
        aria-hidden={activeId ? true : undefined}
      >
        {children}
      </div>
      <EmbeddedModal />
      <EmbeddedDock />
      <AlertDialog open={!!authenticationError} onOpenChange={(open) => {
        if (!open) setAuthenticationError(null);
      }}>
        <AlertDialogContent className='z-[111]' overlayClassName='z-[110]'>
          <AlertDialogHeader>
            <AlertDialogTitle>Proxy authentication failed</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className='space-y-2'>
                <p className='break-words font-medium text-foreground'>{authenticationError?.title}</p>
                <p>{authenticationError?.message}</p>
                <p>The failed page has been closed to stop further attempts.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction>Understood</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Context.Provider>
  );
}
