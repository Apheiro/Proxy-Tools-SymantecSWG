'use client';

import { FileCode2 } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import PacFileManagerWorkspace from '@/components/pacFileManagerWorkspace';
import PageHeader from '@/components/pageHeader';
import { Button } from '@/components/ui/button';
import { getLocalStorage } from '@/lib/utilsClient';

function PacSourcePage() {
  const query = useSearchParams();
  const sourceId =
    query.get('new') === '1' ? 'new' : (query.get('sourceId') ?? '');
  const [proxies, setProxies] = useState<Proxy[]>([]);

  useEffect(() => {
    setProxies(getLocalStorage<Proxy[]>('proxies') ?? []);
  }, []);

  return (
    <main className='flex min-w-0 flex-col gap-5'>
      <PageHeader
        icon={FileCode2}
        eyebrow='PAC File Manager / Source editor'
        title='PAC Source Editor'
        description='Configure source details, organize routing rules, test destinations, and export the PAC file.'
        actions={
          <Button variant='outline' asChild>
            <Link href='/pac'>Back to PAC sources</Link>
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
        <p className='text-sm text-muted-foreground'>
          Loading PAC source…
        </p>
      )}
    </main>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div>Loading PAC source…</div>}>
      <PacSourcePage />
    </Suspense>
  );
}
