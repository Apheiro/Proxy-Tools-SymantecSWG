/** biome-ignore-all lint/correctness/useUniqueElementIds: <> */
/** biome-ignore-all lint/style/useNamingConvention: <> */
/** biome-ignore-all lint/a11y/noStaticElementInteractions: <> */
'use client';
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
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import getCredentials from '@/lib/getCredentials';
import { useScrapedData } from '@/lib/scrapingCache';
import useDataSourceMode from '@/lib/useDataSourceMode';
import { cva } from '@/lib/cva';
import { refreshStyles } from '@/lib/uiVariants';

const policyFileStyles = cva({
  base: 'flex min-w-0 items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-accent',
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

function PageBase() {
  const searchParams = useSearchParams();
  const [policySelection, setPolicyFileSelected] =
    useState<FileLink | null>(null);
  const { mode, ready: modeReady } = useDataSourceMode();
  const proxy = searchParams.get('proxy') || '';
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
    htmlData?.filesLink.find(
      (file) => file.name === policySelection?.name,
    ) ?? null;
  useEffect(() => {
    if (error)
      toast.error(`Could not update policy and trace data: ${error}`);
  }, [error]);
  useEffect(() => {
    setPolicyFileSelected((previous) =>
      previous
        ? (htmlData?.filesLink.find(
            (file) => file.name === previous.name,
          ) ?? null)
        : null,
    );
  }, [htmlData]);

  return (
    <main
      aria-busy={busy}
      className={refreshStyles({
        refreshing: busy && !!htmlData,
        className:
          'mx-auto flex min-h-dvh w-full max-w-7xl flex-col gap-8 px-4 py-6 md:px-6',
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

      <Link
        href={{
          pathname: '/Diagnostics/TrafficAnalysis',
          query: { proxy },
        }}
        className='group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
      >
        <Card className='gap-3 border-primary/20 bg-primary/[0.03] p-4 transition-colors group-hover:border-primary/50 group-hover:bg-primary/[0.06]'>
          <div className='flex items-center justify-between gap-4'>
            <div className='flex items-center gap-3'>
              <span className='flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary'>
                <Activity className='size-5' />
              </span>
              <div>
                <h2 className='font-semibold'>Traffic Analysis</h2>
                <p className='mt-1 text-sm text-muted-foreground'>
                  Explore access log traffic, bandwidth, top talkers,
                  and detected issues.
                </p>
              </div>
            </div>
            <span className='flex items-center gap-2 text-sm font-medium text-primary'>
              Open analysis{' '}
              <ArrowUpRight className='size-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5' />
            </span>
          </div>
        </Card>
      </Link>

      <Link
        href={{
          pathname: '/Diagnostics/BackupManager',
          query: { proxy },
        }}
        className='group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
      >
        <Card className='gap-3 p-4 transition-colors group-hover:border-primary/50 group-hover:bg-accent/40'>
          <div className='flex items-center justify-between gap-4'>
            <div className='flex items-center gap-3'>
              <Archive className='size-5' />
              <div>
                <h2 className='font-semibold'>Backup Manager</h2>
                <p className='mt-1 text-sm text-muted-foreground'>
                  Create and browse appliance configuration backups
                  over SSH.
                </p>
              </div>
            </div>
            <ArrowUpRight className='size-4' />
          </div>
        </Card>
      </Link>

      <section
        className='flex flex-col gap-4'
        aria-labelledby='traces-title'
      >
        <div className='flex items-end justify-between gap-3'>
          <div>
            <h2 id='traces-title' className='text-xl font-semibold'>
              Available traces
            </h2>
            <p className='mt-1 text-sm text-muted-foreground'>
              Select a trace to inspect its transactions.
            </p>
          </div>
          {loadStatus === 'loaded' && (
            <Badge variant='outline'>
              {htmlData?.traces.length ?? 0}
            </Badge>
          )}
        </div>

        {loadStatus === 'loading' ? (
          <div className='rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground'>
            Loading proxy data…
          </div>
        ) : loadStatus === 'error' ? (
          <div className='rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground'>
            Could not load proxy data. Check the connection or reopen
            this page.
          </div>
        ) : htmlData?.traces.length ? (
          <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3'>
            {htmlData.traces.map((trace) => (
              <Link
                key={trace.trace}
                href={{
                  pathname: '/Diagnostics/Trace',
                  query: {
                    traceUrl: trace.url,
                    proxy,
                  },
                }}
                className='group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
              >
                <Card className='h-full gap-3 p-4 transition-colors group-hover:border-primary/40 group-hover:bg-accent/40'>
                  <div className='flex items-center gap-3'>
                    <span className='flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary'>
                      <Activity className='size-5' />
                    </span>
                    <div className='min-w-0'>
                      <h3 className='truncate font-semibold'>
                        {trace.trace}
                      </h3>
                      <p className='text-xs text-muted-foreground'>
                        Open transaction trace
                      </p>
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        ) : (
          <div className='rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground'>
            No traces are available for this proxy.
          </div>
        )}
      </section>

      <section
        className='flex flex-col gap-4'
        aria-labelledby='policies-title'
      >
        <div>
          <h2 id='policies-title' className='text-xl font-semibold'>
            Policy files
          </h2>
          <p className='mt-1 text-sm text-muted-foreground'>
            Choose a file to inspect its contents.
          </p>
        </div>

        <Card className='gap-0 overflow-hidden'>
          <CardHeader className='border-b px-4 py-4 md:px-5'>
            <CardTitle className='flex items-center gap-2 text-base'>
              <FileText className='size-4 text-muted-foreground' />
              Policy explorer
            </CardTitle>
            <CardDescription>
              {policyFileSelected?.name ??
                'Select a policy file from the list'}
            </CardDescription>
          </CardHeader>

          <div className='grid min-h-[360px] grid-cols-1 md:grid-cols-[240px_minmax(0,1fr)]'>
            <nav
              aria-label='Policy files'
              className='border-b p-3 md:border-b-0 md:border-r'
            >
              <p className='mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
                Files
              </p>
              {loadStatus === 'loading' ? (
                <p className='px-2 py-3 text-sm text-muted-foreground'>
                  Loading files…
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
                      onClick={() => setPolicyFileSelected(file)}
                      className={policyFileStyles({
                        selected:
                          policyFileSelected?.name === file.name,
                      })}
                    >
                      <FileText className='size-4 shrink-0' />
                      <span className='truncate'>{file.name}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className='px-2 py-3 text-sm text-muted-foreground'>
                  No policy files found.
                </p>
              )}
            </nav>

            <div className='min-w-0 p-3 md:p-4'>
              {policyFileSelected ? (
                policyFileSelected.content ? (
                  <ScrollArea
                    orientation='both'
                    className='h-[360px] w-full rounded-md border bg-muted/20'
                  >
                    <div className='flex min-w-max gap-4 p-4 font-mono text-xs leading-6 md:text-sm'>
                      <pre className='select-none border-r pr-3 text-right text-muted-foreground'>
                        {linesOnText(policyFileSelected.content)}
                      </pre>
                      <pre className='whitespace-pre'>
                        {policyFileSelected.content}
                      </pre>
                    </div>
                  </ScrollArea>
                ) : (
                  <div className='flex h-[360px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground'>
                    This file has no content to display.
                  </div>
                )
              ) : (
                <div className='flex h-[360px] flex-col items-center justify-center gap-3 rounded-md border border-dashed px-6 text-center text-sm text-muted-foreground'>
                  <Network className='size-6' />
                  <p>Select a policy file to preview its contents.</p>
                </div>
              )}
            </div>
          </div>
        </Card>
      </section>
    </main>
  );
}
