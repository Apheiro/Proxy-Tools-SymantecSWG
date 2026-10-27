/** biome-ignore-all lint/correctness/useUniqueElementIds: <> */
/** biome-ignore-all lint/style/useNamingConvention: <> */
/** biome-ignore-all lint/a11y/noStaticElementInteractions: <> */
'use client';
import { Tabs } from 'radix-ui';
import { invoke } from '@tauri-apps/api/core';
import {
  Activity,
  Archive,
  ArrowUpRight,
  FileText,
  Network,
  ShieldCheck,
} from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import PageHeader from '@/components/pageHeader';
import BackgroundRefresh from '@/components/backgroundRefresh';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import getCredentials from '@/lib/getCredentials';
import { useScrapedData } from '@/lib/scrapingCache';
import useDataSourceMode from '@/lib/useDataSourceMode';
import { cva } from '@/lib/cva';
import { refreshStyles } from '@/lib/uiVariants';

const policyFileStyles = cva({
  base: 'flex min-w-0 items-center gap-2 rounded-md px-2 py-2 text-left text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
  variants: {
    selected: {
      true: 'bg-accent font-medium text-accent-foreground',
      false: 'text-muted-foreground',
    },
  },
});

export default function Page() {
  return (
    <Suspense fallback={<div>Loading</div>}>
      <PageBase />
    </Suspense>
  );
}

type HtmlData = {
  filesLink: FileLink[];
  traces: Trace[];
};

type FileLink = {
  name: string;
  content: string;
};

type Trace = {
  trace: string;
  url: string;
};

function linesOnText(text: string) {
  if (!text) return '';
  const lines = text.split('\n');
  const totalLines =
    lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
  let resultado = '';
  for (let i = 0; i < totalLines; i++) {
    resultado += `${i + 1}\n`;
  }
  return resultado;
}

type DiagnosticsView = {
  tab: 'traces' | 'policies';
  file: string | null;
};
// Keep navigation context for this session, separately for each proxy/profile.
const diagnosticsViews = new Map<string, DiagnosticsView>();

