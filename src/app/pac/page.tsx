'use client';

import { FileCode2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import PageHeader from '@/components/pageHeader';
import PacFileManagerWorkspace from '@/components/pacFileManagerWorkspace';
import { Button } from '@/components/ui/button';
import { getLocalStorage } from '@/lib/utilsClient';

export default function PacSourcePage() {
  const router = useRouter();
  const [sourceId, setSourceId] = useState('');
  const [proxies, setProxies] = useState<Proxy[]>([]);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    setSourceId(
      query.get('new') === '1'
        ? 'new'
        : (query.get('sourceId') ?? ''),
    );
    setProxies(getLocalStorage<Proxy[]>('proxies') ?? []);
    localStorage.setItem('home-workspace', 'pac');
  }, []);

  return (
    <main className='mx-auto flex min-h-dvh w-full max-w-7xl flex-col gap-5 px-4 py-6 md:px-6'>
      <PageHeader
        icon={FileCode2}
        eyebrow='PAC File Manager / Source editor'
        title='PAC Source Editor'
        description='Configure source details, organize routing rules, test destinations, and export the PAC file.'
        actions={
          <Button variant='outline' onClick={() => router.push('/')}>
            Back to PAC sources
          </Button>
        }
      />
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
