'use client';

import { FileCode2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import PacFileManagerWorkspace from '@/components/pacFileManagerWorkspace';
import { Button } from '@/components/ui/button';
import { getLocalStorage } from '@/lib/utilsClient';

export default function PacSourcePage() {
  const router = useRouter();
  const [sourceId, setSourceId] = useState('');
  const [proxies, setProxies] = useState<Proxy[]>([]);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    setSourceId(query.get('new') === '1' ? 'new' : query.get('sourceId') ?? '');
    setProxies(getLocalStorage<Proxy[]>('proxies') ?? []);
    localStorage.setItem('home-workspace', 'pac');
  }, []);

  return (
    <main className='mx-auto flex min-h-dvh w-full max-w-7xl flex-col gap-5 px-4 py-6 md:px-6'>
      <header className='flex flex-wrap items-end justify-between gap-4 border-b pb-5'>
        <div>
          <div className='flex items-center gap-2 text-sm text-muted-foreground'>
            <FileCode2 className='size-4' />
            PAC File Manager / Source editor
          </div>
          <h1 className='mt-2 text-2xl font-bold tracking-tight md:text-3xl'>
            PAC Source Editor
          </h1>
          <p className='mt-1 text-sm text-muted-foreground'>
            Configure source details, organize routing rules, test destinations, and export the PAC file.
          </p>
        </div>
        <Button variant='outline' onClick={() => router.push('/')}>
          Back to PAC sources
        </Button>
      </header>
      {sourceId ? (
        <PacFileManagerWorkspace
          proxies={proxies}
          mode='edit'
          editorSourceId={sourceId}
        />
      ) : (
        <p className='text-sm text-muted-foreground'>Loading PAC source…</p>
      )}
    </main>
  );
}