function PageBase() {
  const searchParams = useSearchParams();
  const { mode, ready: modeReady } = useDataSourceMode();
  const proxy = searchParams.get('proxy') || '';
  const viewKey = JSON.stringify([mode, proxy]);
  const [viewState, setViewState] = useState<{
    key: string;
    view: DiagnosticsView;
  } | null>(null);
  const view =
    viewState?.key === viewKey
      ? viewState.view
      : (diagnosticsViews.get(viewKey) ?? {
          tab: 'traces' as const,
          file: null,
        });
  const updateView = (patch: Partial<DiagnosticsView>) => {
    const next = { ...view, ...patch };
    diagnosticsViews.set(viewKey, next);
    setViewState({ key: viewKey, view: next });
  };
  const load = useCallback(() => {
    const credentials = getCredentials();
    if (!proxy) return Promise.reject('No proxy selected.');
    if (mode === 'live' && !credentials)
      return Promise.reject('Credentials not found.');
    return invoke<HtmlData>('get_html_data', {
      ippr: proxy,
      userpr: mode === 'live' ? (credentials?.username ?? '') : '',
      passpr: mode === 'live' ? (credentials?.password ?? '') : '',
      useMockData: mode === 'mock',
    });
  }, [proxy, mode]);
  const {
    data: htmlData,
    busy,
    error,
  } = useScrapedData(
    JSON.stringify(['policy', proxy, mode]),
    modeReady,
    load,
  );
  const loadStatus = htmlData ? 'loaded' : busy ? 'loading' : 'error';
  const policyFileSelected =
    htmlData?.filesLink.find((file) => file.name === view.file) ??
    null;
  useEffect(() => {
    if (error)
      toast.error(`Could not update policy and trace data: ${error}`);
  }, [error]);

  return (
    <main
      aria-busy={busy}
      className={refreshStyles({
        refreshing: busy && !!htmlData,
        className:
          'mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-5 md:px-6',
      })}
    >
      <BackgroundRefresh
        active={busy}
        label={
          htmlData
            ? 'Updating policy and trace data…'
            : 'Loading policy and trace data…'
        }
      />
      <PageHeader
        icon={ShieldCheck}
        eyebrow='Proxy diagnostics'
        title={proxy || 'No proxy selected'}
        description='Browse policy files and open an available trace.'
        actions={
          loadStatus === 'loaded' && (
            <div className='flex gap-2'>
              <Badge variant='secondary'>
                {htmlData?.traces.length ?? 0} traces
              </Badge>
              <Badge variant='secondary'>
                {htmlData?.filesLink.length ?? 0} policy files
              </Badge>
            </div>
          )
        }
      />

      <nav
        aria-label='Diagnostic tools'
        className='grid gap-3 sm:grid-cols-2'
      >
        {[
          {
            path: 'TrafficAnalysis',
            title: 'Traffic Analysis',
            description:
              'Access logs, bandwidth and traffic insights.',
            icon: Activity,
          },
          {
            path: 'BackupManager',
            title: 'Backup Manager',
            description: 'Create and browse configuration backups.',
            icon: Archive,
          },
        ].map(({ path, title, description, icon: Icon }) => (
          <Link
            key={path}
            href={{
              pathname: `/Diagnostics/${path}`,
              query: { proxy },
            }}
            className='group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
          >
            <Card className='h-full flex-row items-center gap-3 p-3 transition-colors group-hover:border-primary/40 group-hover:bg-accent/40'>
              <span className='flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary'>
                <Icon className='size-4' />
              </span>
              <div className='min-w-0 flex-1'>
                <h2 className='text-sm font-semibold'>{title}</h2>
                <p className='mt-0.5 text-xs text-muted-foreground'>
                  {description}
                </p>
              </div>
              <ArrowUpRight className='size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground' />
            </Card>
          </Link>
        ))}
      </nav>

      <Tabs.Root
        value={view.tab}
        onValueChange={(tab) => {
          if (tab === 'traces' || tab === 'policies')
            updateView({ tab });
        }}
        className='min-w-0'
      >
        <Tabs.List
          aria-label='Proxy diagnostic data'
          className='mb-3 flex gap-1 rounded-lg border bg-muted/40 p-1'
        >
          {[
            {
              value: 'traces',
              label: 'Policy Traces',
              count: htmlData?.traces.length ?? 0,
              icon: Activity,
            },
            {
              value: 'policies',
              label: 'Policy Files',
              count: htmlData?.filesLink.length ?? 0,
              icon: FileText,
            },
          ].map(({ value, label, count, icon: Icon }) => (
            <Tabs.Trigger
              key={value}
              value={value}
              className='flex min-w-0 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:bg-background data-[state=active]:text-foreground'
            >
              <Icon className='size-4 shrink-0' />
              {label}
              <Badge
                variant='secondary'
                className='px-1.5 py-0 text-[10px]'
              >
                {count}
              </Badge>
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <Tabs.Content
          value='traces'
          className='outline-none focus-visible:ring-2 focus-visible:ring-ring'
        >
          <Card className='gap-0 overflow-hidden py-0'>
            <div className='border-b px-4 py-3 text-xs text-muted-foreground'>
              Select a trace to inspect its transactions.
            </div>
            {loadStatus === 'loading' ? (
              <p
                role='status'
                className='p-8 text-center text-sm text-muted-foreground'
              >
                Loading proxy data…
              </p>
            ) : loadStatus === 'error' ? (
              <p
                role='alert'
                className='p-8 text-center text-sm text-muted-foreground'
              >
                Could not load proxy data. Check the connection or
                reopen this page.
              </p>
            ) : htmlData?.traces.length ? (
              <ScrollArea className='h-[clamp(240px,55dvh,640px)]'>
                <div className='divide-y'>
                  {htmlData.traces.map((trace) => (
                    <Link
                      key={trace.url}
                      href={{
                        pathname: '/Diagnostics/Trace',
                        query: { traceUrl: trace.url, proxy },
                      }}
                      className='group flex min-w-0 items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring'
                    >
                      <Activity className='size-4 shrink-0 text-muted-foreground' />
                      <span
                        className='min-w-0 flex-1 truncate text-sm font-medium'
                        title={trace.trace}
                      >
                        {trace.trace}
                      </span>
                      <span className='hidden text-xs text-muted-foreground sm:inline'>
                        View transactions
                      </span>
                      <ArrowUpRight className='size-4 shrink-0 text-muted-foreground group-hover:text-foreground' />
                    </Link>
                  ))}
                </div>
              </ScrollArea>
            ) : (
              <p className='p-8 text-center text-sm text-muted-foreground'>
                No traces are available for this proxy.
              </p>
            )}
          </Card>
        </Tabs.Content>

        <Tabs.Content
          value='policies'
          className='outline-none focus-visible:ring-2 focus-visible:ring-ring'
        >
          <Card className='gap-0 overflow-hidden py-0'>
            <div className='flex min-w-0 items-center gap-2 border-b px-4 py-3 text-xs text-muted-foreground'>
              <FileText className='size-4 shrink-0' />
              <span className='truncate'>
                {policyFileSelected?.name ??
                  'Select a policy file to preview its contents.'}
              </span>
            </div>
            <div className='grid min-w-0 grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)]'>
              <nav
                aria-label='Policy files'
                className='min-w-0 border-b p-2 md:border-b-0 md:border-r'
              >
                <ScrollArea className='h-40 md:h-[clamp(280px,55dvh,640px)]'>
                  {loadStatus === 'loading' ? (
                    <p
                      role='status'
                      className='p-3 text-sm text-muted-foreground'
                    >
                      Loading files…
                    </p>
                  ) : loadStatus === 'error' ? (
                    <p className='p-3 text-sm text-muted-foreground'>
                      Could not load policy files.
                    </p>
                  ) : htmlData?.filesLink.length ? (
                    <div className='flex flex-col gap-1'>
                      {htmlData.filesLink.map((file) => (
                        <button
                          key={file.name}
                          type='button'
                          aria-pressed={
                            policyFileSelected?.name === file.name
                          }
                          title={file.name}
                          onClick={() =>
                            updateView({ file: file.name })
                          }
                          className={policyFileStyles({
                            selected:
                              policyFileSelected?.name === file.name,
                          })}
                        >
                          <FileText className='size-4 shrink-0' />
                          <span className='truncate'>
                            {file.name}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className='p-3 text-sm text-muted-foreground'>
                      No policy files found.
                    </p>
                  )}
                </ScrollArea>
              </nav>
              <div className='min-w-0 p-3'>
                {policyFileSelected?.content ? (
                  <ScrollArea
                    orientation='both'
                    className='h-[clamp(280px,55dvh,640px)] w-full rounded-md border bg-muted/20'
                  >
                    <div className='flex min-w-max gap-4 p-4 font-mono text-xs leading-6'>
                      <pre
                        aria-hidden='true'
                        className='select-none border-r pr-3 text-right text-muted-foreground'
                      >
                        {linesOnText(policyFileSelected.content)}
                      </pre>
                      <pre
                        tabIndex={0}
                        aria-label={`Contents of ${policyFileSelected.name}`}
                        className='whitespace-pre'
                      >
                        {policyFileSelected.content}
                      </pre>
                    </div>
                  </ScrollArea>
                ) : (
                  <div className='flex h-[clamp(280px,55dvh,640px)] flex-col items-center justify-center gap-3 rounded-md border border-dashed px-6 text-center text-sm text-muted-foreground'>
                    <Network className='size-6' />
                    <p>
                      {policyFileSelected
                        ? 'This file has no content to display.'
                        : 'Select a policy file to preview its contents.'}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </Card>
        </Tabs.Content>
      </Tabs.Root>
    </main>
  );
}
