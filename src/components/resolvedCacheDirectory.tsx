'use client';

import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';

type AppCachePaths = {
  directory: string;
  rawLog: string;
  jsonLog: string;
  trafficAnalysis: string;
};

type CachePathState =
  | { state: 'loading' }
  | { state: 'resolved'; paths: AppCachePaths }
  | { state: 'error'; message: string };

export default function ResolvedCacheDirectory() {
  const [result, setResult] = useState<CachePathState>({
    state: 'loading',
  });

  useEffect(() => {
    invoke<AppCachePaths>('get_app_cache_paths')
      .then((paths) => setResult({ state: 'resolved', paths }))
      .catch((error: unknown) =>
        setResult({ state: 'error', message: String(error) }),
      );
  }, []);

  if (result.state === 'loading') {
    return <code>Resolving Tauri app_cache_dir()…</code>;
  }

  if (result.state === 'error') {
    return (
      <span className='text-muted-foreground'>
        Could not query the Tauri runtime ({result.message}). Open
        this page inside the desktop app to see the resolved path.
      </span>
    );
  }

  return (
    <div className='flex flex-col gap-2'>
      <div>
        <p className='text-[10px] text-muted-foreground'>
          app_cache_dir()
        </p>
        <code className='break-all'>{result.paths.directory}</code>
      </div>
      <div>
        <p className='text-[10px] text-muted-foreground'>
          rawLogs.log
        </p>
        <code className='break-all'>{result.paths.rawLog}</code>
      </div>
      <div>
        <p className='text-[10px] text-muted-foreground'>
          logs.jsonl
        </p>
        <code className='break-all'>{result.paths.jsonLog}</code>
      </div>
      <div>
        <p className='text-[10px] text-muted-foreground'>
          Traffic Analysis: processed logs and pending files
        </p>
        <code className='break-all'>
          {result.paths.trafficAnalysis}
        </code>
      </div>
    </div>
  );
}
