'use client';
import { useVirtualizer } from '@tanstack/react-virtual';
import { invoke, isTauri } from '@tauri-apps/api/core';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  KeyRound,
  Plug,
  Send,
  Square,
  Terminal,
  Trash2,
  Unplug,
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
import PageHeader from '@/components/pageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { SelectField, SelectOption } from '@/components/ui/select';
import {
  displayBackupLine,
  findBackupAppliance,
} from '@/lib/backupManager';
import { initializeCredentials } from '@/lib/credentialStore';
import getCredentials from '@/lib/getCredentials';
import type {
  SshBlock,
  SshOutputPage,
  SshSession,
} from '@/lib/sshConsole';
import useDataSourceMode from '@/lib/useDataSourceMode';
import { cn } from '@/lib/utils';
import { getLocalStorage } from '@/lib/utilsClient';

const time = (value: string) => new Date(value).toLocaleTimeString();
function inputHint(session: SshSession) {
  if (session.inputMode === 'secret')
    return 'Password challenge · response is hidden and excluded from history';
  if (session.busy)
    return 'Interactive response · input stays with the running command';
  return session.prompt || 'Waiting for the appliance prompt';
}
function Output({
  session,
  block,
  ended,
}: {
  session: string;
  block: SshBlock;
  ended: boolean;
}) {
  const [page, setPage] = useState<SshOutputPage | null>(null);
  const [offsets, setOffsets] = useState([0]);
  const [error, setError] = useState('');
  const [copying, setCopying] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(!block.complete);
  const offset = following
    ? Math.max(0, block.bytes - 32768)
    : (offsets.at(-1) ?? 0);
  useEffect(() => {
    let active = true;
    void invoke<SshOutputPage>('read_ssh_output', {
      id: session,
      block: block.id,
      offset,
    })
      .then((value) => {
        if (active) {
          setPage(value);
          setError('');
        }
      })
      .catch((reason) => {
        if (active) setError(String(reason));
      });
    return () => {
      active = false;
    };
  }, [session, block.id, block.bytes, block.complete, ended, offset]);
  const lines = useMemo(
    () => (page?.text ?? '').split('\n').map(displayBackupLine),
    [page?.text],
  );
  const rows = useVirtualizer({
    count: lines.length,
    getScrollElement: () => viewport.current,
    estimateSize: () => 20,
    overscan: 8,
  });
  useEffect(() => {
    if (following && page)
      viewport.current?.scrollTo(0, viewport.current.scrollHeight);
  }, [page, following]);
  const copy = async () => {
    setCopying(true);
    try {
      // Explicit copy reads all pages; the normal renderer retains only one window.
      const parts: string[] = [];
      let cursor = 0;
      const end = block.bytes;
      while (cursor < end) {
        const value = await invoke<SshOutputPage>('read_ssh_output', {
          id: session,
          block: block.id,
          offset: cursor,
        });
        if (value.nextOffset <= cursor)
          throw new Error(
            'Output is not fully available yet. Try copying again.',
          );
        parts.push(value.text);
        cursor = value.nextOffset;
      }
      await navigator.clipboard.writeText(
        parts.join('').split('\n').map(displayBackupLine).join('\n'),
      );
      toast.success('Output copied.');
    } catch (reason) {
      toast.error(String(reason));
    } finally {
      setCopying(false);
    }
  };
  return (
    <div className='border-t'>
      <div className='flex flex-wrap items-center justify-between gap-2 bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground'>
        <span>
          {block.bytes.toLocaleString()} bytes ·{' '}
          {block.complete
            ? 'Complete'
            : ended
              ? 'Interrupted output'
              : 'Receiving output'}
        </span>
        <Button
          size='sm'
          variant='ghost'
          disabled={copying || !block.bytes}
          onClick={() => void copy()}
        >
          <Copy className='size-3.5' />
          {copying ? 'Copying…' : 'Copy output'}
        </Button>
      </div>
      {error && (
        <p role='alert' className='px-3 text-sm text-destructive'>
          {error}
        </p>
      )}
      <section
        ref={viewport}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Output must support keyboard scrolling.
        tabIndex={0}
        aria-label={`Output of ${block.command}`}
        className='overflow-auto bg-muted/15 font-mono text-xs focus-visible:ring-2 focus-visible:ring-ring'
        style={{
          height: Math.min(256, Math.max(40, lines.length * 20)),
        }}
      >
        <div
          className='relative min-w-full w-max'
          style={{ height: Math.max(40, rows.getTotalSize()) }}
        >
          {rows.getVirtualItems().map((row) => (
            <div
              key={row.key}
              className='absolute left-0 top-0 h-5 whitespace-pre px-3'
              style={{ transform: `translateY(${row.start}px)` }}
            >
              {lines[row.index] || ' '}
            </div>
          ))}
        </div>
      </section>
      <div className='flex items-center justify-between gap-2 border-t px-3 py-1 text-xs text-muted-foreground'>
        <span>
          {following
            ? 'Latest output'
            : `Output segment ${offsets.length}`}
          {page && page.total > 32768
            ? ' · Large output is loaded in segments'
            : ''}
        </span>
        <div className='flex gap-1'>
          <Button
            variant='ghost'
            size='sm'
            disabled={!following && offsets.length === 1}
            onClick={() => {
              setFollowing(false);
              setOffsets((values) =>
                following ? [0] : values.slice(0, -1),
              );
              viewport.current?.scrollTo(0, 0);
            }}
          >
            Previous
          </Button>
          <Button
            variant='ghost'
            size='sm'
            onClick={() => setFollowing((value) => !value)}
          >
            {following ? 'Pause' : 'Follow'}
          </Button>
          <Button
            variant='ghost'
            size='sm'
            disabled={
              following ||
              !page ||
              page.nextOffset >= page.total ||
              page.nextOffset <= offset
            }
            onClick={() => {
              if (page)
                setOffsets((values) => [...values, page.nextOffset]);
              viewport.current?.scrollTo(0, 0);
            }}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}

function SessionConsole({
  session,
  refresh,
}: {
  session: SshSession;
  refresh: () => Promise<void>;
}) {
  const inputHelpId = useId();
  const [value, setValue] = useState('');
  const [sensitive, setSensitive] = useState(false);
  const [sending, setSending] = useState(false);
  const [selected, setSelected] = useState(0);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const outputViewport = useRef<HTMLDivElement>(null);
  const historyViewport = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const previousCount = useRef(0);
  const [follow, setFollow] = useState(true);
  const rows = useVirtualizer({
    count: session.blocks.length,
    getScrollElement: () => outputViewport.current,
    estimateSize: () => 365,
    overscan: 2,
    getItemKey: (index) => session.blocks[index].id,
  });
  const history = useVirtualizer({
    count: session.blocks.length,
    getScrollElement: () => historyViewport.current,
    estimateSize: () => 64,
    overscan: 8,
  });
  const secret = sensitive || session.inputMode === 'secret';
  useEffect(() => {
    if (session.blocks.length > previousCount.current && follow) {
      rows.scrollToIndex(session.blocks.length - 1, {
        align: 'start',
      });
      history.scrollToIndex(session.blocks.length - 1, {
        align: 'end',
      });
      setSelected(session.blocks.at(-1)?.id ?? 0);
    }
    previousCount.current = session.blocks.length;
  }, [session.blocks.length, follow, rows, session.blocks]);
  useEffect(() => {
    setValue('');
    setSensitive(false);
  }, [session.inputMode === 'secret']);
  const jump = (index: number) => {
    setSelected(index);
    setFollow(false);
    setCollapsed((current) => {
      const next = new Set(current);
      next.delete(index);
      return next;
    });
    rows.scrollToIndex(index, { align: 'start' });
    history.scrollToIndex(index, { align: 'auto' });
  };
  const send = async () => {
    if (sending || !session.connected) return;
    if (new TextEncoder().encode(value).length > 1024 * 1024) {
      toast.error(
        'Input exceeds 1 MiB. Send the policy in smaller blocks and send EOF only when finished.',
      );
      return;
    }
    setSending(true);
    try {
      await invoke('send_ssh_input', {
        id: session.id,
        value,
        sensitive: secret,
      });
      setValue('');
      setSensitive(false);
      await refresh();
      input.current?.focus();
    } catch (reason) {
      toast.error(String(reason));
    } finally {
      setSending(false);
    }
  };
  const action = async (command: string) => {
    try {
      await invoke(command, { id: session.id });
      await refresh();
    } catch (reason) {
      toast.error(String(reason));
    }
  };
  return (
    <div className='grid min-h-0 flex-1 gap-3 lg:grid-cols-[260px_minmax(0,1fr)]'>
      <Card className='min-h-0 gap-0 overflow-hidden py-0'>
        <div className='flex items-center justify-between border-b p-3'>
          <h2 className='text-sm font-semibold'>Command history</h2>
          <Badge variant='secondary'>
            {Math.max(0, session.blocks.length - 1)}
          </Badge>
        </div>
        <section
          ref={historyViewport}
          className='min-h-0 flex-1 overflow-auto max-lg:max-h-24'
          aria-label='Command history'
        >
          <div
            className='relative'
            style={{ height: history.getTotalSize() }}
          >
            {history.getVirtualItems().map((row) => {
              const block = session.blocks[row.index];
              return (
                <button
                  key={block.id}
                  type='button'
                  aria-current={
                    selected === block.id ? 'true' : undefined
                  }
                  onClick={() => jump(row.index)}
                  className={cn(
                    'absolute left-0 top-0 flex h-16 w-full cursor-pointer flex-col justify-center gap-1 border-b px-3 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
                    selected === block.id && 'bg-accent',
                  )}
                  style={{ transform: `translateY(${row.start}px)` }}
                >
                  <span className='truncate font-mono text-xs'>
                    {block.command}
                  </span>
                  <span className='text-[11px] text-muted-foreground'>
                    {time(block.createdAt)} ·{' '}
                    {block.complete
                      ? 'Finished'
                      : session.connected
                        ? 'Running'
                        : 'Stopped'}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
        <p className='hidden border-t p-3 text-xs text-muted-foreground lg:block'>
          History stays available during this app run. Click a command
          to inspect its output.
        </p>
      </Card>
      <Card className='min-h-0 min-w-0 gap-0 overflow-hidden py-0'>
        <div className='flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2'>
          <div className='flex items-center gap-2 text-xs'>
            <Terminal className='size-4' />
            <span className='font-mono'>
              {session.mocked
                ? '127.0.0.1:2222'
                : `${session.address}:22`}
            </span>
            <Badge variant='outline'>{session.phase}</Badge>
          </div>
          <div className='flex items-center gap-1'>
            <Button
              variant={follow ? 'secondary' : 'ghost'}
              size='sm'
              onClick={() => {
                setFollow(true);
                jump(session.blocks.length - 1);
                setFollow(true);
              }}
            >
              Latest
            </Button>
            <Button
              variant='ghost'
              size='sm'
              disabled={!session.connected}
              onClick={() => void action('interrupt_ssh_console')}
            >
              <Square className='size-3' />
              Ctrl+C
            </Button>
            <Button
              variant='ghost'
              size='sm'
              disabled={['Disconnected', 'Failed'].includes(
                session.phase,
              )}
              onClick={() => void action('disconnect_ssh_console')}
            >
              <Unplug className='size-4' />
              Disconnect
            </Button>
          </div>
        </div>
        {session.error && (
          <p
            role='alert'
            className='border-b px-3 py-2 text-sm text-destructive'
          >
            {session.error}
          </p>
        )}
        <section
          ref={outputViewport}
          className='min-h-0 flex-1 overflow-auto'
          aria-label='SSH transcript'
        >
          <div
            className='relative w-full'
            style={{ height: rows.getTotalSize() }}
          >
            {rows.getVirtualItems().map((row) => {
              const block = session.blocks[row.index];
              const open = !collapsed.has(block.id);
              return (
                <div
                  key={row.key}
                  ref={rows.measureElement}
                  data-index={row.index}
                  className='absolute left-0 top-0 w-full px-3 pt-3 pb-1'
                  style={{ transform: `translateY(${row.start}px)` }}
                >
                  <section
                    className={cn(
                      'min-w-0 overflow-hidden rounded-lg border',
                      selected === block.id && 'border-primary/40',
                    )}
                  >
                    <button
                      type='button'
                      className='flex w-full cursor-pointer items-center gap-2 bg-muted/40 px-3 py-2 text-left'
                      aria-expanded={open}
                      aria-label={`${open ? 'Collapse' : 'Expand'} ${block.command}`}
                      onClick={() =>
                        setCollapsed((current) => {
                          const next = new Set(current);
                          if (next.has(block.id))
                            next.delete(block.id);
                          else next.add(block.id);
                          return next;
                        })
                      }
                    >
                      {open ? (
                        <ChevronDown className='size-4 shrink-0' />
                      ) : (
                        <ChevronRight className='size-4 shrink-0' />
                      )}
                      <span className='min-w-0 flex-1 truncate font-mono text-xs'>
                        {block.command}
                      </span>
                      <span className='shrink-0 text-[11px] text-muted-foreground'>
                        {time(block.createdAt)}
                      </span>
                    </button>
                    {open && (
                      <Output
                        session={session.id}
                        block={block}
                        ended={['Disconnected', 'Failed'].includes(
                          session.phase,
                        )}
                      />
                    )}
                  </section>
                </div>
              );
            })}
          </div>
        </section>
        <form
          className='shrink-0 space-y-2 border-t bg-card p-3'
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <div className='flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground'>
            <output>{inputHint(session)}</output>
            <Button
              type='button'
              size='sm'
              variant={secret ? 'secondary' : 'ghost'}
              aria-pressed={secret}
              disabled={session.inputMode === 'secret'}
              onClick={() => setSensitive((value) => !value)}
            >
              <KeyRound className='size-3.5' />
              Sensitive response
            </Button>
          </div>
          <div className='grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 [&>div]:min-w-0'>
            {secret ? (
              <Input
                ref={(element) => {
                  input.current = element;
                }}
                aria-label='SSH password response'
                type='password'
                value={value}
                maxLength={8192}
                onChange={(event) => setValue(event.target.value)}
                disabled={
                  !session.connected ||
                  sending ||
                  session.phase === 'Sending input'
                }
                autoComplete='off'
                className='min-w-0 font-mono'
                placeholder='Enter password…'
              />
            ) : (
              <textarea
                ref={(element) => {
                  input.current = element;
                }}
                aria-label='SSH command or response'
                aria-describedby={inputHelpId}
                rows={3}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                disabled={
                  !session.connected ||
                  sending ||
                  session.phase === 'Sending input'
                }
                autoComplete='off'
                spellCheck={false}
                className='border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 max-h-40 min-h-20 w-full min-w-0 resize-y rounded-md border bg-transparent px-3 py-2 font-mono text-sm outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50'
                placeholder={
                  session.busy
                    ? 'Paste policy content or reply to the appliance…'
                    : 'Enter command…'
                }
                onKeyDown={(event) => {
                  if (
                    event.key === 'Enter' &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    void send();
                  }
                  if (
                    event.ctrlKey &&
                    event.key.toLowerCase() === 'c' &&
                    !value
                  ) {
                    event.preventDefault();
                    void action('interrupt_ssh_console');
                  }
                }}
              />
            )}
            <Button
              type='submit'
              disabled={
                !session.connected ||
                sending ||
                session.phase === 'Sending input'
              }
            >
              <Send className='size-4' />
              Send
            </Button>
          </div>
          {!secret && (
            <p
              id={inputHelpId}
              className='text-xs text-muted-foreground'
            >
              Enter to send · Shift+Enter for a new line. Paste
              preserves line breaks; send EOF separately when ready.
            </p>
          )}
          {session.inputMode === 'response' && (
            <div className='flex gap-2'>
              <Button
                type='button'
                size='sm'
                variant='outline'
                onClick={() => {
                  void invoke('continue_ssh_console', {
                    id: session.id,
                  })
                    .then(refresh)
                    .catch((reason) => toast.error(String(reason)));
                }}
              >
                Continue / Space
              </Button>
            </div>
          )}
        </form>
      </Card>
    </div>
  );
}

export default function SshConsoleWorkspace({
  address,
}: {
  address: string;
}) {
  const { mode, ready } = useDataSourceMode();
  const [sessions, setSessions] = useState<SshSession[]>([]);
  const [selected, setSelected] = useState('');
  const [desktop, setDesktop] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [loadError, setLoadError] = useState('');
  const cache = useRef(new Map<string, SshSession>());
  const refresh = useCallback(async () => {
    const summaries = await invoke<
      (SshSession & { blockCount: number })[]
    >('list_ssh_sessions');
    const values = await Promise.all(
      summaries.map(async (summary) => {
        const previous = cache.current.get(summary.id);
        if (
          !previous ||
          previous.blocks.length !== summary.blockCount
        ) {
          return invoke<SshSession>('get_ssh_session', {
            id: summary.id,
          });
        }
        const blocks = previous.blocks.slice();
        const last = summary.blocks.at(-1);
        if (last) blocks[last.id] = last;
        return { ...summary, blocks };
      }),
    );
    cache.current = new Map(values.map((value) => [value.id, value]));
    setSessions(values);
    setLoadError('');
  }, []);
  useEffect(() => {
    if (!isTauri()) return;
    setDesktop(true);
    let disposed = false,
      pending = false;
    const poll = async () => {
      if (pending || disposed) return;
      pending = true;
      try {
        await refresh();
      } catch (error) {
        if (!disposed) setLoadError(String(error));
      } finally {
        pending = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 750);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [refresh]);
  const available = sessions.filter(
    (s) => s.address === address && s.mocked === (mode === 'mock'),
  );
  const session =
    available.find((s) => s.id === selected) ?? available[0];
  const connect = async () => {
    setConnecting(true);
    try {
      await initializeCredentials();
      const credentials = getCredentials();
      if (!credentials)
        throw new Error(
          'Save SSH credentials in Settings before connecting.',
        );
      const appliance =
        findBackupAppliance(
          getLocalStorage<Proxy[]>('proxies') ?? [],
          address,
        )?.hostname ?? address;
      const id = await invoke<string>('connect_ssh_console', {
        request: {
          appliance,
          address,
          username: credentials.username,
          password: credentials.password,
          mocked: mode === 'mock',
        },
      });
      setSelected(id);
      await refresh();
    } catch (reason) {
      toast.error(String(reason));
    } finally {
      setConnecting(false);
    }
  };
  return (
    <main className='mx-auto flex h-[calc(100dvh-90px)] min-h-[620px] w-full max-w-screen-2xl flex-col gap-4 p-4 md:p-5'>
      <PageHeader
        icon={Terminal}
        eyebrow='Proxy workspace'
        title='SSH console'
        description={`${address || 'No proxy selected'} · Persistent interactive sessions`}
        actions={
          <div className='flex items-center gap-2'>
            <Badge variant='outline'>
              {mode === 'mock' ? 'Mocked Data' : 'Live'}
            </Badge>
            <Button
              disabled={!desktop || !ready || !address || connecting}
              onClick={() => void connect()}
            >
              <Plug className='size-4' />
              New session
            </Button>
          </div>
        }
      />
      {!desktop && (
        <p className='text-sm text-muted-foreground'>
          SSH connections are available in the desktop application.
        </p>
      )}
      {loadError && (
        <p role='alert' className='text-sm text-destructive'>
          {loadError}
        </p>
      )}
      {available.length > 0 && (
        <div className='flex items-center gap-2'>
          <SelectField
            aria-label='SSH session'
            value={session?.id}
            onValueChange={setSelected}
            className='max-w-md'
          >
            {available.map((value) => (
              <SelectOption key={value.id} value={value.id}>
                {new Date(value.createdAt).toLocaleString()} ·{' '}
                {value.phase}
              </SelectOption>
            ))}
          </SelectField>
          <Button
            variant='ghost'
            size='sm'
            disabled={
              !session ||
              !['Disconnected', 'Failed'].includes(session.phase)
            }
            onClick={() => {
              if (session)
                void invoke('remove_ssh_session', { id: session.id })
                  .then(refresh)
                  .catch((reason) => toast.error(String(reason)));
            }}
          >
            <Trash2 className='size-4' />
            Remove session
          </Button>
        </div>
      )}
      {session ? (
        <SessionConsole
          key={session.id}
          session={session}
          refresh={refresh}
        />
      ) : (
        <Card className='flex flex-1 items-center justify-center p-8 text-center'>
          <Terminal className='size-8 text-muted-foreground' />
          <h2 className='text-lg font-semibold'>
            Connect to your appliance
          </h2>
          <p className='max-w-md text-sm text-muted-foreground'>
            Start a session using your saved SSH credentials. The
            connection stays active while you navigate the app.
            Outputs are stored in the app cache and loaded in small
            segments.
          </p>
          <Button
            disabled={!desktop || !ready || !address || connecting}
            onClick={() => void connect()}
          >
            Connect SSH
          </Button>
        </Card>
      )}
    </main>
  );
}
