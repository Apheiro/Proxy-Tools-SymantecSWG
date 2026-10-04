/** biome-ignore-all lint/correctness/useUniqueElementIds: <> */
/** biome-ignore-all lint/style/useNamingConvention: <> */
/** biome-ignore-all lint/a11y/noStaticElementInteractions: <> */
'use client';
import { invoke } from '@tauri-apps/api/core';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Fragment, Suspense, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  deleteLocalStorage,
  getLocalStorage,
} from '@/lib/utilsClient';

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
    resultado += `${i}\n`;
  }
  return resultado;
}

function PageBase() {
  const searchParams = useSearchParams();
  const [policyFileSelected, setPolicyFileSelected] =
    useState<FileLink | null>(null);
  const [htmlData, setHtmlData] = useState<HtmlData | null>(null);
  const credentials = getLocalStorage<Credentials>(
    'one-time-credentials',
  );

  useEffect(() => {
    const traces = invoke('get_html_data', {
      ippr: searchParams.get('proxy') || '',
      userpr: credentials?.username,
      passpr: credentials?.password,
    });

    toast.promise(traces, {
      loading: 'Getting trace data...',
      success: (r) => {
        setHtmlData(r as HtmlData);
        console.log(r);
        return 'Trace data fetched successfully.';
      },
      error: (e) => {
        return `Error getting trace data: ${e}`;
      },
    });
  }, []);

  return (
    <main className='w-dvw min-h-dvh flex flex-col gap-3 p-3'>
      {searchParams.get('proxy') ? (
        <div className='text-center text-lg font-bold'>
          {searchParams.get('proxy')} Diagnostic tools
        </div>
      ) : (
        <div className='text-center text-lg'>No proxy selected</div>
      )}

      <div className='flex flex-col gap-3'>
        <div className='flex gap-2'>
          <Card className='flex flex-col gap-2 p-3 hover:cursor-pointer hover:bg-[var(--card)]/50 hover:scale-105 transition-all duration-300'>
            Logs Trafic analysis
          </Card>
          <Card className='flex flex-col gap-2 p-3 hover:cursor-pointer hover:bg-[var(--card)]/50 hover:scale-105 transition-all duration-300'>
            Raw Tail Logs
          </Card>
        </div>

        <h2 className='text-xl font-bold'>Policies files</h2>
        <div className='flex gap-2 flex-wrap'>
          <div className='border bg-background shadow-xs dark:bg-input/30 dark:border-input rounded-xl p-3 flex flex-col gap-2 w-fit'>
            {htmlData
              ? htmlData.filesLink.map((file, index) => (
                  <Fragment key={file.name}>
                    <div
                      onClick={() => setPolicyFileSelected(file)}
                      className=' flex gap-2 hover:cursor-pointer hover:bg-[var(--card)]/50 hover:scale-105 transition-all duration-300 p-2 rounded-md'
                    >
                      {policyFileSelected?.name === file.name && (
                        <p className='font-bold'>{'>'}</p>
                      )}
                      <h3>{file.name}</h3>
                    </div>
                    {index !== htmlData.filesLink.length - 1 && (
                      <hr key={`hr-${file.name}`} />
                    )}
                  </Fragment>
                ))
              : null}
          </div>
          <div className='border bg-background shadow-xs dark:bg-input/30 dark:border-input rounded-xl p-3 flex flex-col gap-2 flex-1 min-w-2xl max-h-[500px]'>
            {policyFileSelected ? (
              policyFileSelected.content ? (
                <ScrollArea
                  orientation='both'
                  className='h-full w-full px-1 absolute'
                >
                  <div className='flex mb-2 gap-3'>
                    <pre className='pointer-none select-none pr-4 border-r-1 text-right'>
                      {linesOnText(policyFileSelected.content)}
                    </pre>
                    <pre>{policyFileSelected.content}</pre>
                  </div>
                </ScrollArea>
              ) : (
                <p className='text-muted-foreground text-xl font-bold h-full flex items-center justify-center'>
                  No content available
                </p>
              )
            ) : (
              <p className='text-muted-foreground text-xl font-bold h-full flex items-center justify-center'>
                Select a policy file to view its content.
              </p>
            )}
          </div>
        </div>

        <h2 className='text-xl font-bold'>Traces available</h2>
        <div className='flex gap-2 flex-wrap'>
          {htmlData?.traces.map((trace) => (
            <Link
              key={trace.trace}
              href={{
                pathname: '/Diagnostics/Trace',
                query: {
                  traceUrl: trace.url,
                  proxy: searchParams.get('proxy'),
                },
              }}
            >
              <Card className='flex flex-col gap-2 p-3 hover:cursor-pointer hover:bg-[var(--card)]/50 hover:scale-105 transition-all duration-300'>
                <h3>{trace.trace}</h3>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
